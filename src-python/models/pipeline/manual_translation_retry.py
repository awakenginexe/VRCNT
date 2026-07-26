"""Asynchronous one-slot translation retries without final-output side effects."""

from __future__ import annotations

from copy import deepcopy
from threading import Event, Lock, Thread
from time import monotonic
from typing import Callable, Optional

from .pipeline_types import (
    ManualRetryAdmission,
    ManualTranslationRetryRequest,
    TranslationAttempt,
    TranslationStatus,
    TranslationUpdate,
)


class ManualTranslationRetryCoordinator:
    def __init__(
        self,
        *,
        translator: object,
        emit_update: Callable[[TranslationUpdate], None],
        transliterate: Callable[[str, str], tuple[dict[str, str], ...]],
        get_providers: Callable[[], tuple[str, ...]],
        get_weight_type: Callable[[], str],
        get_context_history: Callable[[], tuple[dict[str, object], ...]],
        local_fallback_enabled: Callable[[], bool],
        prepare_local_fallback: Callable[[], None],
        cloud_timeout_seconds: float = 5.0,
    ) -> None:
        self._translator = translator
        self._emit_update = emit_update
        self._transliterate = transliterate
        self._get_providers = get_providers
        self._get_weight_type = get_weight_type
        self._get_context_history = get_context_history
        self._local_fallback_enabled = local_fallback_enabled
        self._prepare_local_fallback = prepare_local_fallback
        self._cloud_timeout_seconds = cloud_timeout_seconds
        self._lock = Lock()
        self._active: set[tuple[str, str]] = set()
        self._generations: dict[tuple[str, str], int] = {}

    def submit(
        self,
        request: ManualTranslationRetryRequest,
    ) -> ManualRetryAdmission:
        key = (request.trace_id, request.target_slot)
        with self._lock:
            if key in self._active:
                return ManualRetryAdmission(False, None, {}, "retry_active")

        selected = tuple(
            provider
            for provider in self._get_providers()[:2]
            if isinstance(provider, str) and provider
        )
        selected_local = "CTranslate2" in selected
        cloud_providers = tuple(
            provider for provider in selected if provider != "CTranslate2"
        )
        get_cooldowns = getattr(
            self._translator,
            "getRateLimitedProviderCooldowns",
            None,
        )
        cooldowns = (
            dict(get_cooldowns(cloud_providers))
            if callable(get_cooldowns)
            else {}
        )
        ready_cloud = [
            provider for provider in cloud_providers
            if provider not in cooldowns
        ]
        try:
            local_enabled = selected_local or bool(
                self._local_fallback_enabled()
            )
        except Exception:
            local_enabled = selected_local

        if not ready_cloud and not local_enabled:
            return ManualRetryAdmission(
                False,
                None,
                cooldowns,
                "providers_rate_limited",
            )

        providers = list(ready_cloud)
        if local_enabled and "CTranslate2" not in providers:
            providers.append("CTranslate2")
        if not providers:
            return ManualRetryAdmission(
                False,
                None,
                cooldowns,
                "no_provider_configured",
            )

        with self._lock:
            if key in self._active:
                return ManualRetryAdmission(False, None, {}, "retry_active")
            generation = self._generations.get(key, 0) + 1
            self._generations[key] = generation
            self._active.add(key)

        queued = self._update(
            request,
            generation,
            TranslationStatus.QUEUED,
            providers[0],
        )
        try:
            self._emit_update(queued)
        except Exception:
            with self._lock:
                self._active.discard(key)
            return ManualRetryAdmission(False, None, {}, "emit_failed")

        Thread(
            target=self._run,
            args=(request, generation, tuple(providers)),
            name=f"manual-translation-{request.trace_id}-{request.target_slot}",
            daemon=True,
        ).start()
        return ManualRetryAdmission(True, generation, cooldowns, None)

    @staticmethod
    def _update(
        request: ManualTranslationRetryRequest,
        generation: int,
        status: TranslationStatus,
        engine: Optional[str],
        *,
        message: Optional[str] = None,
        transliteration: tuple[dict[str, str], ...] = (),
        duration_ms: Optional[int] = None,
        error_code: Optional[str] = None,
        failed_engines: tuple[str, ...] = (),
        retry_after_seconds: Optional[int] = None,
    ) -> TranslationUpdate:
        return TranslationUpdate(
            trace_id=request.trace_id,
            target_slot=request.target_slot,
            status=status,
            engine=engine,
            message=message,
            transliteration=transliteration,
            duration_ms=duration_ms,
            queue_position=0,
            error_code=error_code,
            failed_engines=failed_engines,
            retry_after_seconds=retry_after_seconds,
            retry_generation=generation,
        )

    def _attempt_with_deadline(
        self,
        request: ManualTranslationRetryRequest,
        provider: str,
        timeout_seconds: float,
    ) -> TranslationAttempt:
        result: dict[str, TranslationAttempt] = {}
        completed = Event()

        def run_attempt() -> None:
            try:
                result["attempt"] = self._translator.translateAttempt(
                    translator_name=provider,
                    weight_type=self._get_weight_type(),
                    source_language=request.source_language,
                    target_language=request.target.language,
                    target_country=request.target.country,
                    message=request.original_message,
                    context_history=list(deepcopy(self._get_context_history())),
                    timeout_seconds=timeout_seconds,
                )
            except Exception:
                result["attempt"] = TranslationAttempt(
                    TranslationStatus.ERROR,
                    provider,
                    None,
                    0,
                    "provider_error",
                )
            finally:
                completed.set()

        Thread(
            target=run_attempt,
            name=f"manual-{provider}-attempt",
            daemon=True,
        ).start()
        if completed.wait(timeout_seconds):
            return result.get("attempt") or TranslationAttempt(
                TranslationStatus.ERROR,
                provider,
                None,
                0,
                "provider_error",
            )

        remember_timeout = getattr(
            self._translator,
            "rememberProviderTimeout",
            None,
        )
        retry_after_seconds = None
        if callable(remember_timeout):
            try:
                retry_after_seconds = remember_timeout(provider)
            except Exception:
                retry_after_seconds = None
        return TranslationAttempt(
            TranslationStatus.TIMEOUT,
            provider,
            None,
            max(0, round(timeout_seconds * 1000)),
            "provider_timeout",
            retry_after_seconds,
        )

    def _run(
        self,
        request: ManualTranslationRetryRequest,
        generation: int,
        providers: tuple[str, ...],
    ) -> None:
        key = (request.trace_id, request.target_slot)
        failures: list[TranslationAttempt] = []
        cloud_deadline: Optional[float] = None
        provider_index = 0
        try:
            while provider_index < len(providers):
                provider = providers[provider_index]
                self._emit_update(
                    self._update(
                        request,
                        generation,
                        TranslationStatus.SENDING,
                        provider,
                    )
                )
                if provider == "CTranslate2":
                    try:
                        self._prepare_local_fallback()
                        attempt = self._translator.translateAttempt(
                            translator_name=provider,
                            weight_type=self._get_weight_type(),
                            source_language=request.source_language,
                            target_language=request.target.language,
                            target_country=request.target.country,
                            message=request.original_message,
                            context_history=list(
                                deepcopy(self._get_context_history())
                            ),
                            timeout_seconds=self._cloud_timeout_seconds,
                        )
                    except Exception:
                        attempt = TranslationAttempt(
                            TranslationStatus.ERROR,
                            provider,
                            None,
                            0,
                            "provider_error",
                        )
                else:
                    if cloud_deadline is None:
                        cloud_deadline = (
                            monotonic() + self._cloud_timeout_seconds
                        )
                    remaining = max(0.0, cloud_deadline - monotonic())
                    if remaining <= 0:
                        attempt = TranslationAttempt(
                            TranslationStatus.TIMEOUT,
                            provider,
                            None,
                            0,
                            "provider_timeout",
                        )
                    else:
                        attempt = self._attempt_with_deadline(
                            request,
                            provider,
                            remaining,
                        )

                if (
                    attempt.status is TranslationStatus.SUCCESS
                    and attempt.message is not None
                ):
                    transliteration = self._transliterate(
                        attempt.message,
                        request.target.language,
                    )
                    self._emit_update(
                        self._update(
                            request,
                            generation,
                            TranslationStatus.SUCCESS,
                            attempt.engine,
                            message=attempt.message,
                            transliteration=transliteration,
                            duration_ms=attempt.duration_ms,
                        )
                    )
                    return

                failures.append(attempt)
                cloud_expired = (
                    provider != "CTranslate2"
                    and cloud_deadline is not None
                    and monotonic() >= cloud_deadline
                )
                if cloud_expired:
                    next_index = next(
                        (
                            index
                            for index in range(
                                provider_index + 1,
                                len(providers),
                            )
                            if providers[index] == "CTranslate2"
                        ),
                        len(providers),
                    )
                else:
                    next_index = provider_index + 1

                if next_index >= len(providers):
                    rate_limited = [
                        failure for failure in failures
                        if failure.error_code == "provider_rate_limited"
                    ]
                    retry_values = [
                        failure.retry_after_seconds
                        for failure in rate_limited
                        if failure.retry_after_seconds is not None
                    ]
                    all_rate_limited = (
                        bool(rate_limited)
                        and len(rate_limited) == len(failures)
                    )
                    self._emit_update(
                        self._update(
                            request,
                            generation,
                            (
                                attempt.status
                                if attempt.status in (
                                    TranslationStatus.TIMEOUT,
                                    TranslationStatus.ERROR,
                                )
                                else TranslationStatus.ERROR
                            ),
                            attempt.engine,
                            duration_ms=attempt.duration_ms,
                            error_code=(
                                "providers_rate_limited"
                                if all_rate_limited
                                else attempt.error_code or "provider_error"
                            ),
                            failed_engines=(
                                tuple(
                                    failure.engine
                                    for failure in rate_limited
                                )
                                if all_rate_limited
                                else ()
                            ),
                            retry_after_seconds=(
                                min(retry_values)
                                if retry_values
                                else attempt.retry_after_seconds
                            ),
                        )
                    )
                    return

                next_provider = providers[next_index]
                self._emit_update(
                    self._update(
                        request,
                        generation,
                        TranslationStatus.FALLBACK,
                        next_provider,
                    )
                )
                provider_index = next_index
        finally:
            with self._lock:
                self._active.discard(key)
