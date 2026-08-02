from time import monotonic
from typing import Any

from openai import OpenAI

try:
    from . import translation_languages
    from .translation_utils import loadTranslatePromptConfig
except Exception:
    import sys
    from os import path as os_path

    sys.path.append(os_path.dirname(os_path.dirname(os_path.dirname(os_path.abspath(__file__)))))
    import translation_languages
    from translation_utils import loadTranslatePromptConfig


DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_MODELS = ("deepseek-v4-flash", "deepseek-v4-pro")


class DeepSeekProviderError(RuntimeError):
    def __init__(
        self,
        category: str,
        status_code: int | None = None,
        retry_after: int | None = None,
    ) -> None:
        super().__init__(category)
        self.category = category
        self.status_code = status_code
        self.retry_after = retry_after


def _status_code(error: Exception) -> int | None:
    status_code = getattr(error, "status_code", None)
    if isinstance(status_code, int):
        return status_code
    response = getattr(error, "response", None)
    status_code = getattr(response, "status_code", None)
    return status_code if isinstance(status_code, int) else None


def _retry_after(error: Exception) -> int | None:
    headers = getattr(getattr(error, "response", None), "headers", None)
    if not isinstance(headers, dict):
        return None
    value = headers.get("Retry-After") or headers.get("retry-after")
    try:
        seconds = int(value)
    except (TypeError, ValueError):
        return None
    return seconds if seconds >= 0 else None


def _provider_error(error: Exception) -> DeepSeekProviderError:
    if isinstance(error, DeepSeekProviderError):
        return error
    if isinstance(error, TimeoutError):
        return DeepSeekProviderError("timeout")

    status_code = _status_code(error)
    if status_code == 401:
        return DeepSeekProviderError("invalid_credentials", status_code=401)
    if status_code == 402:
        return DeepSeekProviderError("insufficient_balance", status_code=402)
    if status_code == 429:
        return DeepSeekProviderError(
            "rate_limited",
            status_code=429,
            retry_after=_retry_after(error),
        )
    if status_code is not None and 500 <= status_code < 600:
        return DeepSeekProviderError("server_error", status_code=status_code)
    return DeepSeekProviderError("network_failure", status_code=status_code)


class DeepSeekClient:
    def __init__(self, root_path: str | None = None) -> None:
        prompt_config = loadTranslatePromptConfig(root_path, "translation_deepseek.yml")
        language_mapping = translation_languages.loadTranslationLanguages(
            path=root_path or ".",
        )
        self.api_key: str | None = None
        self.model = DEEPSEEK_MODELS[0]
        self.supported_languages = list(
            language_mapping["DeepSeek_API"]["source"].keys()
        )
        self.prompt_template = prompt_config["system_prompt"]
        self.history_cfg = {
            "use_history": False,
            "sources": [],
            "max_messages": 0,
            "max_chars": 0,
        }
        self._client: Any = None
        self.last_error: DeepSeekProviderError | None = None

    def getAuthKey(self) -> str | None:
        return self.api_key

    def getModelList(self) -> list[str]:
        return list(DEEPSEEK_MODELS)

    def getModel(self) -> str:
        return self.model

    def setModel(self, model: str) -> bool:
        if model not in DEEPSEEK_MODELS:
            return False
        self.model = model
        return True

    def testConnection(self) -> bool:
        self.last_error = None
        if not isinstance(self.api_key, str) or not self.api_key.strip():
            self.last_error = DeepSeekProviderError("not_configured")
            return False
        try:
            OpenAI(api_key=self.api_key, base_url=DEEPSEEK_BASE_URL).models.list()
        except Exception as error:
            self.last_error = _provider_error(error)
            return False
        return True

    def setAuthKey(self, api_key: str) -> bool:
        if not isinstance(api_key, str) or not api_key.strip():
            return False
        previous_key = self.api_key
        self.api_key = api_key
        if self.testConnection():
            return True
        self.api_key = previous_key
        return False

    def updateClient(self) -> None:
        if not isinstance(self.api_key, str) or not self.api_key.strip():
            self._client = None
            return
        self._client = OpenAI(api_key=self.api_key, base_url=DEEPSEEK_BASE_URL)

    def translate(
        self,
        text: str,
        input_lang: str,
        output_lang: str,
        timeout_seconds: float,
    ) -> str:
        if self._client is None:
            raise DeepSeekProviderError("not_configured")

        system_prompt = self.prompt_template.format(
            supported_languages=self.supported_languages,
            input_lang=input_lang,
            output_lang=output_lang,
        )
        request = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text},
            ],
            "stream": False,
            "extra_body": {"thinking": {"type": "disabled"}},
            "timeout": timeout_seconds,
        }
        deadline = monotonic() + max(float(timeout_seconds), 0.0)

        for attempt in range(2):
            try:
                response = self._client.chat.completions.create(**request)
                choices = getattr(response, "choices", None)
                if not isinstance(choices, list) or not choices:
                    raise DeepSeekProviderError("malformed_response")
                message = getattr(choices[0], "message", None)
                content = getattr(message, "content", None)
                if not isinstance(content, str) or not content.strip():
                    raise DeepSeekProviderError("malformed_response")
                return content.strip()
            except Exception as error:
                provider_error = _provider_error(error)
                retryable = provider_error.status_code in (500, 503)
                retryable = retryable or provider_error.category == "network_failure"
                if attempt == 0 and retryable and monotonic() < deadline:
                    continue
                raise provider_error

        raise DeepSeekProviderError("network_failure")
