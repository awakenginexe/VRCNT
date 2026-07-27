from os import path as os_path
import importlib
import sys
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from threading import Condition, Lock, RLock
from math import ceil
from time import monotonic, perf_counter, sleep, time

from deepl import DeepLClient
import requests

try:
    from .translation_languages import translation_lang
    from .translation_utils import ctranslate2_weights, _prepareCtrTranslate2Runtime, loadCTranslate2Tokenizer
except Exception:
    sys.path.append(os_path.dirname(os_path.dirname(os_path.dirname(os_path.abspath(__file__)))))
    from translation_languages import translation_lang
    from translation_utils import ctranslate2_weights, _prepareCtrTranslate2Runtime, loadCTranslate2Tokenizer

from utils import errorLogging, getBestComputeType
from models.pipeline.pipeline_types import TranslationAttempt, TranslationStatus

import warnings
from typing import Any, Callable, Iterable, Optional, Tuple

warnings.filterwarnings("ignore")


PROVIDER_TIMEOUT_EXCEPTIONS = (TimeoutError, requests.exceptions.Timeout)
DEFAULT_PROVIDER_TIMEOUT_SECONDS = 5.0
DEFAULT_RATE_LIMIT_PROBE_SECONDS = 60
MAX_RATE_LIMIT_BACKOFF_SECONDS = 15 * 60
MAX_RETRY_AFTER_SECONDS = 24 * 60 * 60
TIMEOUT_PROBE_SECONDS = 15
UNAUTHENTICATED_WEB_PROVIDERS = frozenset(
    ("DeepL", "Papago")
)
MIN_UNAUTHENTICATED_PROVIDER_INTERVAL_SECONDS = 1.5


def _getCtrTranslate2():
    _prepareCtrTranslate2Runtime()
    return importlib.import_module("ctranslate2")


def _getTransformers():
    return importlib.import_module("transformers")


def _getWebTranslator():
    try:
        return importlib.import_module("translators").translate_text
    except Exception:
        errorLogging()
        return None


def _getRelativeClientModule(module_name: str):
    try:
        return importlib.import_module(f".{module_name}", __package__)
    except Exception:
        root_dir = os_path.dirname(os_path.dirname(os_path.dirname(os_path.abspath(__file__))))
        if root_dir not in sys.path:
            sys.path.append(root_dir)
        return importlib.import_module(module_name)


class Translator:
    """High-level translator facade.

    This class wraps multiple backends (DeepL, DeepL API, Google, Bing, Papago,
    and CTranslate2 local models). Optional dependencies may be unavailable at
    runtime; methods degrade gracefully and return False or an empty string on
    failure (kept compatible with existing behavior).
    """

    def __init__(self) -> None:
        self.deepl_client: Optional[DeepLClient] = None
        self.plamo_client: Any = None
        self.gemini_client: Any = None
        self.openai_client: Any = None
        self.groq_client: Any = None
        self.openrouter_client: Any = None
        self.lmstudio_client: Any = None
        self.lmstudio_connected: bool = False
        self.ollama_client: Any = None
        self.ollama_connected: bool = False
        self.ctranslate2_translator: Any = None
        self.ctranslate2_tokenizer: Any = None
        self.is_loaded_ctranslate2_model: bool = False
        self.is_changed_translator_parameters: bool = False
        self._ctranslate2_condition = Condition(RLock())
        self._ctranslate2_active_calls = 0
        self._ctranslate2_transitioning = False
        self._web_translator = None
        self.is_enable_translators: bool = True
        self._provider_cooldown_lock = Lock()
        self._provider_cooldowns: dict[str, float] = {}
        self._provider_cooldown_reasons: dict[str, str] = {}
        self._provider_rate_limit_counts: dict[str, int] = {}
        self._provider_cooldown_versions: dict[str, int] = {}
        self._provider_recovery_probes: dict[str, int] = {}
        self._provider_cooldown_callback: Optional[
            Callable[[dict[str, dict[str, object]]], None]
        ] = None
        self._provider_pacing_lock = Lock()
        self._provider_next_request_at: dict[str, float] = {}
        self._context_provider_locks = {
            provider: Lock()
            for provider in (
                "Plamo_API",
                "Gemini_API",
                "OpenAI_API",
                "Groq_API",
                "OpenRouter_API",
                "LMStudio",
                "Ollama",
            )
        }

    @staticmethod
    def _rateLimitRetryAfterSeconds(error: Exception) -> Optional[int]:
        candidates = [
            getattr(error, "retry_after", None),
            getattr(error, "retry_after_seconds", None),
        ]
        response = getattr(error, "response", None)
        if response is not None:
            headers = getattr(response, "headers", None)
            if headers is not None:
                try:
                    candidates.append(headers.get("Retry-After"))
                except Exception:
                    pass

        for candidate in candidates:
            try:
                seconds = ceil(float(candidate))
            except (TypeError, ValueError):
                try:
                    retry_at = parsedate_to_datetime(str(candidate))
                    if retry_at.tzinfo is None:
                        retry_at = retry_at.replace(tzinfo=timezone.utc)
                    seconds = ceil(
                        (retry_at - datetime.now(timezone.utc)).total_seconds()
                    )
                except (TypeError, ValueError, OverflowError, IndexError):
                    continue
            if seconds > 0:
                return min(seconds, MAX_RETRY_AFTER_SECONDS)
        return None

    @classmethod
    def _classifyProviderError(
        cls,
        error: Exception,
    ) -> tuple[str, Optional[int]]:
        response = getattr(error, "response", None)
        status_code = getattr(error, "status_code", None)
        if status_code is None and response is not None:
            status_code = getattr(response, "status_code", None)
        message = str(error).lower()
        is_rate_limited = (
            status_code == 429
            or "429" in message
            or "too many requests" in message
            or "rate limit" in message
            or "ratelimit" in message
        )
        if not is_rate_limited:
            return "provider_error", None
        return "provider_rate_limited", cls._rateLimitRetryAfterSeconds(error)

    def _remainingProviderCooldown(self, provider: str) -> Optional[int]:
        with self._provider_cooldown_lock:
            deadline = self._provider_cooldowns.get(provider)
            if deadline is None:
                return None
            remaining = ceil(deadline - monotonic())
            if remaining <= 0:
                return (
                    1
                    if provider in self._provider_recovery_probes
                    else None
                )
            return remaining

    def _beginProviderAttempt(
        self,
        provider: str,
    ) -> tuple[Optional[int], int, bool]:
        """Reserve at most one real-message probe after cooldown expiry."""
        with self._provider_cooldown_lock:
            version = self._provider_cooldown_versions.get(provider, 0)
            deadline = self._provider_cooldowns.get(provider)
            if deadline is None:
                return None, version, False
            remaining = ceil(deadline - monotonic())
            if remaining > 0:
                return remaining, version, False
            if self._provider_recovery_probes.get(provider) == version:
                return 1, version, False
            self._provider_recovery_probes[provider] = version
            return None, version, True

    def _rememberProviderCooldown(
        self,
        provider: str,
        retry_after_seconds: Optional[int],
        *,
        reason: str = "rate_limited",
    ) -> int:
        with self._provider_cooldown_lock:
            self._provider_cooldown_versions[provider] = (
                self._provider_cooldown_versions.get(provider, 0) + 1
            )
            self._provider_recovery_probes.pop(provider, None)
            if reason == "rate_limited":
                count = self._provider_rate_limit_counts.get(provider, 0) + 1
                self._provider_rate_limit_counts[provider] = count
            else:
                count = 1
            if retry_after_seconds is None and reason == "rate_limited":
                probe_seconds = min(
                    DEFAULT_RATE_LIMIT_PROBE_SECONDS * (2 ** (count - 1)),
                    MAX_RATE_LIMIT_BACKOFF_SECONDS,
                )
            else:
                probe_seconds = retry_after_seconds or TIMEOUT_PROBE_SECONDS
            probe_seconds = max(1, min(probe_seconds, MAX_RETRY_AFTER_SECONDS))
            self._provider_cooldowns[provider] = monotonic() + probe_seconds
            self._provider_cooldown_reasons[provider] = reason
        self._notifyProviderCooldowns()
        return probe_seconds

    def _clearProviderCooldown(
        self,
        provider: str,
        *,
        expected_version: Optional[int] = None,
        recovery_probe: bool = False,
    ) -> None:
        changed = False
        with self._provider_cooldown_lock:
            if expected_version is None:
                self._provider_recovery_probes.pop(provider, None)
            elif recovery_probe and (
                self._provider_recovery_probes.get(provider)
                == expected_version
            ):
                self._provider_recovery_probes.pop(provider, None)
            if (
                expected_version is not None
                and self._provider_cooldown_versions.get(provider, 0)
                != expected_version
            ):
                return
            changed = self._provider_cooldowns.pop(provider, None) is not None
            self._provider_cooldown_reasons.pop(provider, None)
            self._provider_rate_limit_counts.pop(provider, None)
        if changed:
            self._notifyProviderCooldowns()

    def _releaseProviderRecoveryProbe(
        self,
        provider: str,
        expected_version: int,
        recovery_probe: bool,
    ) -> None:
        if not recovery_probe:
            return
        with self._provider_cooldown_lock:
            if (
                self._provider_recovery_probes.get(provider)
                == expected_version
            ):
                self._provider_recovery_probes.pop(provider, None)

    def setProviderCooldownCallback(
        self,
        callback: Optional[Callable[[dict[str, dict[str, object]]], None]],
    ) -> None:
        self._provider_cooldown_callback = callback

    def getProviderCooldownSnapshot(
        self,
        providers: Optional[Iterable[str]] = None,
    ) -> dict[str, dict[str, object]]:
        provider_filter = set(providers) if providers is not None else None
        now_monotonic = monotonic()
        now_wall = time()
        snapshot: dict[str, dict[str, object]] = {}
        with self._provider_cooldown_lock:
            for provider, deadline in self._provider_cooldowns.items():
                remaining = ceil(deadline - now_monotonic)
                if remaining <= 0:
                    if provider in self._provider_recovery_probes:
                        remaining = 1
                    else:
                        continue
                if provider_filter is not None and provider not in provider_filter:
                    continue
                snapshot[provider] = {
                    "reason": self._provider_cooldown_reasons.get(
                        provider,
                        "rate_limited",
                    ),
                    "retry_after_seconds": remaining,
                    "retry_at_ms": round((now_wall + remaining) * 1000),
                }
        return snapshot

    def _notifyProviderCooldowns(self) -> None:
        callback = self._provider_cooldown_callback
        if callback is None:
            return
        try:
            callback(self.getProviderCooldownSnapshot())
        except Exception:
            errorLogging()

    def rememberProviderTimeout(self, provider: str) -> int:
        return self._rememberProviderCooldown(
            provider,
            TIMEOUT_PROBE_SECONDS,
            reason="timeout",
        )

    def getRateLimitedProviderCooldowns(
        self,
        providers,
    ) -> dict[str, int]:
        cooldowns = {}
        for provider in providers:
            remaining = self._remainingProviderCooldown(provider)
            if remaining is not None:
                cooldowns[provider] = remaining
        return cooldowns

    def _paceUnauthenticatedProvider(self, provider: str) -> None:
        """Reserve one spaced request slot for unofficial/free web providers."""
        if provider not in UNAUTHENTICATED_WEB_PROVIDERS:
            return
        with self._provider_pacing_lock:
            now = monotonic()
            request_at = max(
                now,
                self._provider_next_request_at.get(provider, now),
            )
            self._provider_next_request_at[provider] = (
                request_at + MIN_UNAUTHENTICATED_PROVIDER_INTERVAL_SECONDS
            )
        delay = request_at - now
        if delay > 0:
            sleep(delay)

    def authenticationDeepLAuthKey(self, auth_key: str) -> bool:
        """Authenticate DeepL API with the provided key.

        Returns True on success, False on failure.
        """
        result = True
        try:
            self.deepl_client = DeepLClient(auth_key)
            # quick smoke test
            self.deepl_client.translate_text(" ", target_lang="EN-US")
        except Exception:
            errorLogging()
            self.deepl_client = None
            result = False
        return result

    def authenticationPlamoAuthKey(self, auth_key: str, root_path: str = None) -> bool:
        """Authenticate Plamo API with the provided key.

        Returns True on success, False on failure.
        """
        self.plamo_client = _getRelativeClientModule("translation_plamo").PlamoClient(root_path=root_path)
        if self.plamo_client.setAuthKey(auth_key):
            return True
        else:
            self.plamo_client = None
            return False

    def getPlamoModelList(self) -> list[str]:
        """Get available Plamo models.

        Returns a list of model names, or an empty list on failure.
        """
        if self.plamo_client is None:
            return []
        return self.plamo_client.getModelList()

    def setPlamoModel(self, model: str) -> bool:
        """Change the Plamo model used for translation.

        Returns True on success, False on failure.
        """
        if self.plamo_client is None:
            return False
        return self.plamo_client.setModel(model)

    def updatePlamoClient(self) -> None:
        """Update the Plamo client (fetch available models)."""
        self.plamo_client.updateClient()

    def authenticationGeminiAuthKey(self, auth_key: str, root_path: str = None) -> bool:
        """Authenticate Gemini API with the provided key.

        Returns True on success, False on failure.
        """
        self.gemini_client = _getRelativeClientModule("translation_gemini").GeminiClient(root_path=root_path)
        if self.gemini_client.setAuthKey(auth_key):
            return True
        else:
            self.gemini_client = None
            return False

    def getGeminiModelList(self) -> list[str]:
        """Get available Gemini models.

        Returns a list of model names, or an empty list on failure.
        """
        if self.gemini_client is None:
            return []
        return self.gemini_client.getModelList()

    def setGeminiModel(self, model: str) -> bool:
        """Change the Gemini model used for translation.

        Returns True on success, False on failure.
        """
        if self.gemini_client is None:
            return False
        return self.gemini_client.setModel(model)

    def updateGeminiClient(self) -> None:
        """Update the Gemini client (fetch available models)."""
        self.gemini_client.updateClient()

    def authenticationOpenAIAuthKey(self, auth_key: str, base_url: str | None = None, root_path: str = None) -> bool:
        """Authenticate OpenAI (Chat Completions) API with the provided key.

        base_url を指定することで互換エンドポイント (例: Azure OpenAI 互換, Proxy) にも対応可能。
        Returns True on success, False on failure.
        """
        self.openai_client = _getRelativeClientModule("translation_openai").OpenAIClient(base_url=base_url, root_path=root_path)
        if self.openai_client.setAuthKey(auth_key):
            return True
        else:
            self.openai_client = None
            return False

    def getOpenAIModelList(self) -> list[str]:
        """Get available OpenAI models.

        Returns a list of model names, or an empty list on failure.
        """
        if self.openai_client is None:
            return []
        return self.openai_client.getModelList()

    def setOpenAIModel(self, model: str) -> bool:
        """Change the OpenAI model used for translation.

        Returns True on success, False on failure.
        """
        if self.openai_client is None:
            return False
        return self.openai_client.setModel(model)

    def updateOpenAIClient(self) -> None:
        """Update the OpenAI client (fetch available models)."""
        self.openai_client.updateClient()

    def authenticationGroqAuthKey(self, auth_key: str, root_path: str = None) -> bool:
        """Authenticate Groq API with the provided key.

        Returns True on success, False on failure.
        """
        self.groq_client = _getRelativeClientModule("translation_groq").GroqClient(root_path=root_path)
        if self.groq_client.setAuthKey(auth_key):
            return True
        else:
            self.groq_client = None
            return False

    def getGroqModelList(self) -> list[str]:
        """Get available Groq models.

        Returns a list of model names, or an empty list on failure.
        """
        if self.groq_client is None:
            return []
        return self.groq_client.getModelList()

    def setGroqModel(self, model: str) -> bool:
        """Change the Groq model used for translation.

        Returns True on success, False on failure.
        """
        if self.groq_client is None:
            return False
        return self.groq_client.setModel(model)

    def updateGroqClient(self) -> None:
        """Update the Groq client (fetch available models)."""
        self.groq_client.updateClient()

    def authenticationOpenRouterAuthKey(self, auth_key: str, root_path: str = None) -> bool:
        """Authenticate OpenRouter API with the provided key.

        Returns True on success, False on failure.
        """
        self.openrouter_client = _getRelativeClientModule("translation_openrouter").OpenRouterClient(root_path=root_path)
        if self.openrouter_client.setAuthKey(auth_key):
            return True
        else:
            self.openrouter_client = None
            return False

    def getOpenRouterModelList(self) -> list[str]:
        """Get available OpenRouter models.

        Returns a list of model names, or an empty list on failure.
        """
        if self.openrouter_client is None:
            return []
        return self.openrouter_client.getModelList()

    def setOpenRouterModel(self, model: str) -> bool:
        """Change the OpenRouter model used for translation.

        Returns True on success, False on failure.
        """
        if self.openrouter_client is None:
            return False
        return self.openrouter_client.setModel(model)

    def updateOpenRouterClient(self) -> None:
        """Update the OpenRouter client (fetch available models)."""
        self.openrouter_client.updateClient()

    def getLMStudioConnected(self) -> bool:
        """Get LM Studio connection status.

        Returns True if connected and verified, False otherwise.
        """
        return self.lmstudio_connected

    def setLMStudioClientURL(self, base_url: str | None = None, root_path: str = None) -> bool:
        """Authenticate LM Studio with the provided base URL.

        Returns True on success, False on failure.
        """
        self.lmstudio_client = _getRelativeClientModule("translation_lmstudio").LMStudioClient(base_url=base_url, root_path=root_path)
        result = self.lmstudio_client.setBaseURL(base_url)
        if result is False:
            self.lmstudio_client = None
            self.lmstudio_connected = False
        else:
            self.lmstudio_connected = True
        return result

    def getLMStudioModelList(self) -> list[str]:
        """Get available LM Studio models.

        Returns a list of model names, or an empty list on failure.
        """
        if self.lmstudio_client is None:
            return []
        return self.lmstudio_client.getModelList()

    def setLMStudioModel(self, model: str) -> bool:
        """Change the LM Studio model used for translation.
        """
        if self.lmstudio_client is None:
            return False
        return self.lmstudio_client.setModel(model)

    def updateLMStudioClient(self) -> None:
        """Update the LM Studio client (fetch available models)."""
        self.lmstudio_client.updateClient()

    def getOllamaConnected(self) -> bool:
        """Get Ollama connection status.

        Returns True if connected and verified, False otherwise.
        """
        return self.ollama_connected

    def checkOllamaClient(self, root_path: str = None) -> bool:
        """Check if Ollama client is available.

        Returns True if Ollama is reachable, False otherwise.
        """
        self.ollama_client = _getRelativeClientModule("translation_ollama").OllamaClient(root_path=root_path)
        result = self.ollama_client.authenticationCheck()
        if result is False:
            self.ollama_client = None
            self.ollama_connected = False
        else:
            self.ollama_connected = True
        return result

    def getOllamaModelList(self, root_path: str = None) -> bool:
        """Initialize Ollama client and fetch available models.

        Returns True on success, False on failure.
        """
        if self.ollama_client is None:
            return []
        return self.ollama_client.getModelList()

    def setOllamaModel(self, model: str) -> bool:
        """Change the Ollama model used for translation.

        Returns True on success, False on failure.
        """
        if self.ollama_client is None:
            return False
        return self.ollama_client.setModel(model)

    def updateOllamaClient(self) -> None:
        """Update the Ollama client (fetch available models)."""
        self.ollama_client.updateClient()

    def changeCTranslate2Model(self, path: str, model_type: str, device: str = "cpu", device_index: int = 0, compute_type: str = "auto") -> None:
        """Load a CTranslate2 model from weights.

        This sets internal translator/tokenizer objects and flips
        ``is_loaded_ctranslate2_model`` on success.
        """
        with self._ctranslate2_condition:
            while self._ctranslate2_transitioning:
                self._ctranslate2_condition.wait()
            self._ctranslate2_transitioning = True
            while self._ctranslate2_active_calls:
                self._ctranslate2_condition.wait()
            previous_translator = self.ctranslate2_translator
            self.ctranslate2_translator = None
            self.ctranslate2_tokenizer = None
            self.is_loaded_ctranslate2_model = False

        new_translator = None
        try:
            if previous_translator is not None:
                try:
                    previous_translator.unload_model(to_cpu=False)
                except Exception:
                    errorLogging()
            directory_name = ctranslate2_weights[model_type]["directory_name"]
            weight_path = os_path.join(path, "weights", "ctranslate2", directory_name)
            if compute_type == "auto":
                compute_type = getBestComputeType(device, device_index)
            new_translator = _getCtrTranslate2().Translator(
                weight_path,
                device=device,
                device_index=device_index,
                compute_type=compute_type,
                inter_threads=1,
                intra_threads=4,
            )
            try:
                new_tokenizer = loadCTranslate2Tokenizer(
                    path, model_type, local_files_only=True
                )
            except Exception:
                errorLogging()
                new_tokenizer = loadCTranslate2Tokenizer(
                    path,
                    model_type,
                    local_files_only=False,
                    repair_cache=True,
                )
            with self._ctranslate2_condition:
                self.ctranslate2_translator = new_translator
                self.ctranslate2_tokenizer = new_tokenizer
                self.is_loaded_ctranslate2_model = True
        except Exception:
            if new_translator is not None:
                try:
                    new_translator.unload_model(to_cpu=False)
                except Exception:
                    errorLogging()
            raise
        finally:
            with self._ctranslate2_condition:
                self._ctranslate2_transitioning = False
                self._ctranslate2_condition.notify_all()

    def unloadCTranslate2Model(self) -> None:
        """Release the local model after active CTranslate2 inference ends."""
        with self._ctranslate2_condition:
            while self._ctranslate2_transitioning:
                self._ctranslate2_condition.wait()
            self._ctranslate2_transitioning = True
            while self._ctranslate2_active_calls:
                self._ctranslate2_condition.wait()
            native_translator = self.ctranslate2_translator
            self.ctranslate2_translator = None
            self.ctranslate2_tokenizer = None
            self.is_loaded_ctranslate2_model = False
        try:
            if native_translator is not None:
                native_translator.unload_model(to_cpu=False)
        except Exception:
            errorLogging()
        finally:
            with self._ctranslate2_condition:
                self._ctranslate2_transitioning = False
                self._ctranslate2_condition.notify_all()

    def isLoadedCTranslate2Model(self) -> bool:
        with self._ctranslate2_condition:
            return self.is_loaded_ctranslate2_model

    def isChangedTranslatorParameters(self) -> bool:
        return self.is_changed_translator_parameters

    def setChangedTranslatorParameters(self, is_changed: bool) -> None:
        self.is_changed_translator_parameters = is_changed

    def translateCTranslate2(self, message: str, source_language: str, target_language, weight_type: str) -> Any:
        """Translate using a loaded CTranslate2 model.

        Returns a string on success or False on failure (keeps legacy behavior).
        """
        with self._ctranslate2_condition:
            if (
                self._ctranslate2_transitioning
                or self.is_loaded_ctranslate2_model is not True
                or self.ctranslate2_translator is None
                or self.ctranslate2_tokenizer is None
            ):
                return False
            self._ctranslate2_active_calls += 1
            native_translator = self.ctranslate2_translator
            tokenizer = self.ctranslate2_tokenizer

        result: Any = False
        try:
            tokenizer.src_lang = source_language
            source = tokenizer.convert_ids_to_tokens(tokenizer.encode(message))
            match weight_type:
                case "m2m100_418M-ct2-int8" | "m2m100_1.2B-ct2-int8":
                    target_prefix = [tokenizer.lang_code_to_token[target_language]]
                case "nllb-200-distilled-1.3B-ct2-int8" | "nllb-200-3.3B-ct2-int8":
                    target_prefix = [target_language]
                case _:
                    return False
            results = native_translator.translate_batch(
                [source],
                target_prefix=[target_prefix],
            )
            target = results[0].hypotheses[0][1:]
            result = tokenizer.decode(tokenizer.convert_tokens_to_ids(target))
        except Exception:
            errorLogging()
        finally:
            with self._ctranslate2_condition:
                self._ctranslate2_active_calls -= 1
                self._ctranslate2_condition.notify_all()
        return result

    @staticmethod
    def getLanguageCode(translator_name: str, weight_type: str, target_country: str, source_language: str, target_language: str) -> Tuple[str, str]:
        """Resolve a friendly language name to translator-specific codes.

        Returns (source_code, target_code).
        """
        match translator_name:
            case "DeepL_API":
                if target_language == "English":
                    if target_country in ["United States", "Canada", "Philippines"]:
                        target_language = "English American"
                    else:
                        target_language = "English British"
                elif target_language == "Portuguese":
                    if target_country in ["Portugal"]:
                        target_language = "Portuguese European"
                    else:
                        target_language = "Portuguese Brazilian"
                source_language = translation_lang[translator_name]["source"][source_language]
                target_language = translation_lang[translator_name]["target"][target_language]
            case "CTranslate2":
                source_language = translation_lang[translator_name][weight_type]["source"][source_language]
                target_language = translation_lang[translator_name][weight_type]["target"][target_language]
            case _:
                source_language = translation_lang[translator_name]["source"][source_language]
                target_language = translation_lang[translator_name]["target"][target_language]
        return source_language, target_language

    def _translate_once(
        self,
        name: str,
        weight: str,
        source: str,
        target: str,
        country: str,
        message: str,
        context: Optional[list[dict]],
        timeout_seconds: float,
    ) -> Any:
        """Dispatch one provider call, leaving classification to the caller."""
        result: Any = False
        if self._web_translator is None:
            self._web_translator = _getWebTranslator()
            if self._web_translator is None:
                self.is_enable_translators = False
        source, target = self.getLanguageCode(name, weight, country, source, target)
        match name:
            case "DeepL":
                if self.is_enable_translators is True and self._web_translator is not None:
                    self._paceUnauthenticatedProvider(name)
                    result = self._web_translator(
                        query_text=message,
                        translator="deepl",
                        from_language=source,
                        to_language=target,
                    )
            case "DeepL_API":
                if self.is_enable_translators is True:
                    if self.deepl_client is None:
                        result = False
                    else:
                        result = self.deepl_client.translate_text(
                            message,
                            source_lang=source,
                            target_lang=target,
                        ).text
            case "Plamo_API":
                if self.plamo_client is not None:
                    result = self._translate_context_provider(
                        name, self.plamo_client, message, source, target, context
                    )
            case "Gemini_API":
                if self.gemini_client is not None:
                    result = self._translate_context_provider(
                        name, self.gemini_client, message, source, target, context
                    )
            case "OpenAI_API":
                if self.openai_client is not None:
                    result = self._translate_context_provider(
                        name, self.openai_client, message, source, target, context
                    )
            case "Groq_API":
                if self.groq_client is not None:
                    result = self._translate_context_provider(
                        name, self.groq_client, message, source, target, context
                    )
            case "OpenRouter_API":
                if self.openrouter_client is not None:
                    result = self._translate_context_provider(
                        name, self.openrouter_client, message, source, target, context
                    )
            case "LMStudio":
                if self.lmstudio_client is not None:
                    result = self._translate_context_provider(
                        name, self.lmstudio_client, message, source, target, context
                    )
            case "Ollama":
                if self.ollama_client is not None:
                    result = self._translate_context_provider(
                        name, self.ollama_client, message, source, target, context
                    )
            case "Google":
                if self.is_enable_translators is True and self._web_translator is not None:
                    self._paceUnauthenticatedProvider(name)
                    result = self._web_translator(
                        query_text=message,
                        translator="google",
                        from_language=source,
                        to_language=target,
                        timeout=timeout_seconds,
                    )
            case "Bing":
                if self.is_enable_translators is True and self._web_translator is not None:
                    self._paceUnauthenticatedProvider(name)
                    result = self._web_translator(
                        query_text=message,
                        translator="bing",
                        from_language=source,
                        to_language=target,
                        timeout=timeout_seconds,
                    )
            case "Papago":
                if self.is_enable_translators is True and self._web_translator is not None:
                    self._paceUnauthenticatedProvider(name)
                    result = self._web_translator(
                        query_text=message,
                        translator="papago",
                        from_language=source,
                        to_language=target,
                    )
            case "CTranslate2":
                result = self.translateCTranslate2(
                    message=message,
                    source_language=source,
                    target_language=target,
                    weight_type=weight,
                )
        return result

    def _translate_context_provider(
        self,
        name: str,
        client: Any,
        message: str,
        source: str,
        target: str,
        context: Optional[list[dict]],
    ) -> Any:
        """Keep one shared client's context mutation and invocation atomic."""
        with self._context_provider_locks[name]:
            client.setContextHistory(context or [])
            return client.translate(
                message,
                input_lang=source,
                output_lang=target,
            )

    def translateAttempt(
        self,
        translator_name: str,
        weight_type: str,
        source_language: str,
        target_language: str,
        target_country: str,
        message: str,
        context_history: Optional[list[dict]] = None,
        timeout_seconds: float = DEFAULT_PROVIDER_TIMEOUT_SECONDS,
    ) -> TranslationAttempt:
        """Attempt one provider once and return its structured outcome."""
        started_at = perf_counter()
        if source_language == target_language:
            return TranslationAttempt(
                status=TranslationStatus.SUCCESS,
                engine=translator_name,
                message=message,
                duration_ms=0,
                error_code=None,
            )

        (
            cooldown_seconds,
            attempt_version,
            recovery_probe,
        ) = self._beginProviderAttempt(translator_name)
        if cooldown_seconds is not None:
            return TranslationAttempt(
                status=TranslationStatus.ERROR,
                engine=translator_name,
                message=None,
                duration_ms=0,
                error_code="provider_rate_limited",
                retry_after_seconds=cooldown_seconds,
            )

        try:
            result = self._translate_once(
                translator_name,
                weight_type,
                source_language,
                target_language,
                target_country,
                message,
                context_history,
                timeout_seconds,
            )
        except PROVIDER_TIMEOUT_EXCEPTIONS:
            retry_after_seconds = self.rememberProviderTimeout(translator_name)
            return TranslationAttempt(
                status=TranslationStatus.TIMEOUT,
                engine=translator_name,
                message=None,
                duration_ms=max(0, round((perf_counter() - started_at) * 1000)),
                error_code="provider_timeout",
                retry_after_seconds=retry_after_seconds,
            )
        except Exception as error:
            error_code, retry_after_seconds = self._classifyProviderError(error)
            if error_code == "provider_rate_limited":
                retry_after_seconds = self._rememberProviderCooldown(
                    translator_name,
                    retry_after_seconds,
                )
            else:
                self._releaseProviderRecoveryProbe(
                    translator_name,
                    attempt_version,
                    recovery_probe,
                )
                errorLogging()
            return TranslationAttempt(
                status=TranslationStatus.ERROR,
                engine=translator_name,
                message=None,
                duration_ms=max(0, round((perf_counter() - started_at) * 1000)),
                error_code=error_code,
                retry_after_seconds=retry_after_seconds,
            )

        duration_ms = max(0, round((perf_counter() - started_at) * 1000))
        if result:
            self._clearProviderCooldown(
                translator_name,
                expected_version=attempt_version,
                recovery_probe=recovery_probe,
            )
            return TranslationAttempt(
                status=TranslationStatus.SUCCESS,
                engine=translator_name,
                message=str(result),
                duration_ms=duration_ms,
                error_code=None,
            )
        self._releaseProviderRecoveryProbe(
            translator_name,
            attempt_version,
            recovery_probe,
        )
        return TranslationAttempt(
            status=TranslationStatus.ERROR,
            engine=translator_name,
            message=None,
            duration_ms=duration_ms,
            error_code="empty_provider_result",
        )

    def translate(
        self,
        translator_name: str,
        weight_type: str,
        source_language: str,
        target_language: str,
        target_country: str,
        message: str,
        context_history: Optional[list[dict]] = None,
    ) -> Any:
        """Adapt a single structured attempt to the legacy string/False API."""
        attempt = self.translateAttempt(
            translator_name=translator_name,
            weight_type=weight_type,
            source_language=source_language,
            target_language=target_language,
            target_country=target_country,
            message=message,
            context_history=context_history,
            timeout_seconds=DEFAULT_PROVIDER_TIMEOUT_SECONDS,
        )
        if attempt.status is TranslationStatus.SUCCESS:
            return attempt.message
        return False

if __name__ == "__main__":
    translator = Translator()
    # test CTranslate2 model nllb-200-distilled-1.3B-ct2-int8
    translator.changeCTranslate2Model(path=".", model_type="nllb-200-distilled-1.3B-ct2-int8", device="cpu", device_index=0)
    result = translator.translate(
        translator_name="CTranslate2",
        weight_type="nllb-200-distilled-1.3B-ct2-int8",
        source_language="English",
        target_language="Japanese",
        target_country="Japan",
        message="Hello, world!"
        )
    print(result)
