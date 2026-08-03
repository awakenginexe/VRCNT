from typing import Callable, Any, List, Optional
from copy import deepcopy
from time import monotonic, sleep
from queue import Empty
from subprocess import Popen
from threading import Condition, Event, RLock, Thread
from concurrent.futures import ThreadPoolExecutor, as_completed
import re
import uuid
from device_manager import device_manager
from config import config
from model import (
    collapseTranslationEngineSelection,
    model,
    normalizeTranslationEngineSelection,
)
try:
    from model import boundedTranslationProviderSnapshot
except ImportError:
    # Focused import tests replace ``model`` with a minimal compatibility stub.
    # Runtime imports always use Model's canonical bounded snapshot helper.
    def boundedTranslationProviderSnapshot(selection) -> tuple[str, ...]:
        values = (
            [selection]
            if isinstance(selection, str)
            else selection
            if isinstance(selection, (list, tuple))
            else []
        )
        providers = []
        for value in values:
            if not isinstance(value, str):
                continue
            provider = value.strip()
            if provider and provider not in providers:
                providers.append(provider)
            if len(providers) == 2:
                break
        return tuple(providers)
from utils import removeLog, printLog, errorLogging, isConnectedNetwork, isValidIpAddress, isAvailableWebSocketServer
from errors import DeviceUnavailableError, ErrorCode, VRCTError
from models.transcription.transcription_languages import transcription_lang
from models.transcription.transcription_language_policy import (
    normalize_language_slots,
    runtime_language_slots,
    transcription_language_capabilities,
)
from models.transcription.transcription_profile import (
    effective_transcription_profile,
    make_transcription_profile,
    merge_transcription_profile,
    normalize_transcription_profile,
)
from models.transcription.transcription_whisper import DEFAULT_WHISPER_WEIGHT_TYPE
from models.transcription.transcription_vosk import getVoskModelMeta
from models.transcription.transcription_parakeet import getParakeetModelMeta
from models.transcription.transcription_sensevoice import getSenseVoiceModelMeta
from models.pipeline.pipeline_types import (
    FinalOutputTask,
    LanguageSlotSnapshot,
    ManualTranslationRetryRequest,
    MessageFormatSnapshot,
    OutputConfigSnapshot,
    PipelineSource,
    PipelineStatusEvent,
    TranscriptionTrace,
    TranslationStatus,
    TranslationTarget,
    TranslationUpdate,
)
from models.pipeline.manual_translation_retry import ManualTranslationRetryCoordinator
from models.pipeline.latest_queue import LatestQueue, QueueClosed
from resource_usage import collect_resource_usage

class Controller:
    def __init__(self) -> None:
        # typed attributes to satisfy static type checkers
        self.init_mapping: dict = {}
        self.run_mapping: dict = {}
        # initialize with a no-op callable so callers can safely call self.run
        def _noop_run(status: int, endpoint: str, payload: Any = None) -> None:
            return None
        self.run: Callable[[int, str, Any], None] = _noop_run
        self.device_access_status: bool = True
        self._transcription_restart_lock = RLock()
        self._translation_activation_lock = RLock()
        self._transcription_shutdown_condition = Condition(
            self._transcription_restart_lock
        )
        self._transcription_shutdown_requested = Event()
        self._transcription_shutdown_state = "running"
        self._transcription_shutdown_response: Optional[dict] = None
        self._transcription_recovery_queue = LatestQueue(4)
        self._transcription_recovery_stop_event = Event()
        self._transcription_recovery_thread = Thread(
            target=self._coordinateTranscriptionRecovery,
            name="transcription-recovery-coordinator",
            daemon=True,
        )
        self._transcription_metric_callback_registered = False
        self._manual_translation_retry = None
        register_recovery = getattr(
            model,
            "setTranscriptionRecoveryCallback",
            None,
        )
        if callable(register_recovery):
            register_recovery(self._offerTranscriptionRecoveryRequest)
        register_metric = getattr(
            model,
            "setTranscriptionPipelineMetricCallback",
            None,
        )
        if callable(register_metric):
            try:
                register_metric(self._emitPipelineStatus)
                self._transcription_metric_callback_registered = True
            except Exception:
                errorLogging()
        self._transcription_recovery_thread.start()

    def _offerTranscriptionRecoveryRequest(
        self,
        source: PipelineSource,
        generation: int,
        error_code: str,
        safe_to_restart: Event,
    ) -> None:
        # This is called from inference cleanup and must never block that worker.
        self._transcription_recovery_queue.offer(
            (source, generation, error_code, safe_to_restart)
        )

    def _coordinateTranscriptionRecovery(self) -> None:
        while not self._transcription_recovery_stop_event.is_set():
            try:
                request = self._transcription_recovery_queue.get(timeout=0.1)
            except Empty:
                continue
            except QueueClosed:
                break

            # Coalesce a burst, but never let a newer stale identity discard an
            # older request that is still both current and active.
            request = self._newestCurrentTranscriptionRecoveryRequest(
                [request, *self._transcription_recovery_queue.drain()]
            )
            while request is not None:
                source, generation, error_code, safe_to_restart = request
                if not self._isTranscriptionRecoveryRequestCurrent(request):
                    break
                if safe_to_restart.wait(0.1):
                    if (
                        not self._transcription_recovery_stop_event.is_set()
                        and self._isTranscriptionRecoveryRequestCurrent(request)
                    ):
                        try:
                            recovery_outcome = self._requestCoordinatedTranscriptionRestart(
                                error_code,
                                expected_source=source,
                                expected_generation=generation,
                            )
                        except Exception:
                            errorLogging()
                            recovery_outcome = False
                        try:
                            if recovery_outcome is True:
                                model.recordTranscriptionRecovery(
                                    source,
                                    error_code,
                                )
                            elif recovery_outcome is False:
                                model.recordTranscriptionRecoveryFailure(
                                    source,
                                    error_code,
                                )
                        except Exception:
                            errorLogging()
                    break
                if self._transcription_recovery_stop_event.is_set():
                    return
                pending = self._transcription_recovery_queue.drain()
                if pending:
                    request = self._newestCurrentTranscriptionRecoveryRequest(
                        [request, *pending]
                    )

    @staticmethod
    def _isTranscriptionRecoveryRequestCurrent(request) -> bool:
        source, generation, _error_code, _safe_to_restart = request
        is_current = getattr(model, "isSourcePipelineGenerationCurrent", None)
        is_active = getattr(model, "isTranscriptionSourceActive", None)
        if not callable(is_current) or not callable(is_active):
            return False
        try:
            return bool(is_current(source, generation)) and bool(is_active(source))
        except Exception:
            errorLogging()
            return False

    @classmethod
    def _newestCurrentTranscriptionRecoveryRequest(cls, requests):
        for request in reversed(requests):
            if cls._isTranscriptionRecoveryRequestCurrent(request):
                return request
        return None

    @staticmethod
    def _translationResultViews(
        translation,
        success,
    ) -> tuple[list[str], list[str], list[int]]:
        """Build string response slots and a compact successful-output view."""
        translation_values = translation if isinstance(translation, (list, tuple)) else []
        success_values = success if isinstance(success, (list, tuple)) else []
        slots = []
        successful = []
        successful_indices = []
        for index, value in enumerate(translation_values):
            is_success = (
                index < len(success_values)
                and success_values[index] is True
                and isinstance(value, str)
                and bool(value)
            )
            slot = value if is_success else ""
            slots.append(slot)
            if slot:
                successful.append(slot)
                successful_indices.append(index)
        return slots, successful, successful_indices

    @staticmethod
    def _translationTargetItems(target_languages) -> list[tuple[Any, dict]]:
        if not isinstance(target_languages, dict):
            return []
        return [
            (key, value)
            for key, value in target_languages.items()
            if (
                isinstance(value, dict)
                and value.get("enable", True) is True
                and (value.get("language") is not None or value.get("country") is not None)
            )
        ]

    @classmethod
    def _successfulTargetMetadata(cls, target_languages, successful_indices: list[int]) -> dict:
        target_items = cls._translationTargetItems(target_languages)
        return {
            key: value
            for index, (key, value) in enumerate(target_items)
            if index in successful_indices
        }

    @staticmethod
    def _successfulTransliterationView(
        translation_slots: list[str],
        transliteration_slots: list[Any],
    ) -> list[Any]:
        return [
            transliteration
            for translation, transliteration in zip(translation_slots, transliteration_slots)
            if translation
        ]

    @staticmethod
    def _snapshotLanguageSlots(languages) -> tuple[LanguageSlotSnapshot, ...]:
        if not isinstance(languages, dict):
            return ()
        return tuple(
            LanguageSlotSnapshot(
                target_slot=str(slot),
                language=value.get("language"),
                country=value.get("country"),
                enabled=value.get("enable") is True,
            )
            for slot, value in languages.items()
            if isinstance(value, dict)
        )

    @staticmethod
    def _snapshotMessageFormat(format_parts) -> MessageFormatSnapshot:
        format_parts = format_parts if isinstance(format_parts, dict) else {}
        message = format_parts.get("message", {})
        translation = format_parts.get("translation", {})
        return MessageFormatSnapshot(
            message_prefix=message.get("prefix", ""),
            message_suffix=message.get("suffix", ""),
            translation_prefix=translation.get("prefix", ""),
            translation_suffix=translation.get("suffix", ""),
            translation_separator=translation.get("separator", ""),
            message_translation_separator=format_parts.get("separator", ""),
            translation_first=format_parts.get("translation_first") is True,
        )

    @staticmethod
    def _formatSnapshotMessage(
        format_snapshot: MessageFormatSnapshot,
        translations: list[str],
        message: str,
    ) -> str:
        message_part = (
            format_snapshot.message_prefix
            + message
            + format_snapshot.message_suffix
        )
        translation_part = (
            format_snapshot.translation_prefix
            + format_snapshot.translation_separator.join(translations)
            + format_snapshot.translation_suffix
        )
        if translations and message:
            if format_snapshot.translation_first:
                return (
                    translation_part
                    + format_snapshot.message_translation_separator
                    + message_part
                )
            return (
                message_part
                + format_snapshot.message_translation_separator
                + translation_part
            )
        if translations:
            return translation_part
        return message_part

    @staticmethod
    def _languageMap(
        snapshots: tuple[LanguageSlotSnapshot, ...],
        slots: Optional[set[str]] = None,
    ) -> dict[str, dict[str, object]]:
        return {
            snapshot.target_slot: {
                "language": snapshot.language,
                "country": snapshot.country,
                "enable": snapshot.enabled,
            }
            for snapshot in snapshots
            if slots is None or snapshot.target_slot in slots
        }

    @staticmethod
    def _primaryLanguage(
        snapshots: tuple[LanguageSlotSnapshot, ...],
    ) -> Optional[str]:
        for snapshot in snapshots:
            if snapshot.target_slot == "1":
                return snapshot.language
        for snapshot in snapshots:
            if snapshot.enabled:
                return snapshot.language
        return snapshots[0].language if snapshots else None

    def _outputConfigSnapshot(self) -> OutputConfigSnapshot:
        selected_tab_no = str(config.SELECTED_TAB_NO)
        your_languages = config.SELECTED_YOUR_LANGUAGES.get(selected_tab_no, {})
        your_translation_languages = config.SELECTED_YOUR_TRANSLATION_LANGUAGES.get(
            selected_tab_no,
            {},
        )
        target_languages = config.SELECTED_TARGET_LANGUAGES.get(selected_tab_no, {})
        return OutputConfigSnapshot(
            selected_tab_no=selected_tab_no,
            translation_enabled=config.ENABLE_TRANSLATION is True,
            send_message_to_vrc=config.SEND_MESSAGE_TO_VRC is True,
            send_received_message_to_vrc=config.SEND_RECEIVED_MESSAGE_TO_VRC is True,
            send_only_translated_messages=config.SEND_ONLY_TRANSLATED_MESSAGES is True,
            overlay_small_log=config.OVERLAY_SMALL_LOG is True,
            overlay_large_log=config.OVERLAY_LARGE_LOG is True,
            overlay_show_only_translated_messages=(
                config.OVERLAY_SHOW_ONLY_TRANSLATED_MESSAGES is True
            ),
            enable_clipboard=config.ENABLE_CLIPBOARD is True,
            logger_feature=config.LOGGER_FEATURE is True,
            convert_message_to_hiragana=config.CONVERT_MESSAGE_TO_HIRAGANA is True,
            convert_message_to_romaji=config.CONVERT_MESSAGE_TO_ROMAJI is True,
            websocket_requested=config.WEBSOCKET_SERVER is True,
            your_languages=self._snapshotLanguageSlots(your_languages),
            your_translation_languages=self._snapshotLanguageSlots(
                your_translation_languages
            ),
            target_languages=self._snapshotLanguageSlots(target_languages),
            send_format=self._snapshotMessageFormat(config.SEND_MESSAGE_FORMAT_PARTS),
            received_format=self._snapshotMessageFormat(
                config.RECEIVED_MESSAGE_FORMAT_PARTS
            ),
        )

    def _emitInitialTranscriptionTrace(self, trace: TranscriptionTrace) -> None:
        endpoint_key = (
            "transcription_mic"
            if trace.source is PipelineSource.MIC
            else "transcription_speaker"
        )
        endpoint = self.run_mapping.get(
            endpoint_key,
            (
                "/run/transcription_send_mic_message"
                if trace.source is PipelineSource.MIC
                else "/run/transcription_receive_speaker_message"
            ),
        )
        engine = trace.providers[0] if trace.providers else None
        payload = {
            "trace_id": trace.trace_id,
            "source_language": trace.source_language,
            "original": {
                "message": trace.original_message,
                "transliteration": list(trace.original_transliteration),
            },
            "translations": [
                {
                    "target_slot": target.target_slot,
                    "language": target.language,
                    "country": target.country,
                    "message": None,
                    "transliteration": [],
                    "status": TranslationStatus.QUEUED.value,
                    "engine": engine,
                    "duration_ms": None,
                }
                for target in trace.targets
            ],
        }
        if not self._generationCurrent(trace):
            return
        self.run(200, endpoint, payload)

    def _beginTranscriptionTrace(
        self,
        source: PipelineSource,
        result: dict,
    ) -> None:
        message = result["text"]
        language = result["language"]
        if isinstance(message, bool) and message is False:
            self.run(
                400,
                self.run_mapping.get("error_device", "/run/error_device"),
                {"message": f"No {source.value} device detected", "data": None},
            )
            return
        if not isinstance(message, str) or not message:
            return
        if model.checkKeywords(message):
            self.run(
                200,
                self.run_mapping.get("word_filter", "/run/word_filter"),
                {"message": f"Detected by word filter: {message}"},
            )
            return
        repeat = (
            model.detectRepeatSendMessage(message)
            if source is PipelineSource.MIC
            else model.detectRepeatReceiveMessage(message)
        )
        if repeat:
            return

        output_config = self._outputConfigSnapshot()
        target_snapshots = (
            output_config.target_languages
            if source is PipelineSource.MIC
            else output_config.your_translation_languages[:1]
        )
        targets = ()
        if output_config.translation_enabled:
            targets = tuple(
                TranslationTarget(
                    target_slot=snapshot.target_slot,
                    language=snapshot.language,
                    country=snapshot.country,
                )
                for snapshot in target_snapshots
                if snapshot.enabled
                and (snapshot.language is not None or snapshot.country is not None)
            )
        providers = boundedTranslationProviderSnapshot(
            config.SELECTED_TRANSLATION_ENGINES.get(output_config.selected_tab_no)
        )
        original_transliteration = model.transliterateTranscriptionMessage(
            message,
            language,
            output_config,
        )
        generation = model.getSourcePipelineGeneration(source)
        pipeline = model.getSourcePipeline(source)
        if pipeline is None or generation is None:
            raise RuntimeError(
                f"{source.value} source pipeline must be started before transcription"
            )
        trace = TranscriptionTrace(
            trace_id=f"{source.value}-{uuid.uuid4()}",
            generation=generation,
            source=source,
            original_message=message,
            source_language=language,
            original_transliteration=tuple(deepcopy(original_transliteration)),
            targets=targets,
            providers=providers,
            ctranslate2_weight_type=config.CTRANSLATE2_WEIGHT_TYPE,
            context_history=tuple(deepcopy(model.getTranslationHistory())),
            started_at_monotonic=result.get("started_at_monotonic", monotonic()),
            output_config=output_config,
        )
        pipeline.submit_trace(trace)

    def _emitTranslationUpdate(self, update: TranslationUpdate) -> None:
        self.run(
            200,
            self.run_mapping.get(
                "transcription_translation_update",
                "/run/transcription_translation_update",
            ),
            update.to_payload(),
        )

    def _emitTranslationProviderCooldowns(self, cooldowns: dict) -> None:
        selected = set(model._getSelectedTranslationEngineCandidates())
        visible_cooldowns = {
            provider: value
            for provider, value in cooldowns.items()
            if provider in selected
        }
        self.run(
            200,
            self.run_mapping.get(
                "translation_provider_cooldowns",
                "/run/translation_provider_cooldowns",
            ),
            visible_cooldowns,
        )

    def _getManualTranslationRetry(self) -> ManualTranslationRetryCoordinator:
        model.ensure_initialized()
        if self._manual_translation_retry is None:
            model.translator.setProviderCooldownCallback(
                self._emitTranslationProviderCooldowns
            )
            self._manual_translation_retry = ManualTranslationRetryCoordinator(
                translator=model.translator,
                emit_update=self._emitTranslationUpdate,
                transliterate=lambda message, language: (
                    model.transliterateTranscriptionMessage(
                        message,
                        language,
                        self._outputConfigSnapshot(),
                    )
                ),
                get_providers=model._getSelectedTranslationEngineCandidates,
                get_weight_type=lambda: config.CTRANSLATE2_WEIGHT_TYPE,
                get_context_history=lambda: tuple(
                    deepcopy(model.getTranslationHistory())
                ),
                local_fallback_enabled=lambda: (
                    config.ENABLE_CTRANSLATE2_AUTO_FALLBACK is True
                ),
                prepare_local_fallback=model.prepareCTranslate2AutoFallback,
            )
        return self._manual_translation_retry

    def getTranslationProviderCooldowns(self, *args, **kwargs) -> dict:
        model.ensure_initialized()
        model.translator.setProviderCooldownCallback(
            self._emitTranslationProviderCooldowns
        )
        providers = model._getSelectedTranslationEngineCandidates()
        return {
            "status": 200,
            "result": model.translator.getProviderCooldownSnapshot(providers),
        }

    def retryTranslation(self, payload, *args, **kwargs) -> dict:
        if not isinstance(payload, dict):
            return {
                "status": 400,
                "result": {"accepted": False, "reason": "invalid_request"},
            }
        required = (
            "trace_id",
            "target_slot",
            "original_message",
            "source_language",
            "target_language",
            "target_country",
        )
        if any(
            not isinstance(payload.get(name), str) or not payload[name]
            for name in required
        ):
            return {
                "status": 400,
                "result": {"accepted": False, "reason": "invalid_request"},
            }
        admission = self._getManualTranslationRetry().submit(
            ManualTranslationRetryRequest(
                trace_id=payload["trace_id"],
                target_slot=payload["target_slot"],
                original_message=payload["original_message"],
                source_language=payload["source_language"],
                target=TranslationTarget(
                    payload["target_slot"],
                    payload["target_language"],
                    payload["target_country"],
                ),
            )
        )
        return {
            "status": 200,
            "result": {
                "accepted": admission.accepted,
                "retry_generation": admission.retry_generation,
                "cooldowns": admission.cooldowns,
                "reason": admission.reason,
            },
        }

    def _emitPipelineStatus(self, event: PipelineStatusEvent) -> None:
        self.run(
            200,
            self.run_mapping.get("pipeline_status", "/run/pipeline_status"),
            event.to_payload(),
        )

    @staticmethod
    def _sourcePipelineGeneration(source: PipelineSource) -> int:
        return model.nextSourcePipelineGeneration(source)

    def _sourcePipelineCallbacks(self, source: PipelineSource) -> dict[str, Callable]:
        return {
            "emit_initial": self._emitInitialTranscriptionTrace,
            "emit_update": self._emitTranslationUpdate,
            "emit_metric": self._emitPipelineStatus,
            "emit_final": (
                self._finalizeMicOutput
                if source is PipelineSource.MIC
                else self._finalizeSpeakerOutput
            ),
        }

    @staticmethod
    def _successfulOutputViews(
        task: FinalOutputTask,
        language_snapshots: tuple[LanguageSlotSnapshot, ...],
    ) -> tuple[
        list[str],
        dict[str, dict[str, object]],
        list[list[dict[str, str]]],
        list[str],
    ]:
        target_by_slot = {target.target_slot: target for target in task.targets}
        successful_pairs = [
            (target_by_slot[update.target_slot], update)
            for update in task.translations
            if update.status is TranslationStatus.SUCCESS
            and update.target_slot in target_by_slot
            and isinstance(update.message, str)
            and bool(update.message)
        ]
        successful_translations = [
            update.message for _, update in successful_pairs
        ]
        destination_languages = Controller._languageMap(language_snapshots)
        successful_transliterations = [
            list(update.transliteration) for _, update in successful_pairs
        ]
        successful_target_slots = [
            target.target_slot for target, _ in successful_pairs
        ]
        return (
            successful_translations,
            destination_languages,
            successful_transliterations,
            successful_target_slots,
        )

    @staticmethod
    def _translationFailed(task: FinalOutputTask) -> bool:
        if not task.output_config.translation_enabled or not task.targets:
            return False
        terminal_by_slot = {
            update.target_slot: update for update in task.translations
        }
        return any(
            target.target_slot not in terminal_by_slot
            or terminal_by_slot[target.target_slot].status
            is not TranslationStatus.SUCCESS
            for target in task.targets
        )

    @staticmethod
    def _generationCurrent(task: FinalOutputTask) -> bool:
        try:
            return bool(
                model.isSourcePipelineGenerationCurrent(task.source, task.generation)
            )
        except Exception:
            try:
                errorLogging()
            except Exception:
                pass
            return False

    def _attemptFinalOutputSink(
        self,
        task: FinalOutputTask,
        sink_name: str,
        failures: list[str],
        callback: Callable[[], None],
    ) -> bool:
        if not self._generationCurrent(task):
            return False
        try:
            callback()
        except Exception:
            try:
                errorLogging()
            except Exception:
                pass
            if sink_name not in failures:
                failures.append(sink_name)
        return self._generationCurrent(task)

    @staticmethod
    def _raiseFinalOutputFailures(failures: list[str]) -> None:
        if failures:
            raise RuntimeError(
                "final output sinks failed: " + ", ".join(failures)
            ) from None

    @staticmethod
    def _rateLimitFailureData(
        task: Optional[FinalOutputTask] = None,
    ) -> Optional[dict]:
        if task is None:
            try:
                status = model.getSelectedTranslationRateLimitStatus()
                return status if isinstance(status, dict) else None
            except Exception:
                return None

        failures = tuple(task.translations)
        if not failures or any(
            item.error_code != "providers_rate_limited"
            for item in failures
        ):
            return None
        engines = []
        retry_values = []
        for failure in failures:
            for engine in failure.failed_engines:
                if engine not in engines:
                    engines.append(engine)
            if failure.retry_after_seconds is not None:
                retry_values.append(failure.retry_after_seconds)
        if not engines:
            return None
        return {
            "reason": "rate_limited",
            "engines": engines,
            "retry_after_seconds": (
                min(retry_values) if retry_values else None
            ),
        }

    def _emitTranslationFailure(self, task: FinalOutputTask) -> None:
        failure_data = self._rateLimitFailureData(task)
        if task.source is PipelineSource.MIC:
            if not self._generationCurrent(task):
                return
            self.run(
                400,
                self.run_mapping.get(
                    "error_translation_engine",
                    "/run/error_translation_engine",
                ),
                {
                    "message": "Translation engine limit error",
                    "data": failure_data,
                },
            )
            return
        error_response = VRCTError.create_error_response(
            ErrorCode.TRANSLATION_ENGINE_LIMIT,
            data=failure_data,
        )
        if not self._generationCurrent(task):
            return
        self.run(
            error_response["status"],
            self.run_mapping.get(
                "error_translation_engine",
                "/run/error_translation_engine",
            ),
            error_response["result"],
        )

    def _finalizeMicOutput(self, task: FinalOutputTask) -> None:
        output_config = task.output_config
        (
            successful_translations,
            destination_languages,
            successful_transliterations,
            successful_target_slots,
        ) = self._successfulOutputViews(task, output_config.target_languages)
        original_transliteration = list(task.original_transliteration)
        failures: list[str] = []

        if not self._attemptFinalOutputSink(
            task,
            "telemetry",
            failures,
            lambda: model.telemetryTrackCoreFeature("mic_speech_to_text"),
        ):
            return
        if output_config.translation_enabled:
            if not self._attemptFinalOutputSink(
                task,
                "telemetry",
                failures,
                lambda: model.telemetryTrackCoreFeature("translation"),
            ):
                return
        if self._translationFailed(task):
            if not self._attemptFinalOutputSink(
                task,
                "translation_error",
                failures,
                lambda: self._emitTranslationFailure(task),
            ):
                return

        if output_config.send_message_to_vrc:
            osc_eligible = (
                not output_config.send_only_translated_messages
                or not output_config.translation_enabled
                or bool(successful_translations)
            )
            if osc_eligible:
                def send_osc() -> None:
                    if output_config.send_only_translated_messages:
                        if not output_config.translation_enabled:
                            osc_message = self._formatSnapshotMessage(
                                output_config.send_format,
                                [],
                                task.original_message,
                            )
                        else:
                            osc_message = self._formatSnapshotMessage(
                                output_config.send_format,
                                successful_translations,
                                "",
                            )
                    else:
                        osc_message = self._formatSnapshotMessage(
                            output_config.send_format,
                            successful_translations,
                            task.original_message,
                        )
                    if self._generationCurrent(task):
                        model.oscSendMessage(osc_message)

                if not self._attemptFinalOutputSink(
                    task,
                    "osc",
                    failures,
                    send_osc,
                ):
                    return

        if output_config.overlay_large_log:
            def update_large_overlay() -> None:
                if not self._is_overlay_available():
                    return
                if (
                    output_config.overlay_show_only_translated_messages
                    and not successful_translations
                ):
                    return
                if not self._generationCurrent(task):
                    return
                if output_config.overlay_show_only_translated_messages:
                    overlay_image = model.createOverlayImageLargeLog(
                        "send",
                        None,
                        None,
                        successful_translations,
                        destination_languages,
                        original_transliteration,
                        successful_transliterations,
                        successful_target_slots,
                    )
                else:
                    overlay_image = model.createOverlayImageLargeLog(
                        "send",
                        task.original_message,
                        self._primaryLanguage(output_config.your_languages),
                        successful_translations,
                        destination_languages,
                        original_transliteration,
                        successful_transliterations,
                        successful_target_slots,
                    )
                if self._generationCurrent(task):
                    model.updateOverlayLargeLog(overlay_image)

            if not self._attemptFinalOutputSink(
                task,
                "overlay_large",
                failures,
                update_large_overlay,
            ):
                return

        if output_config.enable_clipboard:
            def update_clipboard() -> None:
                clipboard_message = self._formatSnapshotMessage(
                    output_config.send_format,
                    successful_translations,
                    task.original_message,
                )
                if self._generationCurrent(task):
                    model.setCopyToClipboardAndPasteFromClipboard(clipboard_message)

            if not self._attemptFinalOutputSink(
                task,
                "clipboard",
                failures,
                update_clipboard,
            ):
                return

        if output_config.websocket_requested:
            def send_websocket() -> None:
                if not model.checkWebSocketServerAlive():
                    return
                if self._generationCurrent(task):
                    model.websocketSendMessage(
                        {
                            "type": "SENT",
                            "src_languages": self._languageMap(
                                output_config.your_languages
                            ),
                            "dst_languages": destination_languages,
                            "message": task.original_message,
                            "translation": successful_translations,
                            "translation_target_slots": successful_target_slots,
                            "transliteration": successful_transliterations,
                        }
                    )

            if not self._attemptFinalOutputSink(
                task,
                "websocket",
                failures,
                send_websocket,
            ):
                return

        if output_config.logger_feature:
            translation_text = (
                f" ({'/'.join(successful_translations)})"
                if successful_translations
                else ""
            )
            if not self._attemptFinalOutputSink(
                task,
                "logger",
                failures,
                lambda: model.logger.info(
                    f"[SENT] {task.original_message}{translation_text}"
                ),
            ):
                return

        if not self._attemptFinalOutputSink(
            task,
            "history",
            failures,
            lambda: model.addTranslationHistory("mic", task.original_message),
        ):
            return
        self._raiseFinalOutputFailures(failures)

    def _finalizeSpeakerOutput(self, task: FinalOutputTask) -> None:
        output_config = task.output_config
        (
            successful_translations,
            destination_languages,
            successful_transliterations,
            successful_target_slots,
        ) = self._successfulOutputViews(
            task,
            output_config.your_translation_languages,
        )
        original_transliteration = list(task.original_transliteration)
        failures: list[str] = []

        if not self._attemptFinalOutputSink(
            task,
            "telemetry",
            failures,
            lambda: model.telemetryTrackCoreFeature("speaker_speech_to_text"),
        ):
            return
        if output_config.translation_enabled:
            if not self._attemptFinalOutputSink(
                task,
                "telemetry",
                failures,
                lambda: model.telemetryTrackCoreFeature("translation"),
            ):
                return
        if self._translationFailed(task):
            if not self._attemptFinalOutputSink(
                task,
                "translation_error",
                failures,
                lambda: self._emitTranslationFailure(task),
            ):
                return

        if output_config.overlay_small_log:
            def update_small_overlay() -> None:
                if not self._is_overlay_available():
                    return
                if (
                    output_config.overlay_show_only_translated_messages
                    and not successful_translations
                ):
                    return
                if not self._generationCurrent(task):
                    return
                if output_config.overlay_show_only_translated_messages:
                    overlay_image = model.createOverlayImageSmallLog(
                        None,
                        None,
                        successful_translations,
                        destination_languages,
                        original_transliteration,
                        successful_transliterations,
                        successful_target_slots,
                    )
                else:
                    overlay_image = model.createOverlayImageSmallLog(
                        task.original_message,
                        task.source_language,
                        successful_translations,
                        destination_languages,
                        original_transliteration,
                        successful_transliterations,
                        successful_target_slots,
                    )
                if self._generationCurrent(task):
                    model.updateOverlaySmallLog(overlay_image)

            if not self._attemptFinalOutputSink(
                task,
                "overlay_small",
                failures,
                update_small_overlay,
            ):
                return

        if output_config.overlay_large_log:
            def update_large_overlay() -> None:
                if not self._is_overlay_available():
                    return
                if (
                    output_config.overlay_show_only_translated_messages
                    and not successful_translations
                ):
                    return
                if not self._generationCurrent(task):
                    return
                if output_config.overlay_show_only_translated_messages:
                    overlay_image = model.createOverlayImageLargeLog(
                        "receive",
                        None,
                        None,
                        successful_translations,
                        destination_languages,
                        original_transliteration,
                        successful_transliterations,
                        successful_target_slots,
                    )
                else:
                    overlay_image = model.createOverlayImageLargeLog(
                        "receive",
                        task.original_message,
                        task.source_language,
                        successful_translations,
                        destination_languages,
                        original_transliteration,
                        successful_transliterations,
                        successful_target_slots,
                    )
                if self._generationCurrent(task):
                    model.updateOverlayLargeLog(overlay_image)

            if not self._attemptFinalOutputSink(
                task,
                "overlay_large",
                failures,
                update_large_overlay,
            ):
                return

        if output_config.send_received_message_to_vrc:
            osc_eligible = (
                not output_config.send_only_translated_messages
                or not output_config.translation_enabled
                or bool(successful_translations)
            )
            if osc_eligible:
                def send_osc() -> None:
                    if output_config.send_only_translated_messages:
                        if not output_config.translation_enabled:
                            osc_message = self._formatSnapshotMessage(
                                output_config.received_format,
                                [],
                                task.original_message,
                            )
                        else:
                            osc_message = self._formatSnapshotMessage(
                                output_config.received_format,
                                successful_translations,
                                "",
                            )
                    else:
                        osc_message = self._formatSnapshotMessage(
                            output_config.received_format,
                            successful_translations,
                            task.original_message,
                        )
                    if self._generationCurrent(task):
                        model.oscSendMessage(osc_message)

                if not self._attemptFinalOutputSink(
                    task,
                    "osc",
                    failures,
                    send_osc,
                ):
                    return

        if output_config.websocket_requested:
            def send_websocket() -> None:
                if not model.checkWebSocketServerAlive():
                    return
                if self._generationCurrent(task):
                    model.websocketSendMessage(
                        {
                            "type": "RECEIVED",
                            "src_languages": self._languageMap(
                                output_config.target_languages
                            ),
                            "dst_languages": destination_languages,
                            "message": task.original_message,
                            "translation": successful_translations,
                            "translation_target_slots": successful_target_slots,
                            "transliteration": successful_transliterations,
                        }
                    )

            if not self._attemptFinalOutputSink(
                task,
                "websocket",
                failures,
                send_websocket,
            ):
                return

        if output_config.logger_feature:
            translation_text = (
                f" ({'/'.join(successful_translations)})"
                if successful_translations
                else ""
            )
            if not self._attemptFinalOutputSink(
                task,
                "logger",
                failures,
                lambda: model.logger.info(
                    f"[RECEIVED] {task.original_message}{translation_text}"
                ),
            ):
                return

        if not self._attemptFinalOutputSink(
            task,
            "history",
            failures,
            lambda: model.addTranslationHistory("speaker", task.original_message),
        ):
            return
        self._raiseFinalOutputFailures(failures)

    def _startupWhisperWeightType(self) -> str:
        selectable_weights = config.SELECTABLE_WHISPER_WEIGHT_TYPE_DICT
        if config.WHISPER_WEIGHT_TYPE in selectable_weights:
            return config.WHISPER_WEIGHT_TYPE
        if DEFAULT_WHISPER_WEIGHT_TYPE in selectable_weights:
            return DEFAULT_WHISPER_WEIGHT_TYPE
        return next(iter(selectable_weights), config.WHISPER_WEIGHT_TYPE)

    def _fallbackSelectedWhisperWeight(self, fallback_weight_type: str, fallback_available: bool) -> None:
        if fallback_available is False or not fallback_weight_type:
            return
        profiles_available = all(
            isinstance(getattr(config, name, None), dict)
            for name in ("TRANSCRIPTION_PROFILE_SEND", "TRANSCRIPTION_PROFILE_RECEIVE")
        )
        if profiles_available:
            for source in (PipelineSource.MIC, PipelineSource.SPEAKER):
                profile = self._getSourceTranscriptionProfile(source)
                selected = profile["models"]["Whisper"]
                if (
                    selected != fallback_weight_type
                    and model.checkTranscriptionWhisperModelWeight(selected) is False
                ):
                    profile["models"]["Whisper"] = fallback_weight_type
                    setattr(config, self._sourceTranscriptionProfileName(source), profile)
                    self._syncSourceTranscriptionCompatibilityFields(source)
            self._syncLegacyTranscriptionSettingsFromSend()
            return
        selected_weight_type = config.WHISPER_WEIGHT_TYPE
        if (
            selected_weight_type != fallback_weight_type
            and model.checkTranscriptionWhisperModelWeight(selected_weight_type) is False
        ):
            config.WHISPER_WEIGHT_TYPE = fallback_weight_type

    def _is_overlay_available(self) -> bool:
        """Safe check whether overlay is present and should receive updates.

        If OpenVR drops the overlay, the next update should be allowed to
        restart it instead of silently skipping all future overlay messages.
        """
        try:
            overlay = getattr(model, "overlay", None)
            if overlay is None:
                return False
            if getattr(overlay, "initialized", False) is False:
                model.startOverlay()
            return True
        except Exception:
            errorLogging()
            return False

    def _transcriptionLanguageCode(self, engine: str, language_data: dict) -> str:
        try:
            language = language_data.get("language")
            country = language_data.get("country")
            return transcription_lang[language][country].get(engine, "")
        except Exception:
            return ""

    def _transcriptionSupportedLanguageCodes(
        self,
        engine: str,
        source: Optional[PipelineSource] = None,
    ) -> Optional[set]:
        models = (
            self._getSourceTranscriptionProfile(source)["models"]
            if source is not None
            else self._legacyTranscriptionProfile()["models"]
        )
        if engine == "Vosk":
            meta = getVoskModelMeta(models["Vosk"])
        elif engine == "Parakeet":
            meta = getParakeetModelMeta(models["Parakeet"])
        elif engine == "SenseVoice":
            meta = getSenseVoiceModelMeta(models["SenseVoice"])
        else:
            return None

        languages = meta.get("languages")
        if not languages and meta.get("language"):
            languages = [meta["language"]]
        return set(languages or [])

    def _isTranscriptionLanguageSupported(
        self,
        language_data: dict,
        engine: Optional[str] = None,
        source: Optional[PipelineSource] = None,
    ) -> bool:
        engine = engine or config.SELECTED_TRANSCRIPTION_ENGINE
        if engine not in {"Vosk", "Parakeet", "SenseVoice"}:
            return True

        language_code = self._transcriptionLanguageCode(engine, language_data)
        supported_codes = self._transcriptionSupportedLanguageCodes(engine, source)
        return bool(language_code and supported_codes and language_code in supported_codes)

    def _selectedTabLanguagesSupported(
        self,
        selected_languages: dict,
        only_enabled: bool = True,
        direction: str = "microphone",
    ) -> bool:
        tab_languages = selected_languages.get(config.SELECTED_TAB_NO, {})
        source = (
            PipelineSource.SPEAKER
            if direction in {"received", "speaker"}
            else PipelineSource.MIC
        )
        engine = self._getSourceTranscriptionEngine(source)
        language_values = (
            runtime_language_slots(engine, tab_languages, direction)
            if only_enabled
            else tab_languages.values()
        )
        for language_data in language_values:
            if only_enabled and language_data.get("enable") is not True:
                continue
            if self._isTranscriptionLanguageSupported(language_data, engine, source) is False:
                return False
        return True

    def _findFirstSupportedTranscriptionLanguage(self) -> Optional[dict]:
        preferred = [
            ("English", "United States"),
            ("Japanese", "Japan"),
            ("Korean", "South Korea"),
            ("Chinese Simplified", "China"),
            ("French", "France"),
            ("Spanish", "Spain"),
            ("German", "Germany"),
        ]

        for language, country in preferred:
            language_data = {"language": language, "country": country, "enable": True}
            if self._isTranscriptionLanguageSupported(language_data):
                return language_data

        for language, countries in transcription_lang.items():
            for country in countries.keys():
                language_data = {"language": language, "country": country, "enable": True}
                if self._isTranscriptionLanguageSupported(language_data):
                    return language_data
        return None

    @staticmethod
    def _sourceTranscriptionRuntimeSettingNames(
        source: Optional[PipelineSource],
    ) -> tuple[str, str, str, str, str]:
        if source is PipelineSource.MIC:
            return (
                "SELECTED_TRANSCRIPTION_ENGINE_SEND",
                "SELECTED_TRANSCRIPTION_COMPUTE_DEVICE_SEND",
                "SELECTED_TRANSCRIPTION_COMPUTE_TYPE_SEND",
                "selected_transcription_compute_device_send",
                "selected_transcription_compute_type_send",
            )
        if source is PipelineSource.SPEAKER:
            return (
                "SELECTED_TRANSCRIPTION_ENGINE_RECEIVE",
                "SELECTED_TRANSCRIPTION_COMPUTE_DEVICE_RECEIVE",
                "SELECTED_TRANSCRIPTION_COMPUTE_TYPE_RECEIVE",
                "selected_transcription_compute_device_receive",
                "selected_transcription_compute_type_receive",
            )
        return (
            "SELECTED_TRANSCRIPTION_ENGINE",
            "SELECTED_TRANSCRIPTION_COMPUTE_DEVICE",
            "SELECTED_TRANSCRIPTION_COMPUTE_TYPE",
            "selected_transcription_compute_device",
            "selected_transcription_compute_type",
        )

    def _getSourceTranscriptionEngine(self, source: PipelineSource) -> str:
        return self._getSourceTranscriptionProfile(source)["engine"]

    @staticmethod
    def _sourceTranscriptionProfileName(source: PipelineSource) -> str:
        return (
            "TRANSCRIPTION_PROFILE_SEND"
            if source is PipelineSource.MIC
            else "TRANSCRIPTION_PROFILE_RECEIVE"
        )

    @staticmethod
    def _legacyTranscriptionProfile() -> dict:
        return make_transcription_profile(
            engine=config.SELECTED_TRANSCRIPTION_ENGINE,
            models={
                "Whisper": config.WHISPER_WEIGHT_TYPE,
                "Vosk": config.VOSK_WEIGHT_TYPE,
                "Parakeet": config.PARAKEET_WEIGHT_TYPE,
                "SenseVoice": config.SENSEVOICE_WEIGHT_TYPE,
            },
            device=config.SELECTED_TRANSCRIPTION_COMPUTE_DEVICE,
            compute_type=config.SELECTED_TRANSCRIPTION_COMPUTE_TYPE,
            whisper_decoding_profile=config.WHISPER_DECODING_PROFILE,
        )

    def _getSourceTranscriptionProfile(self, source: PipelineSource) -> dict:
        stored = getattr(config, self._sourceTranscriptionProfileName(source), None)
        if isinstance(stored, dict):
            return deepcopy(stored)
        engine_name, device_name, compute_name, _device_endpoint, _type_endpoint = (
            self._sourceTranscriptionRuntimeSettingNames(source)
        )
        fallback = self._legacyTranscriptionProfile()
        fallback.update({
            "engine": getattr(config, engine_name, fallback["engine"]),
            "device": deepcopy(getattr(config, device_name, fallback["device"])),
            "compute_type": getattr(config, compute_name, fallback["compute_type"]),
        })
        return fallback

    @staticmethod
    def _selectableTranscriptionModels() -> dict:
        return {
            "Whisper": config.SELECTABLE_WHISPER_WEIGHT_TYPE_LIST,
            "Vosk": config.SELECTABLE_VOSK_WEIGHT_TYPE_LIST,
            "Parakeet": config.SELECTABLE_PARAKEET_WEIGHT_TYPE_LIST,
            "SenseVoice": config.SELECTABLE_SENSEVOICE_WEIGHT_TYPE_LIST,
        }

    def _normalizeTranscriptionProfile(self, value, fallback: dict) -> dict:
        return normalize_transcription_profile(
            value,
            fallback=fallback,
            selectable_engines=config.SELECTABLE_TRANSCRIPTION_ENGINE_LIST,
            selectable_models=self._selectableTranscriptionModels(),
            selectable_devices=config.SELECTABLE_COMPUTE_DEVICE_LIST,
        )

    def _getSourceTranscriptionRuntimeSettings(
        self,
        source: Optional[PipelineSource],
    ) -> tuple[str, dict, str]:
        profile = self._getSourceTranscriptionProfile(source)
        return (
            profile["engine"],
            deepcopy(profile["device"]),
            profile["compute_type"],
        )

    def _publishTranscriptionRuntimeSetting(
        self,
        endpoint_key: str,
        value,
    ) -> None:
        endpoint = self.run_mapping.get(endpoint_key)
        if endpoint:
            self.run(200, endpoint, value)

    def _syncLegacyTranscriptionSettingsFromSend(self) -> None:
        """Mirror the outgoing profile for legacy clients without owning runtime."""
        profile = self._getSourceTranscriptionProfile(PipelineSource.MIC)
        config.SELECTED_TRANSCRIPTION_ENGINE = profile["engine"]
        config.SELECTED_TRANSCRIPTION_COMPUTE_DEVICE = deepcopy(profile["device"])
        config.SELECTED_TRANSCRIPTION_COMPUTE_TYPE = profile["compute_type"]
        config.WHISPER_WEIGHT_TYPE = profile["models"]["Whisper"]
        config.VOSK_WEIGHT_TYPE = profile["models"]["Vosk"]
        config.PARAKEET_WEIGHT_TYPE = profile["models"]["Parakeet"]
        config.SENSEVOICE_WEIGHT_TYPE = profile["models"]["SenseVoice"]
        config.WHISPER_DECODING_PROFILE = profile["whisper_decoding_profile"]

    def _syncSourceTranscriptionCompatibilityFields(self, source: PipelineSource) -> None:
        profile = self._getSourceTranscriptionProfile(source)
        engine_name, device_name, compute_name, _device_endpoint, _type_endpoint = (
            self._sourceTranscriptionRuntimeSettingNames(source)
        )
        setattr(config, engine_name, profile["engine"])
        setattr(config, device_name, deepcopy(profile["device"]))
        setattr(config, compute_name, profile["compute_type"])

    def _publishSourceTranscriptionProfile(self, source: PipelineSource) -> None:
        profile = self._getSourceTranscriptionProfile(source)
        suffix = "send" if source is PipelineSource.MIC else "receive"
        self._publishTranscriptionRuntimeSetting(f"transcription_profile_{suffix}", profile)
        self._publishTranscriptionRuntimeSetting(
            f"selected_transcription_engine_{suffix}", profile["engine"]
        )
        self._publishTranscriptionRuntimeSetting(
            f"selected_transcription_compute_device_{suffix}", deepcopy(profile["device"])
        )
        self._publishTranscriptionRuntimeSetting(
            f"selected_transcription_compute_type_{suffix}", profile["compute_type"]
        )

    def _normalizeTranscriptionRuntimeSelection(
        self,
        notify: bool = False,
        source: Optional[PipelineSource] = None,
    ) -> bool:
        if source is None:
            return self._normalizeAllSourceTranscriptionRuntimeSelections(notify=notify)
        current = self._getSourceTranscriptionProfile(source)
        normalized = self._normalizeTranscriptionProfile(current, current)
        changed = normalized != current
        if changed:
            setattr(config, self._sourceTranscriptionProfileName(source), normalized)
            self._syncSourceTranscriptionCompatibilityFields(source)
            if notify:
                self._publishSourceTranscriptionProfile(source)
        return changed

    def _normalizeAllSourceTranscriptionRuntimeSelections(
        self,
        notify: bool = False,
    ) -> bool:
        changed = self._normalizeTranscriptionRuntimeSelection(
            notify=notify,
            source=PipelineSource.MIC,
        )
        changed = (
            self._normalizeTranscriptionRuntimeSelection(
                notify=notify,
                source=PipelineSource.SPEAKER,
            )
            or changed
        )
        self._syncLegacyTranscriptionSettingsFromSend()
        return changed

    def _normalizeSelectedYourLanguageForTranscription(self) -> bool:
        # Recognition activation is derived at phrase capture time. Engine
        # changes must never rewrite the user's saved multilingual profile.
        return False

    def setInitMapping(self, init_mapping:dict) -> None:
        self.init_mapping = init_mapping

    def setRunMapping(self, run_mapping:dict) -> None:
        self.run_mapping = run_mapping

    def setRun(self, run:Callable[[int, str, Any], None]) -> None:
        self.run = run
    
    def shutdown(self, *args, **kwargs) -> dict:
        """Shutdown controller and model (including telemetry).
        
        Returns:
            dict with status 200 and result True on success.
        """
        # Publish terminal intent before waiting for an in-flight start/restart.
        # The lifecycle state itself is changed only while holding the restart
        # lock, which makes it atomic with every user start and config restart.
        self._transcription_shutdown_requested.set()
        with self._transcription_shutdown_condition:
            if self._transcription_shutdown_state == "shutdown":
                return dict(
                    self._transcription_shutdown_response
                    or {"status": 200, "result": True}
                )
            if self._transcription_shutdown_state == "shutting_down":
                while self._transcription_shutdown_state != "shutdown":
                    self._transcription_shutdown_condition.wait()
                return dict(
                    self._transcription_shutdown_response
                    or {"status": 200, "result": True}
                )
            self._transcription_shutdown_state = "shutting_down"

        response = {"status": 200, "result": True}
        try:
            # The coordinator may already be waiting for the restart lock. Do
            # not hold that lock while closing its queue or joining its thread.
            self._transcription_recovery_stop_event.set()
            self._transcription_recovery_queue.close()
            recovery_thread = self._transcription_recovery_thread
            if recovery_thread.is_alive():
                recovery_thread.join()
            register_recovery = getattr(
                model,
                "setTranscriptionRecoveryCallback",
                None,
            )
            if callable(register_recovery):
                register_recovery(None)
        except Exception:
            errorLogging()
            response = {"status": 500, "result": False}

        if self._transcription_metric_callback_registered:
            try:
                clear_metric = getattr(
                    model,
                    "clearTranscriptionPipelineMetricCallback",
                    None,
                )
                if callable(clear_metric):
                    clear_metric(self._emitPipelineStatus)
                else:
                    register_metric = getattr(
                        model,
                        "setTranscriptionPipelineMetricCallback",
                        None,
                    )
                    if callable(register_metric):
                        register_metric(None)
            except Exception:
                errorLogging()
                response = {"status": 500, "result": False}
            finally:
                self._transcription_metric_callback_registered = False

        try:
            with self._transcription_restart_lock:
                shutdown_pipelines = getattr(
                    model,
                    "shutdownTranscriptionPipelines",
                    None,
                )
                if callable(shutdown_pipelines):
                    shutdown_pipelines()
                telemetry_shutdown = getattr(model, "telemetryShutdown", None)
                if callable(telemetry_shutdown):
                    telemetry_shutdown()
        except Exception:
            errorLogging()
            response = {"status": 500, "result": False}
        finally:
            with self._transcription_shutdown_condition:
                self._transcription_shutdown_response = dict(response)
                self._transcription_shutdown_state = "shutdown"
                self._transcription_shutdown_condition.notify_all()
        return response

    # response functions
    def connectedNetwork(self) -> None:
        self.run(
            200,
            self.run_mapping["connected_network"],
            True,
        )

    def disconnectedNetwork(self) -> None:
        self.run(
            200,
            self.run_mapping["connected_network"],
            False,
        )

    def enableAiModels(self) -> None:
        self.run(
            200,
            self.run_mapping["enable_ai_models"],
            True,
        )

    def disableAiModels(self) -> None:
        self.run(
            200,
            self.run_mapping["enable_ai_models"],
            False,
        )

    def updateMicHostList(self) -> None:
        self.run(
            200,
            self.run_mapping["selectable_mic_host_list"],
            model.getListMicHost(),
        )

    def updateMicDeviceList(self) -> None:
        self.run(
            200,
            self.run_mapping["selectable_mic_device_list"],
            model.getListMicDevice(),
        )

    def updateSpeakerDeviceList(self) -> None:
        self.run(
            200,
            self.run_mapping["selectable_speaker_device_list"],
            model.getListSpeakerDevice(),
        )

    def updateConfigSettings(self) -> None:
        settings = {}
        deferred_endpoints = {
            "/get/data/selectable_mic_host_list",
            "/get/data/selectable_mic_device_list",
            "/get/data/selectable_speaker_device_list",
            "/get/data/connected_lmstudio",
            "/get/data/connected_ollama",
            "/get/data/selectable_lmstudio_model_list",
            "/get/data/selectable_ollama_model_list",
        }
        for endpoint, dict_data in self.init_mapping.items():
            if endpoint in deferred_endpoints:
                continue
            response = dict_data["variable"](None)
            result = response.get("result", None)
            settings[endpoint] = result
        self.run(
            200,
            self.run_mapping["initialization_complete"],
            settings,
        )

    def sendDeferredConfigSettings(self) -> None:
        deferred_endpoints = (
            "/get/data/selectable_mic_host_list",
            "/get/data/selectable_mic_device_list",
            "/get/data/selectable_speaker_device_list",
            "/get/data/connected_lmstudio",
            "/get/data/connected_ollama",
            "/get/data/selectable_lmstudio_model_list",
            "/get/data/selectable_ollama_model_list",
        )
        for endpoint in deferred_endpoints:
            dict_data = self.init_mapping.get(endpoint)
            if dict_data is None:
                continue
            try:
                response = dict_data["variable"](None)
                self.run(200, endpoint, response.get("result", None))
            except Exception:
                errorLogging()

    def restartAccessMicDevices(self) -> None:
        if config.ENABLE_TRANSCRIPTION_SEND is True:
            self.startThreadingTranscriptionSendMessage()
        if config.ENABLE_CHECK_ENERGY_SEND is True:
            model.startCheckMicEnergy(
                self.progressBarMicEnergy,
            )

    def restartAccessSpeakerDevices(self) -> None:
        if config.ENABLE_TRANSCRIPTION_RECEIVE is True:
            self.startThreadingTranscriptionReceiveMessage()
        if config.ENABLE_CHECK_ENERGY_RECEIVE is True:
            model.startCheckSpeakerEnergy(
                self.progressBarSpeakerEnergy,
            )

    def stopAccessMicDevices(self) -> None:
        if config.ENABLE_TRANSCRIPTION_SEND is True:
            self.stopThreadingTranscriptionSendMessage()
        if config.ENABLE_CHECK_ENERGY_SEND is True:
            model.stopCheckMicEnergy()

    def stopAccessSpeakerDevices(self) -> None:
        if config.ENABLE_TRANSCRIPTION_RECEIVE is True:
            self.stopThreadingTranscriptionReceiveMessage()
        if config.ENABLE_CHECK_ENERGY_RECEIVE is True:
            model.stopCheckSpeakerEnergy()

    def updateSelectedMicDevice(self, host, device) -> None:
        config.SELECTED_MIC_HOST = host
        config.SELECTED_MIC_DEVICE = device
        self.run(200, self.run_mapping["selected_mic_host"], config.SELECTED_MIC_HOST)
        self.run(200, self.run_mapping["selected_mic_device"], config.SELECTED_MIC_DEVICE)

    def updateSelectedSpeakerDevice(self, device) -> None:
        config.SELECTED_SPEAKER_DEVICE = device
        self.run(
            200,
            self.run_mapping["selected_speaker_device"],
            device,
        )

    def progressBarMicEnergy(self, energy) -> None:
        if energy is False:
            error_response = VRCTError.create_error_response(
                ErrorCode.DEVICE_NO_MIC,
                data=None
            )
            self.run(
                error_response["status"],
                self.run_mapping["error_device"],
                error_response["result"],
            )
        else:
            self.run(
                200,
                self.run_mapping["check_mic_volume"],
                energy,
            )

    def progressBarSpeakerEnergy(self, energy) -> None:
        if energy is False:
            error_response = VRCTError.create_error_response(
                ErrorCode.DEVICE_NO_SPEAKER,
                data=None
            )
            self.run(
                error_response["status"],
                self.run_mapping["error_device"],
                error_response["result"],
            )
        else:
            self.run(
                200,
                self.run_mapping["check_speaker_volume"],
                energy,
            )

    class DownloadCTranslate2:
        def __init__(self, run_mapping:dict,  weight_type:str, run:Callable[[int, str, Any], None]) -> None:
            self.run_mapping = run_mapping
            self.weight_type = weight_type
            self.run = run

        def progressBar(self, progress) -> None:
            printLog("CTranslate2 Weight Download Progress", progress)
            self.run(
                200,
                self.run_mapping["download_progress_ctranslate2_weight"],
                {"weight_type": self.weight_type, "progress": progress},
            )

        def downloaded(self) -> None:
            is_weight_valid = model.checkTranslatorCTranslate2ModelWeight(self.weight_type)
            is_tokenizer_valid = model.checkTranslatorCTranslate2ModelTokenizer(self.weight_type)

            if is_weight_valid is True and is_tokenizer_valid is True:
                config.SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT[self.weight_type] = True

                self.run(
                    200,
                    self.run_mapping["downloaded_ctranslate2_weight"],
                    self.weight_type,
                )
            else:
                failed_stage = "weight" if is_weight_valid is False else "tokenizer"
                error_response = VRCTError.create_error_response(
                    ErrorCode.WEIGHT_CTRANSLATE2_DOWNLOAD,
                    data={
                        "weight_type": self.weight_type,
                        "stage": failed_stage,
                    },
                    details={
                        "stage": failed_stage,
                        "reason": "verification_failed",
                        "weight_valid": is_weight_valid,
                        "tokenizer_valid": is_tokenizer_valid,
                        "retryable": True,
                    },
                )
                self.run(
                    error_response["status"],
                    self.run_mapping["error_ctranslate2_weight"],
                    error_response["result"],
                )

    class DownloadWhisper:
        def __init__(self, run_mapping:dict, weight_type:str, run:Callable[[int, str, Any], None]) -> None:
            self.run_mapping = run_mapping
            self.weight_type = weight_type
            self.run = run

        def progressBar(self, progress) -> None:
            printLog("Whisper Weight Download Progress", progress)
            self.run(
                200,
                self.run_mapping["download_progress_whisper_weight"],
                {"weight_type": self.weight_type, "progress": progress},
            )

        def downloaded(self) -> None:
            if model.checkTranscriptionWhisperModelWeight(self.weight_type) is True:
                config.SELECTABLE_WHISPER_WEIGHT_TYPE_DICT[self.weight_type] = True

                self.run(
                    200,
                    self.run_mapping["downloaded_whisper_weight"],
                    self.weight_type,
                )
            else:
                error_response = VRCTError.create_error_response(
                    ErrorCode.WEIGHT_WHISPER_DOWNLOAD,
                    data=None
                )
                self.run(
                    error_response["status"],
                    self.run_mapping["error_whisper_weight"],
                    error_response["result"],
                )

    class DownloadVosk:
        def __init__(self, run_mapping:dict, weight_type:str, run:Callable[[int, str, Any], None]) -> None:
            self.run_mapping = run_mapping
            self.weight_type = weight_type
            self.run = run

        def progressBar(self, progress) -> None:
            self.run(
                200,
                self.run_mapping.get("download_progress_vosk_weight", "download_progress_vosk_weight"),
                {"weight_type": self.weight_type, "progress": progress},
            )

        def downloaded(self) -> None:
            if model.checkTranscriptionVoskModelWeight(self.weight_type) is True:
                config.SELECTABLE_VOSK_WEIGHT_TYPE_DICT[self.weight_type] = True
                self.run(
                    200,
                    self.run_mapping.get("downloaded_vosk_weight", "downloaded_vosk_weight"),
                    self.weight_type,
                )

    class DownloadParakeet:
        def __init__(self, run_mapping:dict, weight_type:str, run:Callable[[int, str, Any], None]) -> None:
            self.run_mapping = run_mapping
            self.weight_type = weight_type
            self.run = run

        def progressBar(self, progress) -> None:
            self.run(
                200,
                self.run_mapping.get("download_progress_parakeet_weight", "download_progress_parakeet_weight"),
                {"weight_type": self.weight_type, "progress": progress},
            )

        def downloaded(self) -> None:
            if model.checkTranscriptionParakeetModelWeight(self.weight_type) is True:
                config.SELECTABLE_PARAKEET_WEIGHT_TYPE_DICT[self.weight_type] = True
                self.run(
                    200,
                    self.run_mapping.get("downloaded_parakeet_weight", "downloaded_parakeet_weight"),
                    self.weight_type,
                )

    class DownloadSenseVoice:
        def __init__(self, run_mapping:dict, weight_type:str, run:Callable[[int, str, Any], None]) -> None:
            self.run_mapping = run_mapping
            self.weight_type = weight_type
            self.run = run

        def progressBar(self, progress) -> None:
            self.run(
                200,
                self.run_mapping.get("download_progress_sensevoice_weight", "download_progress_sensevoice_weight"),
                {"weight_type": self.weight_type, "progress": progress},
            )

        def downloaded(self) -> None:
            if model.checkTranscriptionSenseVoiceModelWeight(self.weight_type) is True:
                config.SELECTABLE_SENSEVOICE_WEIGHT_TYPE_DICT[self.weight_type] = True
                self.run(
                    200,
                    self.run_mapping.get("downloaded_sensevoice_weight", "downloaded_sensevoice_weight"),
                    self.weight_type,
                )
            else:
                error_response = VRCTError.create_error_response(
                    ErrorCode.WEIGHT_SENSEVOICE_DOWNLOAD,
                    data=None
                )
                self.run(
                    error_response["status"],
                    self.run_mapping.get("error_sensevoice_weight", "error_sensevoice_weight"),
                    error_response["result"],
                )

    def micMessage(self, result: dict) -> None:
        self._beginTranscriptionTrace(PipelineSource.MIC, result)

    def speakerMessage(self, result:dict) -> None:
        self._beginTranscriptionTrace(PipelineSource.SPEAKER, result)

    def chatMessage(self, data) -> dict:
        id = data["id"]
        message = data["message"]
        if len(message) > 0:
            model.telemetryTrackCoreFeature("text_input")
            translation = []
            success = []
            translation_slots = []
            successful_translations = []
            transliteration_message: List[Any] = []
            transliteration_translation = []
            if config.ENABLE_TRANSLATION is False:
                pass
            else:
                try:
                    model.telemetryTrackCoreFeature("translation")
                    if config.USE_EXCLUDE_WORDS is True:
                        replacement_message, replacement_dict = self.replaceExclamationsWithRandom(message)
                        translation, success = model.getInputTranslate(replacement_message)

                        message = self.removeExclamations(message)
                        for i in range(len(translation)):
                            if (
                                i < len(success)
                                and success[i] is True
                                and isinstance(translation[i], str)
                            ):
                                translation[i] = self.restoreText(translation[i], replacement_dict)
                    else:
                        translation, success = model.getInputTranslate(message)

                    if all(success) is not True:
                        error_response = VRCTError.create_error_response(
                            ErrorCode.TRANSLATION_ENGINE_LIMIT,
                            data=self._rateLimitFailureData(),
                        )
                        self.run(
                            error_response["status"],
                            self.run_mapping["error_translation_engine"],
                            error_response["result"],
                        )
                    else:
                        pass
                except Exception as e:
                    # VRAM不足エラーの検出
                    is_vram_error, error_message = model.detectVRAMError(e)
                    if is_vram_error:
                        error_response = VRCTError.create_error_response(
                            ErrorCode.TRANSLATION_VRAM_CHAT,
                            data=error_message
                        )
                        self.run(
                            error_response["status"],
                            self.run_mapping["error_translation_chat_vram_overflow"],
                            error_response["result"],
                        )
                        # 翻訳機能をOFFにする
                        self.setDisableTranslation()
                        disable_response = VRCTError.create_error_response(
                            ErrorCode.TRANSLATION_DISABLED_VRAM,
                            data=False
                        )
                        self.run(
                            disable_response["status"],
                            self.run_mapping["enable_translation"],
                            disable_response["result"],
                        )
                        # エラー時は翻訳なしで返す
                        return {"status":200,
                                "result":
                                {
                                    "id":id,
                                    "original": {
                                        "message":message,
                                        "transliteration":[]
                                    },
                                    "translations": [
                                        {
                                            "message": "",
                                            "transliteration": []
                                        } for _ in config.SELECTED_TAB_TARGET_LANGUAGES_NO_LIST
                                    ]
                                },
                            }
                    else:
                        # その他のエラーは通常通り処理
                        raise

            translation_slots, successful_translations, successful_indices = self._translationResultViews(
                translation,
                success,
            )
            target_languages = config.SELECTED_TARGET_LANGUAGES[config.SELECTED_TAB_NO]
            target_items = self._translationTargetItems(target_languages)
            successful_target_languages = self._successfulTargetMetadata(
                target_languages,
                successful_indices,
            )
            if config.CONVERT_MESSAGE_TO_HIRAGANA is True or config.CONVERT_MESSAGE_TO_ROMAJI is True:
                if config.SELECTED_YOUR_LANGUAGES[config.SELECTED_TAB_NO]["1"]["language"] == "Japanese":
                    transliteration_message = model.convertMessageToTransliteration(
                        message,
                        hiragana=config.CONVERT_MESSAGE_TO_HIRAGANA,
                        romaji=config.CONVERT_MESSAGE_TO_ROMAJI
                    )
                transliteration_translation = [[] for _ in translation_slots]
                for i, translation_message in enumerate(translation_slots):
                    if i >= len(target_items):
                        continue
                    target_language = target_items[i][1]
                    if (translation_message and
                        config.ENABLE_TRANSLATION is True and
                        target_language["language"] == "Japanese"
                        ):
                        transliteration_translation[i] = model.convertMessageToTransliteration(
                            translation_message,
                            hiragana=config.CONVERT_MESSAGE_TO_HIRAGANA,
                            romaji=config.CONVERT_MESSAGE_TO_ROMAJI
                        )
            else:
                transliteration_translation = [[] for _ in translation_slots]
            successful_transliterations = self._successfulTransliterationView(
                translation_slots,
                transliteration_translation,
            )

            # send OSC message
            if config.SEND_MESSAGE_TO_VRC is True:
                osc_message = None
                if config.SEND_ONLY_TRANSLATED_MESSAGES is True:
                    if config.ENABLE_TRANSLATION is False:
                        osc_message = self.messageFormatter("SEND", [], message)
                    elif successful_translations:
                        osc_message = self.messageFormatter("SEND", successful_translations, "")
                else:
                    osc_message = self.messageFormatter("SEND", successful_translations, message)
                if osc_message is not None:
                    model.oscSendMessage(osc_message)

            if config.OVERLAY_LARGE_LOG is True:
                if config.OVERLAY_SHOW_ONLY_TRANSLATED_MESSAGES is True:
                    if successful_translations:
                        overlay_image = model.createOverlayImageLargeLog(
                            "send",
                            None,
                            None,
                            successful_translations,
                            successful_target_languages,
                            transliteration_message,
                            successful_transliterations
                        )
                        model.updateOverlayLargeLog(overlay_image)
                else:
                    overlay_image = model.createOverlayImageLargeLog(
                        "send",
                        message,
                        config.SELECTED_YOUR_LANGUAGES[config.SELECTED_TAB_NO]["1"]["language"],
                        successful_translations,
                        successful_target_languages,
                        transliteration_message,
                        successful_transliterations
                    )
                    model.updateOverlayLargeLog(overlay_image)

            if model.checkWebSocketServerAlive() is True:
                model.websocketSendMessage(
                    {
                        "type":"CHAT",
                        "src_languages":config.SELECTED_YOUR_LANGUAGES[config.SELECTED_TAB_NO],
                        "dst_languages":successful_target_languages,
                        "message":message,
                        "translation":successful_translations,
                        "transliteration":successful_transliterations
                    }
                )

            if config.LOGGER_FEATURE is True:
                translation_text = f" ({'/'.join(successful_translations)})" if successful_translations else ""
                model.logger.info(f"[CHAT] {message}{translation_text}")

        model.addTranslationHistory("chat", message)

        return {
                "status":200,
                "result":{
                    "id":id,
                    "original": {
                        "message":message,
                        "transliteration":transliteration_message
                    },
                    "translations": [
                        {
                            "message": translation_message,
                            "transliteration": transliteration
                        } for translation_message, transliteration in zip(translation_slots, transliteration_translation)
                    ]
                }}

    @staticmethod
    def getVersion(*args, **kwargs) -> dict:
        return {"status":200, "result":config.VERSION}

    def checkSoftwareUpdated(self) -> dict:
        software_update_info = model.checkSoftwareUpdated()
        self.run(
            200,
            self.run_mapping["software_update_info"],
            software_update_info,
        )
        return {"status":200, "result": software_update_info}

    @staticmethod
    def getComputeMode(*args, **kwargs) -> dict:
        return {"status":200, "result":config.COMPUTE_MODE}

    @staticmethod
    def _getSelectedResourceMonitorGpuIndex(data: dict | None = None) -> int | None:
        if isinstance(data, dict) and data.get("mode") == "manual":
            try:
                return int(data.get("device_index"))
            except (TypeError, ValueError):
                return None

        selected_devices = [config.SELECTED_TRANSLATION_COMPUTE_DEVICE]
        for profile_name in (
            "TRANSCRIPTION_PROFILE_SEND",
            "TRANSCRIPTION_PROFILE_RECEIVE",
        ):
            profile = getattr(config, profile_name, None)
            if isinstance(profile, dict):
                selected_devices.append(profile.get("device", {}))
        selected_devices.append(config.SELECTED_TRANSCRIPTION_COMPUTE_DEVICE)

        for selected_device in selected_devices:
            if selected_device.get("device") == "cuda":
                try:
                    return int(selected_device.get("device_index"))
                except (TypeError, ValueError):
                    return None

        return None

    def getResourceUsage(self, data=None, *args, **kwargs) -> dict:
        selected_gpu_index = self._getSelectedResourceMonitorGpuIndex(data)
        return {"status": 200, "result": collect_resource_usage(selected_gpu_index)}

    @staticmethod
    def getComputeDeviceList(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SELECTABLE_COMPUTE_DEVICE_LIST}

    @staticmethod
    def getSelectedTranslationComputeDevice(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SELECTED_TRANSLATION_COMPUTE_DEVICE}

    def setSelectedTranslationComputeDevice(self, device:str, *args, **kwargs) -> dict:
        with self._translation_activation_lock:
            printLog("setSelectedTranslationComputeDevice", device)
            previous_device = deepcopy(
                config.SELECTED_TRANSLATION_COMPUTE_DEVICE
            )
            previous_compute_type = config.SELECTED_TRANSLATION_COMPUTE_TYPE
            config.SELECTED_TRANSLATION_COMPUTE_DEVICE = device
            config.SELECTED_TRANSLATION_COMPUTE_TYPE = "auto"
            model.setChangedTranslatorParameters(True)
            try:
                self._refreshActiveCTranslate2Readiness()
            except Exception as error:
                config.SELECTED_TRANSLATION_COMPUTE_DEVICE = previous_device
                config.SELECTED_TRANSLATION_COMPUTE_TYPE = previous_compute_type
                model.setChangedTranslatorParameters(True)
                try:
                    self._refreshActiveCTranslate2Readiness()
                except Exception:
                    errorLogging()
                return self._translationActivationError(
                    error,
                    preserve_enabled=True,
                )
            self.run(
                200,
                self.run_mapping["selected_translation_compute_type"],
                config.SELECTED_TRANSLATION_COMPUTE_TYPE,
            )
            return {
                "status":200,
                "result":config.SELECTED_TRANSLATION_COMPUTE_DEVICE,
            }

    @staticmethod
    def getSelectableCtranslate2WeightTypeDict(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT}

    @staticmethod
    def getSelectedTranscriptionComputeDevice(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SELECTED_TRANSCRIPTION_COMPUTE_DEVICE}

    def getTranscriptionProfileSend(self, *args, **kwargs) -> dict:
        return {
            "status": 200,
            "result": self._getSourceTranscriptionProfile(PipelineSource.MIC),
        }

    def getTranscriptionProfileReceive(self, *args, **kwargs) -> dict:
        return {
            "status": 200,
            "result": self._getSourceTranscriptionProfile(PipelineSource.SPEAKER),
        }

    def getTranscriptionProfileAll(self, *args, **kwargs) -> dict:
        return self.getTranscriptionProfileSend()

    def _setTranscriptionProfileForSourceLocked(
        self,
        source: PipelineSource,
        data,
    ) -> dict:
        current = self._getSourceTranscriptionProfile(source)
        target = self._normalizeTranscriptionProfile(
            merge_transcription_profile(current, data),
            current,
        )
        if target == current:
            return self._transcriptionRuntimeSettingResponse(target, True)

        runtime_changed = (
            effective_transcription_profile(target)
            != effective_transcription_profile(current)
        )
        setattr(config, self._sourceTranscriptionProfileName(source), target)
        self._syncSourceTranscriptionCompatibilityFields(source)
        if source is PipelineSource.MIC:
            self._syncLegacyTranscriptionSettingsFromSend()
        self._publishSourceTranscriptionProfile(source)
        restart_outcome = True
        if runtime_changed:
            restart_outcome = self._requestTranscriptionSourcesRestartLocked((source,))
        return self._transcriptionRuntimeSettingResponse(target, restart_outcome)

    def _setTranscriptionProfileForSource(self, source: PipelineSource, data) -> dict:
        with self._transcription_restart_lock:
            current = self._getSourceTranscriptionProfile(source)
            if not self._transcriptionRuntimeSettingAllowedLocked():
                return self._transcriptionRuntimeSettingShutdownResponse(current)
            return self._setTranscriptionProfileForSourceLocked(source, data)

    def setTranscriptionProfileSend(self, data, *args, **kwargs) -> dict:
        return self._setTranscriptionProfileForSource(PipelineSource.MIC, data)

    def setTranscriptionProfileReceive(self, data, *args, **kwargs) -> dict:
        return self._setTranscriptionProfileForSource(PipelineSource.SPEAKER, data)

    def setTranscriptionProfileAll(self, data, *args, **kwargs) -> dict:
        with self._transcription_restart_lock:
            current_send = self._getSourceTranscriptionProfile(PipelineSource.MIC)
            current_receive = self._getSourceTranscriptionProfile(PipelineSource.SPEAKER)
            if not self._transcriptionRuntimeSettingAllowedLocked():
                return self._transcriptionRuntimeSettingShutdownResponse(current_send)

            target = self._normalizeTranscriptionProfile(
                merge_transcription_profile(current_send, data),
                current_send,
            )
            if target == current_send and target == current_receive:
                return self._transcriptionRuntimeSettingResponse(target, True)
            changed_sources = tuple(
                source
                for source, current in (
                    (PipelineSource.MIC, current_send),
                    (PipelineSource.SPEAKER, current_receive),
                )
                if effective_transcription_profile(current)
                != effective_transcription_profile(target)
            )
            send_changed = target != current_send
            receive_changed = target != current_receive
            if send_changed:
                config.TRANSCRIPTION_PROFILE_SEND = deepcopy(target)
                self._syncSourceTranscriptionCompatibilityFields(PipelineSource.MIC)
            if receive_changed:
                config.TRANSCRIPTION_PROFILE_RECEIVE = deepcopy(target)
                self._syncSourceTranscriptionCompatibilityFields(PipelineSource.SPEAKER)
            self._syncLegacyTranscriptionSettingsFromSend()

            # Publish only after both profiles and their compatibility mirrors
            # have committed, so observers never see a half-applied global edit.
            if send_changed:
                self._publishSourceTranscriptionProfile(PipelineSource.MIC)
            if receive_changed:
                self._publishSourceTranscriptionProfile(PipelineSource.SPEAKER)

            restart_outcome = True
            if changed_sources:
                restart_outcome = self._requestTranscriptionSourcesRestartLocked(
                    changed_sources
                )
            return self._transcriptionRuntimeSettingResponse(target, restart_outcome)

    def _getSelectedTranscriptionComputeDeviceForSource(
        self,
        source: PipelineSource,
    ) -> dict:
        _engine, device, _compute_type = self._getSourceTranscriptionRuntimeSettings(
            source
        )
        return {"status": 200, "result": deepcopy(device)}

    def getSelectedTranscriptionComputeDeviceSend(self, *args, **kwargs) -> dict:
        return self._getSelectedTranscriptionComputeDeviceForSource(PipelineSource.MIC)

    def getSelectedTranscriptionComputeDeviceReceive(self, *args, **kwargs) -> dict:
        return self._getSelectedTranscriptionComputeDeviceForSource(PipelineSource.SPEAKER)

    def _transcriptionRuntimeSettingAllowedLocked(self) -> bool:
        return (
            self._transcription_shutdown_state == "running"
            and not self._transcription_shutdown_requested.is_set()
        )

    @staticmethod
    def _transcriptionRuntimeSettingResponse(
        applied_value,
        restart_outcome: Optional[bool],
    ) -> dict:
        # Runtime selection is retained even if re-establishing an active
        # source fails. The response reports that failure without exposing an
        # exception or backend detail.
        if restart_outcome is False:
            return {
                "status": 500,
                "result": applied_value,
                "error_code": "transcription_restart_failed",
            }
        if restart_outcome is None:
            return {
                "status": 503,
                "result": applied_value,
                "error_code": "transcription_shutdown",
            }
        return {"status": 200, "result": applied_value}

    @staticmethod
    def _transcriptionRuntimeSettingShutdownResponse(current_value) -> dict:
        return {
            "status": 503,
            "result": deepcopy(current_value),
            "error_code": "transcription_shutdown",
        }

    @staticmethod
    def _transcriptionProfileScalarResponse(response: dict, selector) -> dict:
        result = response.get("result")
        scalar = selector(result) if isinstance(result, dict) else result
        transformed = dict(response)
        transformed["result"] = deepcopy(scalar)
        return transformed

    def setSelectedTranscriptionComputeDevice(self, device:dict, *args, **kwargs) -> dict:
        response = self.setTranscriptionProfileAll(
            {"device": device, "compute_type": "auto"}
        )
        return self._transcriptionProfileScalarResponse(
            response, lambda profile: profile["device"]
        )

    def _setSelectedTranscriptionComputeDeviceForOneSource(
        self,
        source: PipelineSource,
        device: dict,
    ) -> dict:
        response = self._setTranscriptionProfileForSource(
            source,
            {"device": device, "compute_type": "auto"},
        )
        return self._transcriptionProfileScalarResponse(
            response, lambda profile: profile["device"]
        )

    def setSelectedTranscriptionComputeDeviceSend(self, device: dict, *args, **kwargs) -> dict:
        return self._setSelectedTranscriptionComputeDeviceForOneSource(
            PipelineSource.MIC,
            device,
        )

    def setSelectedTranscriptionComputeDeviceReceive(self, device: dict, *args, **kwargs) -> dict:
        return self._setSelectedTranscriptionComputeDeviceForOneSource(
            PipelineSource.SPEAKER,
            device,
        )

    @staticmethod
    def getSelectableWhisperWeightTypeDict(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SELECTABLE_WHISPER_WEIGHT_TYPE_DICT}

    @staticmethod
    def getSelectableVoskWeightTypeDict(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SELECTABLE_VOSK_WEIGHT_TYPE_DICT}

    @staticmethod
    def getSelectableParakeetWeightTypeDict(*args, **kwargs) -> dict:
        result = {}
        for weight_type, is_downloaded in config.SELECTABLE_PARAKEET_WEIGHT_TYPE_DICT.items():
            meta = getParakeetModelMeta(weight_type)
            result[weight_type] = {
                "is_downloaded": is_downloaded,
                "downloadable": meta.get("downloadable", True),
                "unavailable_reason": meta.get("unavailable_reason", ""),
            }
        return {"status":200, "result":result}

    @staticmethod
    def getSelectableSenseVoiceWeightTypeDict(*args, **kwargs) -> dict:
        result = {}
        for weight_type, is_downloaded in config.SELECTABLE_SENSEVOICE_WEIGHT_TYPE_DICT.items():
            meta = getSenseVoiceModelMeta(weight_type)
            result[weight_type] = {
                "is_downloaded": is_downloaded,
                "downloadable": meta.get("downloadable", True),
                "unavailable_reason": meta.get("unavailable_reason", ""),
            }
        return {"status":200, "result":result}

    # @staticmethod
    # def getMaxMicThreshold(*args, **kwargs) -> dict:
    #     return {"status":200, "result":config.MAX_MIC_THRESHOLD}

    # @staticmethod
    # def getMaxSpeakerThreshold(*args, **kwargs) -> dict:
    #     return {"status":200, "result":config.MAX_SPEAKER_THRESHOLD}

    @staticmethod
    def _activationErrorResponse(
        error_code: ErrorCode,
        *,
        status: int = 400,
        message: str = "",
    ) -> dict:
        if not message:
            message = VRCTError.create_error_response(
                error_code,
                data=False,
            )["result"]["message"]
        return {
            "status": status,
            "result": {
                "error_code": error_code.value,
                "message": message,
                "data": False,
            },
        }

    def _safeActivationEvent(
        self,
        endpoint_key: str,
        response: dict,
    ) -> None:
        endpoint = self.run_mapping.get(endpoint_key)
        if endpoint is None:
            return
        try:
            self.run(response["status"], endpoint, response["result"])
        except Exception:
            errorLogging()

    @staticmethod
    def _collapseTranslationProviderSelection(selection):
        providers = boundedTranslationProviderSnapshot(selection)
        if not providers:
            return ""
        if len(providers) == 1:
            return providers[0]
        return list(providers)

    @classmethod
    def _normalizeTranslationEngineMap(cls, selections) -> dict:
        if not isinstance(selections, dict):
            return {}
        return {
            tab_no: cls._collapseTranslationProviderSelection(selection)
            for tab_no, selection in selections.items()
        }

    @staticmethod
    def _isCTranslate2Primary(selection) -> bool:
        providers = boundedTranslationProviderSnapshot(selection)
        return bool(providers and providers[0] == "CTranslate2")

    def _ensureCTranslate2Ready(
        self,
        selection,
        *,
        include_auto_fallback: bool = False,
    ) -> None:
        providers = boundedTranslationProviderSnapshot(selection)
        should_prepare_fallback = (
            include_auto_fallback
            and bool(providers)
            and providers[0] != "CTranslate2"
            and config.ENABLE_CTRANSLATE2_AUTO_FALLBACK is True
        )
        if not self._isCTranslate2Primary(selection) and not should_prepare_fallback:
            return
        if (
            model.isLoadedCTranslate2Model() is False
            or model.isChangedTranslatorParameters() is True
        ):
            printLog("Loading CTranslate2 translation model")
            model.changeTranslatorCTranslate2Model()
            model.setChangedTranslatorParameters(False)

    def _refreshActiveCTranslate2Readiness(
        self,
        selection=None,
        *,
        release_if_unused: bool = False,
    ) -> bool:
        if config.ENABLE_TRANSLATION is not True:
            if release_if_unused:
                self._releaseCTranslate2()
            return False
        if selection is None:
            selection = config.SELECTED_TRANSLATION_ENGINES.get(
                config.SELECTED_TAB_NO,
                "",
            )
        providers = boundedTranslationProviderSnapshot(selection)
        needs_local = self._isCTranslate2Primary(selection) or (
            bool(providers)
            and providers[0] != "CTranslate2"
            and config.ENABLE_CTRANSLATE2_AUTO_FALLBACK is True
        )
        if needs_local:
            self._ensureCTranslate2Ready(
                selection,
                include_auto_fallback=True,
            )
        elif release_if_unused:
            self._releaseCTranslate2()
        return needs_local

    @staticmethod
    def _releaseCTranslate2() -> None:
        try:
            if model.isLoadedCTranslate2Model() is True:
                model.unloadTranslatorCTranslate2Model()
        except Exception:
            errorLogging()

    def _translationActivationError(
        self,
        error: Exception,
        *,
        preserve_enabled: bool = False,
    ) -> dict:
        try:
            is_vram_error, _error_message = model.detectVRAMError(error)
        except Exception:
            errorLogging()
            is_vram_error = False
        if is_vram_error:
            response = self._activationErrorResponse(
                ErrorCode.TRANSLATION_VRAM_ENABLE
            )
            self._safeActivationEvent(
                "error_translation_enable_vram_overflow",
                response,
            )
            if preserve_enabled is False:
                disabled_response = self._activationErrorResponse(
                    ErrorCode.TRANSLATION_DISABLED_VRAM
                )
                self._safeActivationEvent("enable_translation", disabled_response)
            return response
        errorLogging()
        return self._activationErrorResponse(
            ErrorCode.TRANSLATION_ENABLE_FAILED,
            status=500,
        )

    def setEnableTranslation(self, *args, **kwargs) -> dict:
        with self._translation_activation_lock:
            selected_engine = config.SELECTED_TRANSLATION_ENGINES.get(
                config.SELECTED_TAB_NO,
                "CTranslate2",
            )
            normalized_selection = self._collapseTranslationProviderSelection(
                selected_engine
            )
            config.SELECTED_TRANSLATION_ENGINES[config.SELECTED_TAB_NO] = (
                normalized_selection
            )
            try:
                self._ensureCTranslate2Ready(
                    normalized_selection,
                    include_auto_fallback=True,
                )
                if config.ENABLE_TRANSLATION is True:
                    return {"status": 200, "result": True}
                config.ENABLE_TRANSLATION = True
                return {"status": 200, "result": True}
            except Exception as error:
                config.ENABLE_TRANSLATION = False
                return self._translationActivationError(error)

    def setDisableTranslation(self, *args, **kwargs) -> dict:
        with self._translation_activation_lock:
            config.ENABLE_TRANSLATION = False
            self._releaseCTranslate2()
            return {"status": 200, "result": config.ENABLE_TRANSLATION}

    def _setLiveSession(self, enabled: bool) -> dict:
        """Apply live pipelines in one deterministic backend command.

        Individual endpoints remain available for hotkeys and advanced controls.
        Their established run events keep every existing UI consumer synchronized.
        """
        operations = (
            (
                "translation",
                "enable_translation",
                self.setEnableTranslation if enabled else self.setDisableTranslation,
            ),
            (
                "transcription_send",
                "enable_transcription_send",
                self.setEnableTranscriptionSend if enabled else self.setDisableTranscriptionSend,
            ),
            (
                "transcription_receive",
                "enable_transcription_receive",
                self.setEnableTranscriptionReceive if enabled else self.setDisableTranscriptionReceive,
            ),
        )
        results = {}
        for operation, event_key, set_operation in operations:
            response = set_operation()
            operation_result = response.get("result", False)
            results[operation] = (
                operation_result if isinstance(operation_result, bool) else False
            )
            self._safeActivationEvent(event_key, response)
        return {"status": 200, "result": results}

    def setEnableLiveSession(self, *args, **kwargs) -> dict:
        return self._setLiveSession(True)

    def setDisableLiveSession(self, *args, **kwargs) -> dict:
        return self._setLiveSession(False)

    @staticmethod
    def getCTranslate2AutoFallback(*args, **kwargs) -> dict:
        return {
            "status": 200,
            "result": config.ENABLE_CTRANSLATE2_AUTO_FALLBACK,
        }

    def setCTranslate2AutoFallback(self, enabled, *args, **kwargs) -> dict:
        with self._translation_activation_lock:
            if not isinstance(enabled, bool):
                return {
                    "status": 400,
                    "result": config.ENABLE_CTRANSLATE2_AUTO_FALLBACK,
                }
            previous_enabled = config.ENABLE_CTRANSLATE2_AUTO_FALLBACK
            config.ENABLE_CTRANSLATE2_AUTO_FALLBACK = enabled
            current_selection = config.SELECTED_TRANSLATION_ENGINES.get(
                config.SELECTED_TAB_NO,
                "",
            )
            if enabled is True and config.ENABLE_TRANSLATION is True:
                try:
                    self._ensureCTranslate2Ready(
                        current_selection,
                        include_auto_fallback=True,
                    )
                except Exception as error:
                    config.ENABLE_CTRANSLATE2_AUTO_FALLBACK = previous_enabled
                    return self._translationActivationError(
                        error,
                        preserve_enabled=True,
                    )
            if enabled is False and not self._isCTranslate2Primary(
                current_selection
            ):
                self._releaseCTranslate2()
            return {
                "status": 200,
                "result": config.ENABLE_CTRANSLATE2_AUTO_FALLBACK,
            }

    @staticmethod
    def setEnableForeground(*args, **kwargs) -> dict:
        if config.ENABLE_FOREGROUND is False:
            config.ENABLE_FOREGROUND = True
        return {"status":200, "result":config.ENABLE_FOREGROUND}

    @staticmethod
    def setDisableForeground(*args, **kwargs) -> dict:
        if config.ENABLE_FOREGROUND is True:
            config.ENABLE_FOREGROUND = False
        return {"status":200, "result":config.ENABLE_FOREGROUND}

    @staticmethod
    def getSelectedTabNo(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SELECTED_TAB_NO}

    def setSelectedTabNo(self, selected_tab_no:str, *args, **kwargs) -> dict:
        with self._translation_activation_lock:
            printLog("setSelectedTabNo", selected_tab_no)
            previous_tab_no = config.SELECTED_TAB_NO
            config.SELECTED_TAB_NO = selected_tab_no
            try:
                self._refreshActiveCTranslate2Readiness()
            except Exception as error:
                config.SELECTED_TAB_NO = previous_tab_no
                return self._translationActivationError(
                    error,
                    preserve_enabled=True,
                )
            self._normalizeSelectedYourLanguageForTranscription()
            self.updateTranslationEngineAndEngineList()
            return {"status":200, "result":config.SELECTED_TAB_NO}

    @staticmethod
    def getTranslationEngines(*args, **kwargs) -> dict:
        input_engines = model.findTranslationEngines(
            config.SELECTED_YOUR_LANGUAGES[config.SELECTED_TAB_NO],
            config.SELECTED_TARGET_LANGUAGES[config.SELECTED_TAB_NO],
            config.SELECTABLE_TRANSLATION_ENGINE_STATUS,
            )
        output_engines = model.findTranslationEngines(
            config.SELECTED_TARGET_LANGUAGES[config.SELECTED_TAB_NO],
            config.SELECTED_YOUR_TRANSLATION_LANGUAGES[config.SELECTED_TAB_NO],
            config.SELECTABLE_TRANSLATION_ENGINE_STATUS,
            )
        engines = [engine for engine in input_engines if engine in output_engines]

        return {"status":200, "result":engines}

    @staticmethod
    def getListLanguageAndCountry(*args, **kwargs) -> dict:
        return {"status":200, "result": model.getListLanguageAndCountry()}

    @staticmethod
    def getMicHostList(*args, **kwargs) -> dict:
        return {"status":200, "result": model.getListMicHost()}

    @staticmethod
    def getMicDeviceList(*args, **kwargs) -> dict:
        return {"status":200, "result": model.getListMicDevice()}

    @staticmethod
    def getSpeakerDeviceList(*args, **kwargs) -> dict:
        return {"status":200, "result": model.getListSpeakerDevice()}

    @classmethod
    def getSelectedTranslationEngines(cls, *args, **kwargs) -> dict:
        config.SELECTED_TRANSLATION_ENGINES = cls._normalizeTranslationEngineMap(
            config.SELECTED_TRANSLATION_ENGINES
        )
        return {"status":200, "result":config.SELECTED_TRANSLATION_ENGINES}

    def setSelectedTranslationEngines(self, data:dict, *args, **kwargs) -> dict:
        with self._translation_activation_lock:
            normalized = self._normalizeTranslationEngineMap(data)
            current_selection = config.SELECTED_TRANSLATION_ENGINES.get(
                config.SELECTED_TAB_NO,
                "",
            )
            proposed_selection = normalized.get(config.SELECTED_TAB_NO, "")

            if config.ENABLE_TRANSLATION is False:
                config.SELECTED_TRANSLATION_ENGINES = normalized
                model.resetTranslationProviderRotation()
                return {
                    "status": 200,
                    "result": config.SELECTED_TRANSLATION_ENGINES,
                }

            try:
                needs_local = self._refreshActiveCTranslate2Readiness(
                    proposed_selection,
                )
            except Exception as error:
                return self._translationActivationError(
                    error,
                    preserve_enabled=True,
                )
            config.SELECTED_TRANSLATION_ENGINES = normalized
            if (
                needs_local is False
                and self._isCTranslate2Primary(current_selection)
            ):
                self._releaseCTranslate2()

            model.resetTranslationProviderRotation()
            return {
                "status": 200,
                "result": config.SELECTED_TRANSLATION_ENGINES,
            }

    @staticmethod
    def getSelectedYourLanguages(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SELECTED_YOUR_LANGUAGES}

    def setSelectedYourLanguages(self, select:dict, *args, **kwargs) -> dict:
        if self._selectedTabLanguagesSupported(select) is False:
            return {"status":200, "result":config.SELECTED_YOUR_LANGUAGES}
        config.SELECTED_YOUR_LANGUAGES = select
        self._normalizeSelectedYourLanguageForTranscription()
        self.updateTranslationEngineAndEngineList()
        return {"status":200, "result":config.SELECTED_YOUR_LANGUAGES}

    @staticmethod
    def getSelectedYourTranslationLanguages(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SELECTED_YOUR_TRANSLATION_LANGUAGES}

    def setSelectedYourTranslationLanguages(self, select:dict, *args, **kwargs) -> dict:
        config.SELECTED_YOUR_TRANSLATION_LANGUAGES = select
        self.updateTranslationEngineAndEngineList()
        return {"status":200, "result":config.SELECTED_YOUR_TRANSLATION_LANGUAGES}

    @staticmethod
    def getSelectedTargetLanguages(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SELECTED_TARGET_LANGUAGES}

    def setSelectedTargetLanguages(self, select:dict, *args, **kwargs) -> dict:
        if (
            config.ENABLE_TRANSCRIPTION_RECEIVE is True
            and self._selectedTabLanguagesSupported(
                select,
                direction="received",
            ) is False
        ):
            return {"status":200, "result":config.SELECTED_TARGET_LANGUAGES}
        config.SELECTED_TARGET_LANGUAGES = select
        self.updateTranslationEngineAndEngineList()
        return {"status":200, "result":config.SELECTED_TARGET_LANGUAGES}

    @staticmethod
    def getTranscriptionEngines(*args, **kwargs) -> dict:
        engines = [key for key, value in config.SELECTABLE_TRANSCRIPTION_ENGINE_STATUS.items() if value is True]
        return {"status":200, "result":engines}

    @staticmethod
    def getTranscriptionLanguageCapabilities(*args, **kwargs) -> dict:
        return {"status": 200, "result": transcription_language_capabilities()}

    @staticmethod
    def getSelectedTranscriptionEngine(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SELECTED_TRANSCRIPTION_ENGINE}

    def _getSelectedTranscriptionEngineForSource(
        self,
        source: PipelineSource,
    ) -> dict:
        return {"status": 200, "result": self._getSourceTranscriptionEngine(source)}

    def getSelectedTranscriptionEngineSend(self, *args, **kwargs) -> dict:
        return self._getSelectedTranscriptionEngineForSource(PipelineSource.MIC)

    def getSelectedTranscriptionEngineReceive(self, *args, **kwargs) -> dict:
        return self._getSelectedTranscriptionEngineForSource(PipelineSource.SPEAKER)

    def setSelectedTranscriptionEngine(self, data, *args, **kwargs) -> dict:
        response = self.setTranscriptionProfileAll({"engine": str(data)})
        return self._transcriptionProfileScalarResponse(
            response, lambda profile: profile["engine"]
        )

    def _setSelectedTranscriptionEngineForOneSource(
        self,
        source: PipelineSource,
        data,
    ) -> dict:
        response = self._setTranscriptionProfileForSource(
            source,
            {"engine": str(data)},
        )
        return self._transcriptionProfileScalarResponse(
            response, lambda profile: profile["engine"]
        )

    def setSelectedTranscriptionEngineSend(self, data, *args, **kwargs) -> dict:
        return self._setSelectedTranscriptionEngineForOneSource(PipelineSource.MIC, data)

    def setSelectedTranscriptionEngineReceive(self, data, *args, **kwargs) -> dict:
        return self._setSelectedTranscriptionEngineForOneSource(
            PipelineSource.SPEAKER,
            data,
        )

    @staticmethod
    def getConvertMessageToRomaji(*args, **kwargs) -> dict:
        return {"status":200, "result":config.CONVERT_MESSAGE_TO_ROMAJI}

    @staticmethod
    def setEnableConvertMessageToRomaji(*args, **kwargs) -> dict:
        if config.CONVERT_MESSAGE_TO_ROMAJI is False:
            if config.CONVERT_MESSAGE_TO_HIRAGANA is False:
                model.startTransliteration()
            config.CONVERT_MESSAGE_TO_ROMAJI = True
        return {"status":200, "result":config.CONVERT_MESSAGE_TO_ROMAJI}

    @staticmethod
    def setDisableConvertMessageToRomaji(*args, **kwargs) -> dict:
        if config.CONVERT_MESSAGE_TO_ROMAJI is True:
            if config.CONVERT_MESSAGE_TO_HIRAGANA is False:
                model.stopTransliteration()
            config.CONVERT_MESSAGE_TO_ROMAJI = False
        return {"status":200, "result":config.CONVERT_MESSAGE_TO_ROMAJI}

    @staticmethod
    def getConvertMessageToHiragana(*args, **kwargs) -> dict:
        return {"status":200, "result":config.CONVERT_MESSAGE_TO_HIRAGANA}

    @staticmethod
    def setEnableConvertMessageToHiragana(*args, **kwargs) -> dict:
        if config.CONVERT_MESSAGE_TO_HIRAGANA is False:
            if config.CONVERT_MESSAGE_TO_ROMAJI is False:
                model.startTransliteration()
            config.CONVERT_MESSAGE_TO_HIRAGANA = True
        return {"status":200, "result":config.CONVERT_MESSAGE_TO_HIRAGANA}

    @staticmethod
    def setDisableConvertMessageToHiragana(*args, **kwargs) -> dict:
        if config.CONVERT_MESSAGE_TO_HIRAGANA is True:
            if config.CONVERT_MESSAGE_TO_ROMAJI is False:
                model.stopTransliteration()
            config.CONVERT_MESSAGE_TO_HIRAGANA = False
        return {"status":200, "result":config.CONVERT_MESSAGE_TO_HIRAGANA}

    @staticmethod
    def getMainWindowSidebarCompactMode(*args, **kwargs) -> dict:
        return {"status":200, "result":config.MAIN_WINDOW_SIDEBAR_COMPACT_MODE}

    @staticmethod
    def setEnableMainWindowSidebarCompactMode(*args, **kwargs) -> dict:
        if config.MAIN_WINDOW_SIDEBAR_COMPACT_MODE is False:
            config.MAIN_WINDOW_SIDEBAR_COMPACT_MODE = True
        return {"status":200, "result":config.MAIN_WINDOW_SIDEBAR_COMPACT_MODE}

    @staticmethod
    def setDisableMainWindowSidebarCompactMode(*args, **kwargs) -> dict:
        if config.MAIN_WINDOW_SIDEBAR_COMPACT_MODE is True:
            config.MAIN_WINDOW_SIDEBAR_COMPACT_MODE = False
        return {"status":200, "result":config.MAIN_WINDOW_SIDEBAR_COMPACT_MODE}

    @staticmethod
    def getTransparency(*args, **kwargs) -> dict:
        return {"status":200, "result":config.TRANSPARENCY}

    @staticmethod
    def setTransparency(data, *args, **kwargs) -> dict:
        config.TRANSPARENCY = int(data)
        return {"status":200, "result":config.TRANSPARENCY}

    @staticmethod
    def getUiScaling(*args, **kwargs) -> dict:
        return {"status":200, "result":config.UI_SCALING}

    @staticmethod
    def setUiScaling(data, *args, **kwargs) -> dict:
        config.UI_SCALING = int(data)
        return {"status":200, "result":config.UI_SCALING}

    @staticmethod
    def getTextboxUiScaling(*args, **kwargs) -> dict:
        return {"status":200, "result":config.TEXTBOX_UI_SCALING}

    @staticmethod
    def setTextboxUiScaling(data, *args, **kwargs) -> dict:
        config.TEXTBOX_UI_SCALING = int(data)
        return {"status":200, "result":config.TEXTBOX_UI_SCALING}

    @staticmethod
    def getMessageBoxRatio(*args, **kwargs) -> dict:
        return {"status":200, "result":config.MESSAGE_BOX_RATIO}

    @staticmethod
    def setMessageBoxRatio(data, *args, **kwargs) -> dict:
        config.MESSAGE_BOX_RATIO = data
        return {"status":200, "result":config.MESSAGE_BOX_RATIO}

    @staticmethod
    def getSendMessageButtonType(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SEND_MESSAGE_BUTTON_TYPE}

    @staticmethod
    def setSendMessageButtonType(data, *args, **kwargs) -> dict:
        config.SEND_MESSAGE_BUTTON_TYPE = data
        return {"status":200, "result":config.SEND_MESSAGE_BUTTON_TYPE}

    @staticmethod
    def getShowResendButton(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SHOW_RESEND_BUTTON}

    @staticmethod
    def setEnableShowResendButton(*args, **kwargs) -> dict:
        if config.SHOW_RESEND_BUTTON is False:
            config.SHOW_RESEND_BUTTON = True
        return {"status":200, "result":config.SHOW_RESEND_BUTTON}

    @staticmethod
    def setDisableShowResendButton(*args, **kwargs) -> dict:
        if config.SHOW_RESEND_BUTTON is True:
            config.SHOW_RESEND_BUTTON = False
        return {"status":200, "result":config.SHOW_RESEND_BUTTON}

    @staticmethod
    def getFontFamily(*args, **kwargs) -> dict:
        return {"status":200, "result":config.FONT_FAMILY}

    @staticmethod
    def setFontFamily(data, *args, **kwargs) -> dict:
        config.FONT_FAMILY = data
        return {"status":200, "result":config.FONT_FAMILY}

    @staticmethod
    def getFontDownloadPolicy(*args, **kwargs) -> dict:
        return {"status":200, "result":config.FONT_DOWNLOAD_POLICY}

    @staticmethod
    def setFontDownloadPolicy(data, *args, **kwargs) -> dict:
        config.FONT_DOWNLOAD_POLICY = data
        return {"status":200, "result":config.FONT_DOWNLOAD_POLICY}

    @staticmethod
    def getUiLanguage(*args, **kwargs) -> dict:
        return {"status":200, "result":config.UI_LANGUAGE}

    @staticmethod
    def setUiLanguage(data, *args, **kwargs) -> dict:
        config.UI_LANGUAGE = data
        return {"status":200, "result":config.UI_LANGUAGE}

    @staticmethod
    def getMainWindowGeometry(*args, **kwargs) -> dict:
        return {"status":200, "result":config.MAIN_WINDOW_GEOMETRY}

    @staticmethod
    def setMainWindowGeometry(data, *args, **kwargs) -> dict:
        config.MAIN_WINDOW_GEOMETRY = data
        return {"status":200, "result":config.MAIN_WINDOW_GEOMETRY}

    @staticmethod
    def getAutoMicSelect(*args, **kwargs) -> dict:
        return {"status":200, "result":config.AUTO_MIC_SELECT}

    def applyAutoMicSelect(self) -> None:
        device_manager.setCallbackProcessBeforeUpdateMicDevices(self.stopAccessMicDevices)
        device_manager.setCallbackDefaultMicDevice(self.updateSelectedMicDevice)
        device_manager.setCallbackProcessAfterUpdateMicDevices(self.restartAccessMicDevices)
        device_manager.forceUpdateAndSetMicDevices()
        device_manager.startMonitoring()

    def setEnableAutoMicSelect(self, *args, **kwargs) -> dict:
        if config.AUTO_MIC_SELECT is False:
            self.applyAutoMicSelect()
            config.AUTO_MIC_SELECT = True
        return {"status":200, "result":config.AUTO_MIC_SELECT}

    @staticmethod
    def setDisableAutoMicSelect(*args, **kwargs) -> dict:
        if config.AUTO_SPEAKER_SELECT is False:
            device_manager.stopMonitoring()

        if config.AUTO_MIC_SELECT is True:
            device_manager.clearCallbackProcessBeforeUpdateMicDevices()
            device_manager.clearCallbackDefaultMicDevice()
            device_manager.clearCallbackProcessAfterUpdateMicDevices()
            config.AUTO_MIC_SELECT = False
        return {"status":200, "result":config.AUTO_MIC_SELECT}

    @staticmethod
    def getSelectedMicHost(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SELECTED_MIC_HOST}

    def setSelectedMicHost(self, data, *args, **kwargs) -> dict:
        config.SELECTED_MIC_HOST = data
        config.SELECTED_MIC_DEVICE = model.getMicDefaultDevice()
        if config.ENABLE_CHECK_ENERGY_SEND is True:
            self.stopThreadingCheckMicEnergy()
            self.startThreadingTranscriptionSendMessage()
        self.run(200, self.run_mapping["selected_mic_device"], config.SELECTED_MIC_DEVICE)
        return {"status":200, "result":config.SELECTED_MIC_HOST}

    @staticmethod
    def getSelectedMicDevice(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SELECTED_MIC_DEVICE}

    def setSelectedMicDevice(self, data, *args, **kwargs) -> dict:
        config.SELECTED_MIC_DEVICE = data
        if config.ENABLE_CHECK_ENERGY_SEND is True:
            self.stopThreadingCheckMicEnergy()
            self.startThreadingTranscriptionSendMessage()
        return {"status":200, "result": config.SELECTED_MIC_DEVICE}

    @staticmethod
    def getMicThreshold(*args, **kwargs) -> dict:
        return {"status":200, "result":config.MIC_THRESHOLD}

    @staticmethod
    def setMicThreshold(data, *args, **kwargs) -> dict:
        try:
            data = int(data)
            if 0 <= data <= config.MAX_MIC_THRESHOLD:
                config.MIC_THRESHOLD = data
                status = 200
            else:
                raise ValueError()
        except Exception:
            response = VRCTError.create_error_response(
                ErrorCode.VALIDATION_MIC_THRESHOLD,
                data=config.MIC_THRESHOLD
            )
        else:
            response = {"status":status, "result":config.MIC_THRESHOLD}
        return response

    @staticmethod
    def getMicAutomaticThreshold(*args, **kwargs) -> dict:
        return {"status":200, "result":config.MIC_AUTOMATIC_THRESHOLD}

    @staticmethod
    def setEnableMicAutomaticThreshold(*args, **kwargs) -> dict:
        if config.MIC_AUTOMATIC_THRESHOLD is False:
            config.MIC_AUTOMATIC_THRESHOLD = True
        return {"status":200, "result":config.MIC_AUTOMATIC_THRESHOLD}

    @staticmethod
    def setDisableMicAutomaticThreshold(*args, **kwargs) -> dict:
        if config.MIC_AUTOMATIC_THRESHOLD is True:
            config.MIC_AUTOMATIC_THRESHOLD = False
        return {"status":200, "result":config.MIC_AUTOMATIC_THRESHOLD}

    @staticmethod
    def getMicRecordTimeout(*args, **kwargs) -> dict:
        return {"status":200, "result":config.MIC_RECORD_TIMEOUT}

    @staticmethod
    def setMicRecordTimeout(data, *args, **kwargs) -> dict:
        printLog("Set Mic Record Timeout", data)
        try:
            data = int(data)
            if 0 <= data <= config.MIC_PHRASE_TIMEOUT:
                config.MIC_RECORD_TIMEOUT = data
            else:
                raise ValueError()
        except Exception:
            response = VRCTError.create_error_response(
                ErrorCode.VALIDATION_MIC_RECORD_TIMEOUT,
                data=config.MIC_RECORD_TIMEOUT
            )
        else:
            response = {"status":200, "result":config.MIC_RECORD_TIMEOUT}
        return response

    @staticmethod
    def getMicPhraseTimeout(*args, **kwargs) -> dict:
        return {"status":200, "result":config.MIC_PHRASE_TIMEOUT}

    @staticmethod
    def setMicPhraseTimeout(data, *args, **kwargs) -> dict:
        try:
            data = int(data)
            if data >= config.MIC_RECORD_TIMEOUT:
                config.MIC_PHRASE_TIMEOUT = data
            else:
                raise ValueError()
        except Exception:
            response = VRCTError.create_error_response(
                ErrorCode.VALIDATION_MIC_PHRASE_TIMEOUT,
                data=config.MIC_PHRASE_TIMEOUT
            )
        else:
            response = {"status":200, "result":config.MIC_PHRASE_TIMEOUT}
        return response

    @staticmethod
    def getMicMaxPhrases(*args, **kwargs) -> dict:
        return {"status":200, "result":config.MIC_MAX_PHRASES}

    @staticmethod
    def setMicMaxPhrases(data, *args, **kwargs) -> dict:
        try:
            data = int(data)
            if 0 <= data:
                config.MIC_MAX_PHRASES = data
            else:
                raise ValueError()
        except Exception:
            response = VRCTError.create_error_response(
                ErrorCode.VALIDATION_MIC_MAX_PHRASES,
                data=config.MIC_MAX_PHRASES
            )
        else:
            response = {"status":200, "result":config.MIC_MAX_PHRASES}
        return response

    @staticmethod
    def getMicWordFilter(*args, **kwargs) -> dict:
        return {"status":200, "result":config.MIC_WORD_FILTER}

    @staticmethod
    def setMicWordFilter(data, *args, **kwargs) -> dict:
        config.MIC_WORD_FILTER = sorted(set(data), key=data.index)
        model.resetKeywordProcessor()
        model.addKeywords()
        return {"status":200, "result":config.MIC_WORD_FILTER}

    @staticmethod
    def getMicAvgLogprob(*args, **kwargs) -> dict:
        return {"status":200, "result":config.MIC_AVG_LOGPROB}

    @staticmethod
    def setMicAvgLogprob(data, *args, **kwargs) -> dict:
        config.MIC_AVG_LOGPROB = float(data)
        return {"status":200, "result":config.MIC_AVG_LOGPROB}

    @staticmethod
    def getMicNoSpeechProb(*args, **kwargs) -> dict:
        return {"status":200, "result":config.MIC_NO_SPEECH_PROB}

    @staticmethod
    def setMicNoSpeechProb(data, *args, **kwargs) -> dict:
        config.MIC_NO_SPEECH_PROB = float(data)
        return {"status":200, "result":config.MIC_NO_SPEECH_PROB}

    @staticmethod
    def getAutoSpeakerSelect(*args, **kwargs) -> dict:
        return {"status":200, "result":config.AUTO_SPEAKER_SELECT}

    def applyAutoSpeakerSelect(self) -> None:
        device_manager.setCallbackProcessBeforeUpdateSpeakerDevices(self.stopAccessSpeakerDevices)
        device_manager.setCallbackDefaultSpeakerDevice(self.updateSelectedSpeakerDevice)
        device_manager.setCallbackProcessAfterUpdateSpeakerDevices(self.restartAccessSpeakerDevices)
        device_manager.forceUpdateAndSetSpeakerDevices()
        device_manager.startMonitoring()

    def setEnableAutoSpeakerSelect(self, *args, **kwargs) -> dict:
        if config.AUTO_SPEAKER_SELECT is False:
            self.applyAutoSpeakerSelect()
            config.AUTO_SPEAKER_SELECT = True
        return {"status":200, "result":config.AUTO_SPEAKER_SELECT}

    @staticmethod
    def setDisableAutoSpeakerSelect(*args, **kwargs) -> dict:
        if config.AUTO_MIC_SELECT is False:
            device_manager.stopMonitoring()

        if config.AUTO_SPEAKER_SELECT is True:
            device_manager.clearCallbackProcessBeforeUpdateSpeakerDevices()
            device_manager.clearCallbackDefaultSpeakerDevice()
            device_manager.clearCallbackProcessAfterUpdateSpeakerDevices()
            config.AUTO_SPEAKER_SELECT = False
        return {"status":200, "result":config.AUTO_SPEAKER_SELECT}

    @staticmethod
    def getSelectedSpeakerDevice(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SELECTED_SPEAKER_DEVICE}

    def setSelectedSpeakerDevice(self, data, *args, **kwargs) -> dict:
        config.SELECTED_SPEAKER_DEVICE = data
        if config.ENABLE_CHECK_ENERGY_RECEIVE is True:
            self.stopThreadingCheckSpeakerEnergy()
            self.startThreadingTranscriptionReceiveMessage()
        return {"status":200, "result":config.SELECTED_SPEAKER_DEVICE}

    @staticmethod
    def getSpeakerThreshold(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SPEAKER_THRESHOLD}

    @staticmethod
    def setSpeakerThreshold(data, *args, **kwargs) -> dict:
        printLog("Set Speaker Energy Threshold", data)
        try:
            data = int(data)
            if 0 <= data <= config.MAX_SPEAKER_THRESHOLD:
                config.SPEAKER_THRESHOLD = data
            else:
                raise ValueError()
        except Exception:
            response = VRCTError.create_error_response(
                ErrorCode.VALIDATION_SPEAKER_THRESHOLD,
                data=config.SPEAKER_THRESHOLD
            )
        else:
            response = {"status":200, "result":config.SPEAKER_THRESHOLD}
        return response

    @staticmethod
    def getSpeakerAutomaticThreshold(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SPEAKER_AUTOMATIC_THRESHOLD}

    @staticmethod
    def setEnableSpeakerAutomaticThreshold(*args, **kwargs) -> dict:
        if config.SPEAKER_AUTOMATIC_THRESHOLD is False:
            config.SPEAKER_AUTOMATIC_THRESHOLD = True
        return {"status":200, "result":config.SPEAKER_AUTOMATIC_THRESHOLD}

    @staticmethod
    def setDisableSpeakerAutomaticThreshold(*args, **kwargs) -> dict:
        if config.SPEAKER_AUTOMATIC_THRESHOLD is True:
            config.SPEAKER_AUTOMATIC_THRESHOLD = False
        return {"status":200, "result":config.SPEAKER_AUTOMATIC_THRESHOLD}

    @staticmethod
    def getSpeakerRecordTimeout(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SPEAKER_RECORD_TIMEOUT}

    @staticmethod
    def setSpeakerRecordTimeout(data, *args, **kwargs) -> dict:
        try:
            data = int(data)
            if 0 <= data <= config.SPEAKER_PHRASE_TIMEOUT:
                config.SPEAKER_RECORD_TIMEOUT = data
            else:
                raise ValueError()
        except Exception:
            response = VRCTError.create_error_response(
                ErrorCode.VALIDATION_SPEAKER_RECORD_TIMEOUT,
                data=config.SPEAKER_RECORD_TIMEOUT
            )
        else:
            response = {"status":200, "result":config.SPEAKER_RECORD_TIMEOUT}
        return response

    @staticmethod
    def getSpeakerPhraseTimeout(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SPEAKER_PHRASE_TIMEOUT}

    @staticmethod
    def setSpeakerPhraseTimeout(data, *args, **kwargs) -> dict:
        try:
            data = int(data)
            if 0 <= data and data >= config.SPEAKER_RECORD_TIMEOUT:
                config.SPEAKER_PHRASE_TIMEOUT = data
            else:
                raise ValueError()
        except Exception:
            response = VRCTError.create_error_response(
                ErrorCode.VALIDATION_SPEAKER_PHRASE_TIMEOUT,
                data=config.SPEAKER_PHRASE_TIMEOUT
            )
        else:
            response = {"status":200, "result":config.SPEAKER_PHRASE_TIMEOUT}
        return response

    @staticmethod
    def getSpeakerMaxPhrases(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SPEAKER_MAX_PHRASES}

    @staticmethod
    def setSpeakerMaxPhrases(data, *args, **kwargs) -> dict:
        printLog("Set Speaker Max Phrases", data)
        try:
            data = int(data)
            if 0 <= data:
                config.SPEAKER_MAX_PHRASES = data
            else:
                raise ValueError()
        except Exception:
            response = VRCTError.create_error_response(
                ErrorCode.VALIDATION_SPEAKER_MAX_PHRASES,
                data=config.SPEAKER_MAX_PHRASES
            )
        else:
            response = {"status":200, "result":config.SPEAKER_MAX_PHRASES}
        return response

    @staticmethod
    def getHotkeys(*args, **kwargs) -> dict:
        return {"status":200, "result":config.HOTKEYS}

    @staticmethod
    def setHotkeys(data, *args, **kwargs) -> dict:
        config.HOTKEYS = data
        return {"status":200, "result":config.HOTKEYS}

    @staticmethod
    def getSpeakerAvgLogprob(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SPEAKER_AVG_LOGPROB}

    @staticmethod
    def setSpeakerAvgLogprob(data, *args, **kwargs) -> dict:
        config.SPEAKER_AVG_LOGPROB = float(data)
        return {"status":200, "result":config.SPEAKER_AVG_LOGPROB}

    @staticmethod
    def getSpeakerNoSpeechProb(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SPEAKER_NO_SPEECH_PROB}

    @staticmethod
    def setSpeakerNoSpeechProb(data, *args, **kwargs) -> dict:
        config.SPEAKER_NO_SPEECH_PROB = float(data)
        return {"status":200, "result":config.SPEAKER_NO_SPEECH_PROB}

    @staticmethod
    def getOscIpAddress(*args, **kwargs) -> dict:
        return {"status":200, "result":config.OSC_IP_ADDRESS}

    def setOscIpAddress(self, data, *args, **kwargs) -> dict:
        if isValidIpAddress(data) is False:
            response = VRCTError.create_error_response(
                ErrorCode.VALIDATION_INVALID_IP,
                data=config.OSC_IP_ADDRESS
            )
        else:
            try:
                model.setOscIpAddress(data)
                config.OSC_IP_ADDRESS = data
                if model.getIsOscQueryEnabled() is True:
                    self.enableOscQuery()
                else:
                    mute_sync_info_flag = False
                    if config.VRC_MIC_MUTE_SYNC is True:
                        self.setDisableVrcMicMuteSync()
                        mute_sync_info_flag = True
                    self.disableOscQuery(mute_sync_info=mute_sync_info_flag)

                response = {"status":200, "result":config.OSC_IP_ADDRESS}
            except Exception:
                model.setOscIpAddress(config.OSC_IP_ADDRESS)
                response = VRCTError.create_error_response(
                    ErrorCode.VALIDATION_CANNOT_SET_IP,
                    data=config.OSC_IP_ADDRESS
                )
        return response

    @staticmethod
    def getOscPort(*args, **kwargs) -> dict:
        return {"status":200, "result":config.OSC_PORT}

    @staticmethod
    def setOscPort(data, *args, **kwargs) -> dict:
        config.OSC_PORT = int(data)
        model.setOscPort(config.OSC_PORT)
        return {"status":200, "result":config.OSC_PORT}

    @staticmethod
    def getNotificationVrcSfx(*args, **kwargs) -> dict:
        return {"status":200, "result":config.NOTIFICATION_VRC_SFX}

    @staticmethod
    def setEnableNotificationVrcSfx(*args, **kwargs) -> dict:
        if config.NOTIFICATION_VRC_SFX is False:
            config.NOTIFICATION_VRC_SFX = True
        return {"status":200, "result":config.NOTIFICATION_VRC_SFX}

    @staticmethod
    def setDisableNotificationVrcSfx(*args, **kwargs) -> dict:
        if config.NOTIFICATION_VRC_SFX is True:
            config.NOTIFICATION_VRC_SFX = False
        return {"status":200, "result":config.NOTIFICATION_VRC_SFX}

    @staticmethod
    def getDeepLAuthKey(*args, **kwargs) -> dict:
        return {"status":200, "result":config.AUTH_KEYS["DeepL_API"]}

    def setDeeplAuthKey(self, data, *args, **kwargs) -> dict:
        printLog("Set DeepL Auth Key", data)
        translator_name = "DeepL_API"
        try:
            data = str(data)
            if len(data) == 36 or len(data) == 39:
                result = model.authenticationTranslatorDeepLAuthKey(auth_key=data)
                if result is True:
                    key = data
                    auth_keys = config.AUTH_KEYS
                    auth_keys[translator_name] = key
                    config.AUTH_KEYS = auth_keys
                    config.SELECTABLE_TRANSLATION_ENGINE_STATUS[translator_name] = True
                    self.updateTranslationEngineAndEngineList()
                    response = {"status":200, "result":config.AUTH_KEYS[translator_name]}
                else:
                    response = VRCTError.create_error_response(
                        ErrorCode.AUTH_DEEPL_FAILED,
                        data=config.AUTH_KEYS[translator_name]
                    )
            else:
                response = VRCTError.create_error_response(
                    ErrorCode.AUTH_DEEPL_LENGTH,
                    data=config.AUTH_KEYS[translator_name]
                )
        except Exception as e:
            errorLogging()
            response = VRCTError.create_exception_error_response(
                e,
                data=config.AUTH_KEYS[translator_name]
            )
        return response

    def delDeeplAuthKey(self, *args, **kwargs) -> dict:
        translator_name = "DeepL_API"
        auth_keys = config.AUTH_KEYS
        auth_keys[translator_name] = None
        config.AUTH_KEYS = auth_keys
        config.SELECTABLE_TRANSLATION_ENGINE_STATUS[translator_name] = False
        self.updateTranslationEngineAndEngineList()
        return {"status":200, "result":config.AUTH_KEYS[translator_name]}

    def getPlamoAuthKey(self, *args, **kwargs) -> dict:
        return {"status":200, "result":config.AUTH_KEYS["Plamo_API"]}

    def setPlamoAuthKey(self, data, *args, **kwargs) -> dict:
        printLog("Set Plamo Auth Key", data)
        translator_name = "Plamo_API"
        try:
            data = str(data)
            if len(data) >= 72:
                result = model.authenticationTranslatorPlamoAuthKey(auth_key=data)
                if result is True:
                    key = data
                    auth_keys = config.AUTH_KEYS
                    auth_keys[translator_name] = key
                    config.AUTH_KEYS = auth_keys
                    config.SELECTABLE_TRANSLATION_ENGINE_STATUS[translator_name] = True
                    config.SELECTABLE_PLAMO_MODEL_LIST = model.getTranslatorPlamoModelList()
                    self.run(200, self.run_mapping["selectable_plamo_model_list"], config.SELECTABLE_PLAMO_MODEL_LIST)
                    if config.SELECTED_PLAMO_MODEL not in config.SELECTABLE_PLAMO_MODEL_LIST:
                        config.SELECTED_PLAMO_MODEL = config.SELECTABLE_PLAMO_MODEL_LIST[0]
                    model.setTranslatorPlamoModel(model=config.SELECTED_PLAMO_MODEL)
                    self.run(200, self.run_mapping["selected_plamo_model"], config.SELECTED_PLAMO_MODEL)
                    model.updateTranslatorPlamoClient()
                    self.updateTranslationEngineAndEngineList()
                    response = {"status":200, "result":config.AUTH_KEYS[translator_name]}
                else:
                    response = VRCTError.create_error_response(
                        ErrorCode.AUTH_PLAMO_FAILED,
                        data=None
                    )
            else:
                response = VRCTError.create_error_response(
                    ErrorCode.AUTH_PLAMO_LENGTH,
                    data=None
                )
        except Exception as e:
            errorLogging()
            response = VRCTError.create_exception_error_response(
                e,
                data=None
            )
        if response["status"] == 400:
            self.delPlamoAuthKey()
        return response

    def delPlamoAuthKey(self, *args, **kwargs) -> dict:
        translator_name = "Plamo_API"
        auth_keys = config.AUTH_KEYS
        auth_keys[translator_name] = None
        config.AUTH_KEYS = auth_keys
        config.SELECTABLE_PLAMO_MODEL_LIST = []
        config.SELECTED_PLAMO_MODEL = None
        self.run(200, self.run_mapping["selectable_plamo_model_list"], config.SELECTABLE_PLAMO_MODEL_LIST)
        self.run(200, self.run_mapping["selected_plamo_model"], config.SELECTED_PLAMO_MODEL)
        config.SELECTABLE_TRANSLATION_ENGINE_STATUS[translator_name] = False
        self.updateTranslationEngineAndEngineList()
        return {"status":200, "result":config.AUTH_KEYS[translator_name]}

    def getPlamoModelList(self, *args, **kwargs) -> dict:
        return {"status":200, "result": config.SELECTABLE_PLAMO_MODEL_LIST}

    def getPlamoModel(self, *args, **kwargs) -> dict:
        return {"status":200, "result":config.SELECTED_PLAMO_MODEL}

    def setPlamoModel(self, data, *args, **kwargs) -> dict:
        printLog("Set Plamo Model", data)
        try:
            data = str(data)
            result = model.setTranslatorPlamoModel(model=data)
            if result is True:
                config.SELECTED_PLAMO_MODEL = data
                model.setTranslatorPlamoModel(model=config.SELECTED_PLAMO_MODEL)
                model.updateTranslatorPlamoClient()
                response = {"status":200, "result":config.SELECTED_PLAMO_MODEL}
            else:
                response = VRCTError.create_error_response(
                    ErrorCode.MODEL_PLAMO_INVALID,
                    data=config.SELECTED_PLAMO_MODEL
                )
        except Exception as e:
            errorLogging()
            response = VRCTError.create_exception_error_response(
                e,
                data=config.SELECTED_PLAMO_MODEL
            )
        return response

    def getGeminiAuthKey(self, *args, **kwargs) -> dict:
        return {"status":200, "result":config.AUTH_KEYS["Gemini_API"]}

    def setGeminiAuthKey(self, data, *args, **kwargs) -> dict:
        printLog("Set Gemini Auth Key", data)
        translator_name = "Gemini_API"
        try:
            data = str(data)
            if len(data) >= 39:
                result = model.authenticationTranslatorGeminiAuthKey(auth_key=data)
                if result is True:
                    key = data
                    auth_keys = config.AUTH_KEYS
                    auth_keys[translator_name] = key
                    config.AUTH_KEYS = auth_keys
                    config.SELECTABLE_TRANSLATION_ENGINE_STATUS[translator_name] = True
                    config.SELECTABLE_GEMINI_MODEL_LIST = model.getTranslatorGeminiModelList()
                    self.run(200, self.run_mapping["selectable_gemini_model_list"], config.SELECTABLE_GEMINI_MODEL_LIST)
                    if config.SELECTED_GEMINI_MODEL not in config.SELECTABLE_GEMINI_MODEL_LIST:
                        config.SELECTED_GEMINI_MODEL = config.SELECTABLE_GEMINI_MODEL_LIST[0]
                    model.setTranslatorGeminiModel(model=config.SELECTED_GEMINI_MODEL)
                    self.run(200, self.run_mapping["selected_gemini_model"], config.SELECTED_GEMINI_MODEL)
                    model.updateTranslatorGeminiClient()
                    self.updateTranslationEngineAndEngineList()
                    response = {"status":200, "result":config.AUTH_KEYS[translator_name]}
                else:
                    response = VRCTError.create_error_response(
                        ErrorCode.AUTH_GEMINI_FAILED,
                        data=None
                    )
            else:
                response = VRCTError.create_error_response(
                    ErrorCode.AUTH_GEMINI_LENGTH,
                    data=None
                )
        except Exception as e:
            errorLogging()
            response = VRCTError.create_exception_error_response(
                e,
                data=None
            )
        if response["status"] == 400:
            self.delGeminiAuthKey()
        return response

    def delGeminiAuthKey(self, *args, **kwargs) -> dict:
        translator_name = "Gemini_API"
        auth_keys = config.AUTH_KEYS
        auth_keys[translator_name] = None
        config.AUTH_KEYS = auth_keys
        config.SELECTABLE_GEMINI_MODEL_LIST = []
        config.SELECTED_GEMINI_MODEL = None
        self.run(200, self.run_mapping["selectable_gemini_model_list"], config.SELECTABLE_GEMINI_MODEL_LIST)
        self.run(200, self.run_mapping["selected_gemini_model"], config.SELECTED_GEMINI_MODEL)
        config.SELECTABLE_TRANSLATION_ENGINE_STATUS[translator_name] = False
        self.updateTranslationEngineAndEngineList()
        return {"status":200, "result":config.AUTH_KEYS[translator_name]}

    def getGeminiModelList(self, *args, **kwargs) -> dict:
        return {"status":200, "result": config.SELECTABLE_GEMINI_MODEL_LIST}

    def getGeminiModel(self, *args, **kwargs) -> dict:
        return {"status":200, "result":config.SELECTED_GEMINI_MODEL}

    def setGeminiModel(self, data, *args, **kwargs) -> dict:
        printLog("Set Gemini Model", data)
        try:
            data = str(data)
            result = model.setTranslatorGeminiModel(model=data)
            if result is True:
                config.SELECTED_GEMINI_MODEL = data
                model.setTranslatorGeminiModel(model=config.SELECTED_GEMINI_MODEL)
                model.updateTranslatorGeminiClient()
                response = {"status":200, "result":config.SELECTED_GEMINI_MODEL}
            else:
                response = VRCTError.create_error_response(
                    ErrorCode.MODEL_GEMINI_INVALID,
                    data=config.SELECTED_GEMINI_MODEL
                )
        except Exception as e:
            errorLogging()
            response = VRCTError.create_exception_error_response(
                e,
                data=config.SELECTED_GEMINI_MODEL
            )
        return response

    @staticmethod
    def getOpenAIAuthKey(*args, **kwargs) -> dict:
        return {"status":200, "result":config.AUTH_KEYS["OpenAI_API"]}

    @staticmethod
    def _deepSeekConfigured() -> bool:
        key = config.AUTH_KEYS.get("DeepSeek_API")
        return isinstance(key, str) and bool(key.strip())

    def _deepSeekStatus(self, health: str | None = None) -> dict:
        configured = self._deepSeekConfigured()
        if not configured:
            health = "not_configured"
        elif health is None:
            health = getattr(self, "_deepseek_health", "configured")
        return {"configured": configured, "health": health}

    def _deepSeekFailureResponse(self) -> dict:
        category = getattr(model.getTranslatorDeepSeekLastError(), "category", None)
        error_codes = {
            "invalid_credentials": ErrorCode.AUTH_DEEPSEEK_INVALID,
            "insufficient_balance": ErrorCode.AUTH_DEEPSEEK_INSUFFICIENT_BALANCE,
        }
        error_code = error_codes.get(category, ErrorCode.AUTH_DEEPSEEK_FAILED)
        self._deepseek_health = category if category in error_codes else "failed"
        config.SELECTABLE_TRANSLATION_ENGINE_STATUS["DeepSeek_API"] = False
        return VRCTError.create_error_response(error_code, data=self._deepSeekStatus())

    def _setDeepSeekStartupAvailability(self, status: bool) -> None:
        config.SELECTABLE_TRANSLATION_ENGINE_STATUS["DeepSeek_API"] = status
        if status:
            self._deepseek_health = "configured"
            return
        category = getattr(model.getTranslatorDeepSeekLastError(), "category", None)
        if category in ("invalid_credentials", "insufficient_balance"):
            self._deepseek_health = category
        elif self._deepSeekConfigured():
            self._deepseek_health = "failed"
        else:
            self._deepseek_health = "not_configured"

    def _normalizeDeepSeekModel(self) -> str:
        model_list = ["deepseek-v4-flash", "deepseek-v4-pro"]
        config.SELECTABLE_DEEPSEEK_MODEL_LIST = model_list
        if config.SELECTED_DEEPSEEK_MODEL not in model_list:
            config.SELECTED_DEEPSEEK_MODEL = model_list[0]
        return config.SELECTED_DEEPSEEK_MODEL

    def getDeepSeekAuthKey(self, *args, **kwargs) -> dict:
        return {"status": 200, "result": self._deepSeekStatus()}

    def setDeepSeekAuthKey(self, data, *args, **kwargs) -> dict:
        if not isinstance(data, str) or not data.strip():
            self._deepseek_health = "failed"
            return VRCTError.create_error_response(
                ErrorCode.AUTH_DEEPSEEK_FAILED,
                data=self._deepSeekStatus(),
            )

        try:
            authenticated = model.authenticationTranslatorDeepSeekAuthKey(auth_key=data)
        except Exception:
            errorLogging()
            authenticated = False

        if not authenticated:
            return self._deepSeekFailureResponse()

        auth_keys = dict(config.AUTH_KEYS)
        auth_keys["DeepSeek_API"] = data
        config.AUTH_KEYS = auth_keys
        config.SELECTABLE_TRANSLATION_ENGINE_STATUS["DeepSeek_API"] = True
        self._deepseek_health = "configured"
        selected_model = self._normalizeDeepSeekModel()
        model.setTranslatorDeepSeekModel(model=selected_model)
        model.updateTranslatorDeepSeekClient()
        self.run(200, self.run_mapping["selectable_deepseek_model_list"], config.SELECTABLE_DEEPSEEK_MODEL_LIST)
        self.run(200, self.run_mapping["selected_deepseek_model"], selected_model)
        self.updateTranslationEngineAndEngineList()
        return {"status": 200, "result": self._deepSeekStatus()}

    def delDeepSeekAuthKey(self, *args, **kwargs) -> dict:
        auth_keys = dict(config.AUTH_KEYS)
        auth_keys["DeepSeek_API"] = None
        config.AUTH_KEYS = auth_keys
        config.SELECTABLE_TRANSLATION_ENGINE_STATUS["DeepSeek_API"] = False
        config.SELECTED_DEEPSEEK_MODEL = "deepseek-v4-flash"
        config.SELECTABLE_DEEPSEEK_MODEL_LIST = ["deepseek-v4-flash", "deepseek-v4-pro"]
        self._deepseek_health = "not_configured"
        model.clearTranslatorDeepSeekClient()
        self.run(200, self.run_mapping["selectable_deepseek_model_list"], config.SELECTABLE_DEEPSEEK_MODEL_LIST)
        self.run(200, self.run_mapping["selected_deepseek_model"], config.SELECTED_DEEPSEEK_MODEL)
        self.updateTranslationEngineAndEngineList()
        return {"status": 200, "result": self._deepSeekStatus()}

    def checkDeepSeekConnection(self, *args, **kwargs) -> dict:
        if not self._deepSeekConfigured():
            self._deepseek_health = "not_configured"
            config.SELECTABLE_TRANSLATION_ENGINE_STATUS["DeepSeek_API"] = False
            return {"status": 200, "result": self._deepSeekStatus()}

        try:
            authenticated = model.authenticationTranslatorDeepSeekAuthKey(
                auth_key=config.AUTH_KEYS["DeepSeek_API"]
            )
        except Exception:
            authenticated = False
        if not authenticated:
            return self._deepSeekFailureResponse()

        config.SELECTABLE_TRANSLATION_ENGINE_STATUS["DeepSeek_API"] = True
        self._deepseek_health = "configured"
        selected_model = self._normalizeDeepSeekModel()
        model.setTranslatorDeepSeekModel(model=selected_model)
        model.updateTranslatorDeepSeekClient()
        self.run(200, self.run_mapping["selectable_deepseek_model_list"], config.SELECTABLE_DEEPSEEK_MODEL_LIST)
        self.run(200, self.run_mapping["selected_deepseek_model"], selected_model)
        return {"status": 200, "result": self._deepSeekStatus()}

    def getDeepSeekModelList(self, *args, **kwargs) -> dict:
        self._normalizeDeepSeekModel()
        return {"status": 200, "result": config.SELECTABLE_DEEPSEEK_MODEL_LIST}

    def getDeepSeekModel(self, *args, **kwargs) -> dict:
        return {"status": 200, "result": self._normalizeDeepSeekModel()}

    def setDeepSeekModel(self, data, *args, **kwargs) -> dict:
        if data not in ("deepseek-v4-flash", "deepseek-v4-pro"):
            return VRCTError.create_error_response(
                ErrorCode.MODEL_DEEPSEEK_INVALID,
                data=self._normalizeDeepSeekModel(),
            )
        if model.setTranslatorDeepSeekModel(model=data) is not True:
            return VRCTError.create_error_response(
                ErrorCode.MODEL_DEEPSEEK_INVALID,
                data=self._normalizeDeepSeekModel(),
            )
        config.SELECTED_DEEPSEEK_MODEL = data
        model.updateTranslatorDeepSeekClient()
        self.run(200, self.run_mapping["selected_deepseek_model"], data)
        return {"status": 200, "result": data}

    def setOpenAIAuthKey(self, data, *args, **kwargs) -> dict:
        printLog("Set OpenAI Auth Key", data)
        translator_name = "OpenAI_API"
        try:
            data = str(data)
            if data.startswith("sk-") and len(data) >= 164:
                result = model.authenticationTranslatorOpenAIAuthKey(auth_key=data)
                if result is True:
                    key = data
                    auth_keys = config.AUTH_KEYS
                    auth_keys[translator_name] = key
                    config.AUTH_KEYS = auth_keys
                    config.SELECTABLE_TRANSLATION_ENGINE_STATUS[translator_name] = True
                    config.SELECTABLE_OPENAI_MODEL_LIST = model.getTranslatorOpenAIModelList()
                    self.run(200, self.run_mapping["selectable_openai_model_list"], config.SELECTABLE_OPENAI_MODEL_LIST)
                    if config.SELECTED_OPENAI_MODEL not in config.SELECTABLE_OPENAI_MODEL_LIST:
                        config.SELECTED_OPENAI_MODEL = config.SELECTABLE_OPENAI_MODEL_LIST[0]
                    model.setTranslatorOpenAIModel(model=config.SELECTED_OPENAI_MODEL)
                    self.run(200, self.run_mapping["selected_openai_model"], config.SELECTED_OPENAI_MODEL)
                    model.updateTranslatorOpenAIClient()
                    self.updateTranslationEngineAndEngineList()
                    response = {"status":200, "result":config.AUTH_KEYS[translator_name]}
                else:
                    response = VRCTError.create_error_response(
                        ErrorCode.AUTH_OPENAI_FAILED,
                        data=None
                    )
            else:
                response = VRCTError.create_error_response(
                    ErrorCode.AUTH_OPENAI_INVALID,
                    data=None
                )
        except Exception as e:
            errorLogging()
            response = VRCTError.create_exception_error_response(
                e,
                data=None
            )
        if response["status"] == 400:
            self.delOpenAIAuthKey()
        return response

    def delOpenAIAuthKey(self, *args, **kwargs) -> dict:
        translator_name = "OpenAI_API"
        auth_keys = config.AUTH_KEYS
        auth_keys[translator_name] = None
        config.AUTH_KEYS = auth_keys
        config.SELECTABLE_OPENAI_MODEL_LIST = []
        config.SELECTED_OPENAI_MODEL = None
        self.run(200, self.run_mapping["selectable_openai_model_list"], config.SELECTABLE_OPENAI_MODEL_LIST)
        self.run(200, self.run_mapping["selected_openai_model"], config.SELECTED_OPENAI_MODEL)
        config.SELECTABLE_TRANSLATION_ENGINE_STATUS[translator_name] = False
        self.updateTranslationEngineAndEngineList()
        return {"status":200, "result":config.AUTH_KEYS[translator_name]}

    def getOpenAIModelList(self, *args, **kwargs) -> dict:
        return {"status":200, "result": config.SELECTABLE_OPENAI_MODEL_LIST}

    def getOpenAIModel(self, *args, **kwargs) -> dict:
        return {"status":200, "result":config.SELECTED_OPENAI_MODEL}

    def setOpenAIModel(self, data, *args, **kwargs) -> dict:
        printLog("Set OpenAI Model", data)
        try:
            data = str(data)
            result = model.setTranslatorOpenAIModel(model=data)
            if result is True:
                config.SELECTED_OPENAI_MODEL = data
                model.setTranslatorOpenAIModel(model=config.SELECTED_OPENAI_MODEL)
                model.updateTranslatorOpenAIClient()
                response = {"status":200, "result":config.SELECTED_OPENAI_MODEL}
            else:
                response = VRCTError.create_error_response(
                    ErrorCode.MODEL_OPENAI_INVALID,
                    data=config.SELECTED_OPENAI_MODEL
                )
        except Exception as e:
            errorLogging()
            response = VRCTError.create_exception_error_response(
                e,
                data=config.SELECTED_OPENAI_MODEL
            )
        return response

    @staticmethod
    def getGroqAuthKey(*args, **kwargs) -> dict:
        return {"status":200, "result":config.AUTH_KEYS["Groq_API"]}

    def setGroqAuthKey(self, data, *args, **kwargs) -> dict:
        printLog("Set Groq Auth Key", data)
        translator_name = "Groq_API"
        try:
            data = str(data)
            if data.startswith("gsk") and len(data) >= 40:
                result = model.authenticationTranslatorGroqAuthKey(auth_key=data)
                if result is True:
                    key = data
                    auth_keys = config.AUTH_KEYS
                    auth_keys[translator_name] = key
                    config.AUTH_KEYS = auth_keys
                    config.SELECTABLE_TRANSLATION_ENGINE_STATUS[translator_name] = True
                    config.SELECTABLE_GROQ_MODEL_LIST = model.getTranslatorGroqModelList()
                    self.run(200, self.run_mapping["selectable_groq_model_list"], config.SELECTABLE_GROQ_MODEL_LIST)
                    if config.SELECTED_GROQ_MODEL not in config.SELECTABLE_GROQ_MODEL_LIST:
                        config.SELECTED_GROQ_MODEL = config.SELECTABLE_GROQ_MODEL_LIST[0]
                    model.setTranslatorGroqModel(model=config.SELECTED_GROQ_MODEL)
                    self.run(200, self.run_mapping["selected_groq_model"], config.SELECTED_GROQ_MODEL)
                    model.updateTranslatorGroqClient()
                    self.updateTranslationEngineAndEngineList()
                    response = {"status":200, "result":config.AUTH_KEYS[translator_name]}
                else:
                    response = VRCTError.create_error_response(
                        ErrorCode.AUTH_GROQ_FAILED,
                        data=None
                    )
            else:
                response = VRCTError.create_error_response(
                    ErrorCode.AUTH_GROQ_INVALID,
                    data=None
                )
        except Exception as e:
            errorLogging()
            response = VRCTError.create_exception_error_response(
                e,
                data=None
            )
        if response["status"] == 400:
            self.delGroqAuthKey()
        return response

    def delGroqAuthKey(self, *args, **kwargs) -> dict:
        translator_name = "Groq_API"
        auth_keys = config.AUTH_KEYS
        auth_keys[translator_name] = None
        config.AUTH_KEYS = auth_keys
        config.SELECTABLE_GROQ_MODEL_LIST = []
        config.SELECTED_GROQ_MODEL = None
        self.run(200, self.run_mapping["selectable_groq_model_list"], config.SELECTABLE_GROQ_MODEL_LIST)
        self.run(200, self.run_mapping["selected_groq_model"], config.SELECTED_GROQ_MODEL)
        config.SELECTABLE_TRANSLATION_ENGINE_STATUS[translator_name] = False
        self.updateTranslationEngineAndEngineList()
        return {"status":200, "result":config.AUTH_KEYS[translator_name]}

    def getGroqModelList(self, *args, **kwargs) -> dict:
        return {"status":200, "result": config.SELECTABLE_GROQ_MODEL_LIST}

    def getGroqModel(self, *args, **kwargs) -> dict:
        return {"status":200, "result":config.SELECTED_GROQ_MODEL}

    def setGroqModel(self, data, *args, **kwargs) -> dict:
        printLog("Set Groq Model", data)
        try:
            data = str(data)
            result = model.setTranslatorGroqModel(model=data)
            if result is True:
                config.SELECTED_GROQ_MODEL = data
                model.setTranslatorGroqModel(model=config.SELECTED_GROQ_MODEL)
                model.updateTranslatorGroqClient()
                response = {"status":200, "result":config.SELECTED_GROQ_MODEL}
            else:
                response = VRCTError.create_error_response(
                    ErrorCode.MODEL_GROQ_INVALID,
                    data=config.SELECTED_GROQ_MODEL
                )
        except Exception as e:
            errorLogging()
            response = VRCTError.create_exception_error_response(
                e,
                data=config.SELECTED_GROQ_MODEL
            )
        return response

    @staticmethod
    def getOpenRouterAuthKey(*args, **kwargs) -> dict:
        return {"status":200, "result":config.AUTH_KEYS["OpenRouter_API"]}

    def setOpenRouterAuthKey(self, data, *args, **kwargs) -> dict:
        printLog("Set OpenRouter Auth Key", data)
        translator_name = "OpenRouter_API"
        try:
            data = str(data)
            if len(data) >= 20:  # OpenRouter API key basic validation
                result = model.authenticationTranslatorOpenRouterAuthKey(auth_key=data)
                if result is True:
                    key = data
                    auth_keys = config.AUTH_KEYS
                    auth_keys[translator_name] = key
                    config.AUTH_KEYS = auth_keys
                    config.SELECTABLE_TRANSLATION_ENGINE_STATUS[translator_name] = True
                    config.SELECTABLE_OPENROUTER_MODEL_LIST = model.getTranslatorOpenRouterModelList()
                    self.run(200, self.run_mapping["selectable_openrouter_model_list"], config.SELECTABLE_OPENROUTER_MODEL_LIST)
                    if config.SELECTED_OPENROUTER_MODEL not in config.SELECTABLE_OPENROUTER_MODEL_LIST:
                        config.SELECTED_OPENROUTER_MODEL = config.SELECTABLE_OPENROUTER_MODEL_LIST[0]
                    model.setTranslatorOpenRouterModel(model=config.SELECTED_OPENROUTER_MODEL)
                    self.run(200, self.run_mapping["selected_openrouter_model"], config.SELECTED_OPENROUTER_MODEL)
                    model.updateTranslatorOpenRouterClient()
                    self.updateTranslationEngineAndEngineList()
                    response = {"status":200, "result":config.AUTH_KEYS[translator_name]}
                else:
                    response = VRCTError.create_error_response(
                        ErrorCode.AUTH_OPENROUTER_FAILED,
                        data=None
                    )
            else:
                response = VRCTError.create_error_response(
                    ErrorCode.AUTH_OPENROUTER_INVALID,
                    data=None
                )
        except Exception as e:
            errorLogging()
            response = VRCTError.create_exception_error_response(
                e,
                data=None
            )
        if response["status"] == 400:
            self.delOpenRouterAuthKey()
        return response

    def delOpenRouterAuthKey(self, *args, **kwargs) -> dict:
        translator_name = "OpenRouter_API"
        auth_keys = config.AUTH_KEYS
        auth_keys[translator_name] = None
        config.AUTH_KEYS = auth_keys
        config.SELECTABLE_OPENROUTER_MODEL_LIST = []
        config.SELECTED_OPENROUTER_MODEL = None
        self.run(200, self.run_mapping["selectable_openrouter_model_list"], config.SELECTABLE_OPENROUTER_MODEL_LIST)
        self.run(200, self.run_mapping["selected_openrouter_model"], config.SELECTED_OPENROUTER_MODEL)
        config.SELECTABLE_TRANSLATION_ENGINE_STATUS[translator_name] = False
        self.updateTranslationEngineAndEngineList()
        return {"status":200, "result":config.AUTH_KEYS[translator_name]}

    def getOpenRouterModelList(self, *args, **kwargs) -> dict:
        return {"status":200, "result": config.SELECTABLE_OPENROUTER_MODEL_LIST}

    def getOpenRouterModel(self, *args, **kwargs) -> dict:
        return {"status":200, "result":config.SELECTED_OPENROUTER_MODEL}

    def setOpenRouterModel(self, data, *args, **kwargs) -> dict:
        printLog("Set OpenRouter Model", data)
        try:
            data = str(data)
            result = model.setTranslatorOpenRouterModel(model=data)
            if result is True:
                config.SELECTED_OPENROUTER_MODEL = data
                model.setTranslatorOpenRouterModel(model=config.SELECTED_OPENROUTER_MODEL)
                model.updateTranslatorOpenRouterClient()
                response = {"status":200, "result":config.SELECTED_OPENROUTER_MODEL}
            else:
                response = VRCTError.create_error_response(
                    ErrorCode.MODEL_OPENROUTER_INVALID,
                    data=config.SELECTED_OPENROUTER_MODEL
                )
        except Exception as e:
            errorLogging()
            response = VRCTError.create_exception_error_response(
                e,
                data=config.SELECTED_OPENROUTER_MODEL
            )
        return response

    def getTranslatorLMStudioConnection(self, *args, **kwargs) -> dict:
        return {"status":200, "result":model.getTranslatorLMStudioConnected()}

    def checkTranslatorLMStudioConnection(self, *args, **kwargs) -> dict:
        printLog("Check Translator LMStudio Connection")
        translator_name = "LMStudio"
        try:
            result = model.authenticationTranslatorLMStudio(base_url=config.LMSTUDIO_URL)
            if result is True:
                config.SELECTABLE_TRANSLATION_ENGINE_STATUS[translator_name] = True
                config.SELECTABLE_LMSTUDIO_MODEL_LIST = model.getTranslatorLMStudioModelList()
                self.run(200, self.run_mapping["selectable_lmstudio_model_list"], config.SELECTABLE_LMSTUDIO_MODEL_LIST)
                if len(config.SELECTABLE_LMSTUDIO_MODEL_LIST) == 0:
                    raise Exception("No LMStudio models available")
                if config.SELECTED_LMSTUDIO_MODEL not in config.SELECTABLE_LMSTUDIO_MODEL_LIST:
                    config.SELECTED_LMSTUDIO_MODEL = config.SELECTABLE_LMSTUDIO_MODEL_LIST[0]
                model.setTranslatorLMStudioModel(model=config.SELECTED_LMSTUDIO_MODEL)
                self.run(200, self.run_mapping["selected_lmstudio_model"], config.SELECTED_LMSTUDIO_MODEL)
                model.updateTranslatorLMStudioClient()
                self.updateTranslationEngineAndEngineList()
                response = {"status":200, "result":True}
            else:
                config.SELECTABLE_TRANSLATION_ENGINE_STATUS[translator_name] = False
                config.SELECTABLE_LMSTUDIO_MODEL_LIST = []
                config.SELECTED_LMSTUDIO_MODEL = None
                self.run(200, self.run_mapping["selectable_lmstudio_model_list"], config.SELECTABLE_LMSTUDIO_MODEL_LIST)
                self.run(200, self.run_mapping["selected_lmstudio_model"], config.SELECTED_LMSTUDIO_MODEL)
                self.updateTranslationEngineAndEngineList()
                response = VRCTError.create_error_response(
                    ErrorCode.CONNECTION_LMSTUDIO_FAILED,
                    data=False
                )
        except Exception as e:
            errorLogging()
            config.SELECTABLE_TRANSLATION_ENGINE_STATUS[translator_name] = False
            config.SELECTABLE_LMSTUDIO_MODEL_LIST = []
            config.SELECTED_LMSTUDIO_MODEL = None
            self.run(200, self.run_mapping["selectable_lmstudio_model_list"], config.SELECTABLE_LMSTUDIO_MODEL_LIST)
            self.run(200, self.run_mapping["selected_lmstudio_model"], config.SELECTED_LMSTUDIO_MODEL)
            self.updateDownloadedCTranslate2ModelWeight(scan_all=True)
            self.updateDownloadedWhisperModelWeight(scan_all=True)
            self.updateDownloadedVoskModelWeight(scan_all=True)
            self.updateDownloadedParakeetModelWeight(scan_all=True)
            self.updateDownloadedSenseVoiceModelWeight(scan_all=True)
            self.updateTranslationEngineAndEngineList()
            response = VRCTError.create_exception_error_response(
                e,
                data=False
            )
        return response

    def getConnectedLMStudio(self, *args, **kwargs) -> dict:
        is_connected = model.getTranslatorLMStudioConnected()
        return {"status":200, "result": is_connected}

    def getTranslatorLMStudioURL(self, *args, **kwargs) -> dict:
        return {"status":200, "result":config.LMSTUDIO_URL}

    def setTranslatorLMStudioURL(self, data, *args, **kwargs) -> dict:
        printLog("Set Translator LMStudio URL", data)
        translator_name = "LMStudio"
        try:
            data = str(data)
            result = model.authenticationTranslatorLMStudio(base_url=data)
            if result is True:
                config.LMSTUDIO_URL = data
                config.SELECTABLE_TRANSLATION_ENGINE_STATUS[translator_name] = True
                config.SELECTABLE_LMSTUDIO_MODEL_LIST = model.getTranslatorLMStudioModelList()
                self.run(200, self.run_mapping["selectable_lmstudio_model_list"], config.SELECTABLE_LMSTUDIO_MODEL_LIST)
                if len(config.SELECTABLE_LMSTUDIO_MODEL_LIST) == 0:
                    raise Exception("No LMStudio models available")
                if config.SELECTED_LMSTUDIO_MODEL not in config.SELECTABLE_LMSTUDIO_MODEL_LIST:
                    config.SELECTED_LMSTUDIO_MODEL = config.SELECTABLE_LMSTUDIO_MODEL_LIST[0]
                model.setTranslatorLMStudioModel(model=config.SELECTED_LMSTUDIO_MODEL)
                self.run(200, self.run_mapping["selected_lmstudio_model"], config.SELECTED_LMSTUDIO_MODEL)
                model.updateTranslatorLMStudioClient()
                self.updateTranslationEngineAndEngineList()
                response = {"status":200, "result":config.LMSTUDIO_URL}
            else:
                config.SELECTABLE_TRANSLATION_ENGINE_STATUS[translator_name] = False
                config.SELECTABLE_LMSTUDIO_MODEL_LIST = []
                config.SELECTED_LMSTUDIO_MODEL = None
                self.run(200, self.run_mapping["selectable_lmstudio_model_list"], config.SELECTABLE_LMSTUDIO_MODEL_LIST)
                self.run(200, self.run_mapping["selected_lmstudio_model"], config.SELECTED_LMSTUDIO_MODEL)
                self.updateTranslationEngineAndEngineList()
                response = VRCTError.create_error_response(
                    ErrorCode.CONNECTION_LMSTUDIO_URL_INVALID,
                    data=config.LMSTUDIO_URL
                )
        except Exception as e:
            errorLogging()
            config.SELECTABLE_TRANSLATION_ENGINE_STATUS[translator_name] = False
            config.SELECTABLE_LMSTUDIO_MODEL_LIST = []
            config.SELECTED_LMSTUDIO_MODEL = None
            self.run(200, self.run_mapping["selectable_lmstudio_model_list"], config.SELECTABLE_LMSTUDIO_MODEL_LIST)
            self.run(200, self.run_mapping["selected_lmstudio_model"], config.SELECTED_LMSTUDIO_MODEL)
            self.updateTranslationEngineAndEngineList()
            response = VRCTError.create_exception_error_response(
                e,
                data=config.LMSTUDIO_URL
            )
        return response

    def getTranslatorLStudioModelList(self, *args, **kwargs) -> dict:
        model_list = model.getTranslatorLMStudioModelList()
        return {"status":200, "result": model_list}

    def getTranslatorLMStudioModel(self, *args, **kwargs) -> dict:
        return {"status":200, "result":config.SELECTED_LMSTUDIO_MODEL}

    def setTranslatorLMStudioModel(self, data, *args, **kwargs) -> dict:
        printLog("Set Translator LMStudio Model", data)
        try:
            data = str(data)
            result = model.setTranslatorLMStudioModel(model=data)
            if result is True:
                config.SELECTED_LMSTUDIO_MODEL = data
                model.setTranslatorLMStudioModel(model=config.SELECTED_LMSTUDIO_MODEL)
                model.updateTranslatorLMStudioClient()
                response = {"status":200, "result":config.SELECTED_LMSTUDIO_MODEL}
            else:
                response = VRCTError.create_error_response(
                    ErrorCode.MODEL_LMSTUDIO_INVALID,
                    data=config.SELECTED_LMSTUDIO_MODEL
                )
        except Exception as e:
            errorLogging()
            response = VRCTError.create_exception_error_response(
                e,
                data=config.SELECTED_LMSTUDIO_MODEL
            )
        return response

    def getTranslatorOllamaConnection(self, *args, **kwargs) -> dict:
        return {"status":200, "result":model.getTranslatorOllamaConnected()}

    def checkTranslatorOllamaConnection(self, *args, **kwargs) -> dict:
        printLog("Check Translator Ollama Connection")
        translator_name = "Ollama"
        try:
            result = model.authenticationTranslatorOllama()
            if result is True:
                config.SELECTABLE_TRANSLATION_ENGINE_STATUS[translator_name] = True
                config.SELECTABLE_OLLAMA_MODEL_LIST = model.getTranslatorOllamaModelList()
                self.run(200, self.run_mapping["selectable_ollama_model_list"], config.SELECTABLE_OLLAMA_MODEL_LIST)
                if len(config.SELECTABLE_OLLAMA_MODEL_LIST) == 0:
                    raise Exception("No Ollama models available")
                if config.SELECTED_OLLAMA_MODEL not in config.SELECTABLE_OLLAMA_MODEL_LIST:
                    config.SELECTED_OLLAMA_MODEL = config.SELECTABLE_OLLAMA_MODEL_LIST[0]
                model.setTranslatorOllamaModel(model=config.SELECTED_OLLAMA_MODEL)
                self.run(200, self.run_mapping["selected_ollama_model"], config.SELECTED_OLLAMA_MODEL)
                model.updateTranslatorOllamaClient()
                self.updateTranslationEngineAndEngineList()
                response = {"status":200, "result":True}
            else:
                config.SELECTABLE_TRANSLATION_ENGINE_STATUS[translator_name] = False
                config.SELECTABLE_OLLAMA_MODEL_LIST = []
                config.SELECTED_OLLAMA_MODEL = None
                self.run(200, self.run_mapping["selectable_ollama_model_list"], config.SELECTABLE_OLLAMA_MODEL_LIST)
                self.run(200, self.run_mapping["selected_ollama_model"], config.SELECTED_OLLAMA_MODEL)
                self.updateTranslationEngineAndEngineList()
                response = VRCTError.create_error_response(
                    ErrorCode.CONNECTION_OLLAMA_FAILED,
                    data=False
                )
        except Exception as e:
            errorLogging()
            config.SELECTABLE_TRANSLATION_ENGINE_STATUS[translator_name] = False
            config.SELECTABLE_OLLAMA_MODEL_LIST = []
            config.SELECTED_OLLAMA_MODEL = None
            self.run(200, self.run_mapping["selectable_ollama_model_list"], config.SELECTABLE_OLLAMA_MODEL_LIST)
            self.run(200, self.run_mapping["selected_ollama_model"], config.SELECTED_OLLAMA_MODEL)
            self.updateTranslationEngineAndEngineList()
            response = VRCTError.create_exception_error_response(
                e,
                data=False
            )
        return response

    def getTranslatorOllamaModelList(self, *args, **kwargs) -> dict:
        model_list = model.getTranslatorOllamaModelList()
        return {"status":200, "result": model_list}

    def getTranslatorOllamaModel(self, *args, **kwargs) -> dict:
        return {"status":200, "result":config.SELECTED_OLLAMA_MODEL}

    def setTranslatorOllamaModel(self, data, *args, **kwargs) -> dict:
        printLog("Set Translator Ollama Model", data)
        try:
            data = str(data)
            result = model.setTranslatorOllamaModel(model=data)
            if result is True:
                config.SELECTED_OLLAMA_MODEL = data
                model.setTranslatorOllamaModel(model=config.SELECTED_OLLAMA_MODEL)
                model.updateTranslatorOllamaClient()
                response = {"status":200, "result":config.SELECTED_OLLAMA_MODEL}
            else:
                response = VRCTError.create_error_response(
                    ErrorCode.MODEL_OLLAMA_INVALID,
                    data=config.SELECTED_OLLAMA_MODEL
                )
        except Exception as e:
            errorLogging()
            response = VRCTError.create_exception_error_response(
                e,
                data=config.SELECTED_OLLAMA_MODEL
            )
        return response

    @staticmethod
    def getCtranslate2WeightType(*args, **kwargs) -> dict:
        return {"status":200, "result":config.CTRANSLATE2_WEIGHT_TYPE}

    def setCtranslate2WeightType(self, data, *args, **kwargs) -> dict:
        with self._translation_activation_lock:
            previous_value = config.CTRANSLATE2_WEIGHT_TYPE
            config.CTRANSLATE2_WEIGHT_TYPE = str(data)
            model.setChangedTranslatorParameters(True)
            try:
                self._refreshActiveCTranslate2Readiness()
            except Exception as error:
                config.CTRANSLATE2_WEIGHT_TYPE = previous_value
                model.setChangedTranslatorParameters(True)
                try:
                    self._refreshActiveCTranslate2Readiness()
                except Exception:
                    errorLogging()
                return self._translationActivationError(
                    error,
                    preserve_enabled=True,
                )
            return {"status":200, "result":config.CTRANSLATE2_WEIGHT_TYPE}

    @staticmethod
    def getSelectedTranslationComputeType(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SELECTED_TRANSLATION_COMPUTE_TYPE}

    def setSelectedTranslationComputeType(self, data, *args, **kwargs) -> dict:
        with self._translation_activation_lock:
            previous_value = config.SELECTED_TRANSLATION_COMPUTE_TYPE
            config.SELECTED_TRANSLATION_COMPUTE_TYPE = str(data)
            model.setChangedTranslatorParameters(True)
            try:
                self._refreshActiveCTranslate2Readiness()
            except Exception as error:
                config.SELECTED_TRANSLATION_COMPUTE_TYPE = previous_value
                model.setChangedTranslatorParameters(True)
                try:
                    self._refreshActiveCTranslate2Readiness()
                except Exception:
                    errorLogging()
                return self._translationActivationError(
                    error,
                    preserve_enabled=True,
                )
            return {
                "status":200,
                "result":config.SELECTED_TRANSLATION_COMPUTE_TYPE,
            }

    @staticmethod
    def getWhisperWeightType(*args, **kwargs) -> dict:
        return {"status":200, "result":config.WHISPER_WEIGHT_TYPE}

    def setWhisperWeightType(self, data, *args, **kwargs) -> dict:
        response = self.setTranscriptionProfileAll(
            {"models": {"Whisper": str(data)}}
        )
        return self._transcriptionProfileScalarResponse(
            response, lambda profile: profile["models"]["Whisper"]
        )

    @staticmethod
    def getWhisperDecodingProfile(*args, **kwargs) -> dict:
        return {"status": 200, "result": config.WHISPER_DECODING_PROFILE}

    def setWhisperDecodingProfile(self, data, *args, **kwargs) -> dict:
        response = self.setTranscriptionProfileAll(
            {"whisper_decoding_profile": str(data).lower()}
        )
        return self._transcriptionProfileScalarResponse(
            response, lambda profile: profile["whisper_decoding_profile"]
        )

    @staticmethod
    def getVoskWeightType(*args, **kwargs) -> dict:
        return {"status":200, "result":config.VOSK_WEIGHT_TYPE}

    def setVoskWeightType(self, data, *args, **kwargs) -> dict:
        response = self.setTranscriptionProfileAll(
            {"models": {"Vosk": str(data)}}
        )
        return self._transcriptionProfileScalarResponse(
            response, lambda profile: profile["models"]["Vosk"]
        )

    @staticmethod
    def getParakeetWeightType(*args, **kwargs) -> dict:
        return {"status":200, "result":config.PARAKEET_WEIGHT_TYPE}

    def setParakeetWeightType(self, data, *args, **kwargs) -> dict:
        response = self.setTranscriptionProfileAll(
            {"models": {"Parakeet": str(data)}}
        )
        return self._transcriptionProfileScalarResponse(
            response, lambda profile: profile["models"]["Parakeet"]
        )

    @staticmethod
    def getSenseVoiceWeightType(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SENSEVOICE_WEIGHT_TYPE}

    def setSenseVoiceWeightType(self, data, *args, **kwargs) -> dict:
        response = self.setTranscriptionProfileAll(
            {"models": {"SenseVoice": str(data)}}
        )
        return self._transcriptionProfileScalarResponse(
            response, lambda profile: profile["models"]["SenseVoice"]
        )

    @staticmethod
    def getSelectedTranscriptionComputeType(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SELECTED_TRANSCRIPTION_COMPUTE_TYPE}

    def _getSelectedTranscriptionComputeTypeForSource(
        self,
        source: PipelineSource,
    ) -> dict:
        _engine, _device, compute_type = self._getSourceTranscriptionRuntimeSettings(
            source
        )
        return {"status": 200, "result": compute_type}

    def getSelectedTranscriptionComputeTypeSend(self, *args, **kwargs) -> dict:
        return self._getSelectedTranscriptionComputeTypeForSource(PipelineSource.MIC)

    def getSelectedTranscriptionComputeTypeReceive(self, *args, **kwargs) -> dict:
        return self._getSelectedTranscriptionComputeTypeForSource(PipelineSource.SPEAKER)

    def setSelectedTranscriptionComputeType(self, data, *args, **kwargs) -> dict:
        response = self.setTranscriptionProfileAll({"compute_type": str(data)})
        return self._transcriptionProfileScalarResponse(
            response, lambda profile: profile["compute_type"]
        )

    def _setSelectedTranscriptionComputeTypeForOneSource(
        self,
        source: PipelineSource,
        data,
    ) -> dict:
        response = self._setTranscriptionProfileForSource(
            source,
            {"compute_type": str(data)},
        )
        return self._transcriptionProfileScalarResponse(
            response, lambda profile: profile["compute_type"]
        )

    def setSelectedTranscriptionComputeTypeSend(self, data, *args, **kwargs) -> dict:
        return self._setSelectedTranscriptionComputeTypeForOneSource(
            PipelineSource.MIC,
            data,
        )

    def setSelectedTranscriptionComputeTypeReceive(self, data, *args, **kwargs) -> dict:
        return self._setSelectedTranscriptionComputeTypeForOneSource(
            PipelineSource.SPEAKER,
            data,
        )

    @staticmethod
    def getSendMessageFormatParts(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SEND_MESSAGE_FORMAT_PARTS}

    @staticmethod
    def setSendMessageFormatParts(data, *args, **kwargs) -> dict:
        config.SEND_MESSAGE_FORMAT_PARTS = dict(data)
        return {"status":200, "result":config.SEND_MESSAGE_FORMAT_PARTS}

    @staticmethod
    def getReceivedMessageFormatParts(*args, **kwargs) -> dict:
        return {"status":200, "result":config.RECEIVED_MESSAGE_FORMAT_PARTS}

    @staticmethod
    def setReceivedMessageFormatParts(data, *args, **kwargs) -> dict:
        config.RECEIVED_MESSAGE_FORMAT_PARTS = dict(data)
        return {"status":200, "result":config.RECEIVED_MESSAGE_FORMAT_PARTS}

    @staticmethod
    def getAutoClearMessageBox(*args, **kwargs) -> dict:
        return {"status":200, "result":config.AUTO_CLEAR_MESSAGE_BOX}

    @staticmethod
    def setEnableAutoClearMessageBox(*args, **kwargs) -> dict:
        if config.AUTO_CLEAR_MESSAGE_BOX is False:
            config.AUTO_CLEAR_MESSAGE_BOX = True
        return {"status":200, "result":config.AUTO_CLEAR_MESSAGE_BOX}

    @staticmethod
    def setDisableAutoClearMessageBox(*args, **kwargs) -> dict:
        if config.AUTO_CLEAR_MESSAGE_BOX is True:
            config.AUTO_CLEAR_MESSAGE_BOX = False
        return {"status":200, "result":config.AUTO_CLEAR_MESSAGE_BOX}

    @staticmethod
    def getSendOnlyTranslatedMessages(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SEND_ONLY_TRANSLATED_MESSAGES}

    @staticmethod
    def setEnableSendOnlyTranslatedMessages(*args, **kwargs) -> dict:
        if config.SEND_ONLY_TRANSLATED_MESSAGES is False:
            config.SEND_ONLY_TRANSLATED_MESSAGES = True
        return {"status":200, "result":config.SEND_ONLY_TRANSLATED_MESSAGES}

    @staticmethod
    def setDisableSendOnlyTranslatedMessages(*args, **kwargs) -> dict:
        if config.SEND_ONLY_TRANSLATED_MESSAGES is True:
            config.SEND_ONLY_TRANSLATED_MESSAGES = False
        return {"status":200, "result":config.SEND_ONLY_TRANSLATED_MESSAGES}

    @staticmethod
    def getOverlaySmallLog(*args, **kwargs) -> dict:
        return {"status":200, "result":config.OVERLAY_SMALL_LOG}

    @staticmethod
    def setEnableOverlaySmallLog(*args, **kwargs) -> dict:
        model.startOverlay()
        if config.OVERLAY_SMALL_LOG is False:
            config.OVERLAY_SMALL_LOG = True
        return {"status":200, "result":config.OVERLAY_SMALL_LOG}

    @staticmethod
    def setDisableOverlaySmallLog(*args, **kwargs) -> dict:
        if config.OVERLAY_SMALL_LOG is True:
            model.clearOverlayImageSmallLog()
            if config.OVERLAY_LARGE_LOG is False:
                model.shutdownOverlay()
            config.OVERLAY_SMALL_LOG = False
        return {"status":200, "result":config.OVERLAY_SMALL_LOG}

    @staticmethod
    def getOverlaySmallLogSettings(*args, **kwargs) -> dict:
        return {"status":200, "result":config.OVERLAY_SMALL_LOG_SETTINGS}

    @staticmethod
    def setOverlaySmallLogSettings(data, *args, **kwargs) -> dict:
        config.OVERLAY_SMALL_LOG_SETTINGS = data
        model.updateOverlaySmallLogSettings()
        return {"status":200, "result":config.OVERLAY_SMALL_LOG_SETTINGS}

    @staticmethod
    def getOverlayLargeLog(*args, **kwargs) -> dict:
        return {"status":200, "result":config.OVERLAY_LARGE_LOG}

    @staticmethod
    def setEnableOverlayLargeLog(*args, **kwargs) -> dict:
        model.startOverlay()
        if config.OVERLAY_LARGE_LOG is False:
            config.OVERLAY_LARGE_LOG = True
        return {"status":200, "result":config.OVERLAY_LARGE_LOG}

    @staticmethod
    def setDisableOverlayLargeLog(*args, **kwargs) -> dict:
        if config.OVERLAY_LARGE_LOG is True:
            model.clearOverlayImageLargeLog()
            if config.OVERLAY_SMALL_LOG is False:
                model.shutdownOverlay()
            config.OVERLAY_LARGE_LOG = False
        return {"status":200, "result":config.OVERLAY_LARGE_LOG}

    @staticmethod
    def getOverlayLargeLogSettings(*args, **kwargs) -> dict:
        return {"status":200, "result":config.OVERLAY_LARGE_LOG_SETTINGS}

    @staticmethod
    def setOverlayLargeLogSettings(data, *args, **kwargs) -> dict:
        config.OVERLAY_LARGE_LOG_SETTINGS = data
        model.updateOverlayLargeLogSettings()
        return {"status":200, "result":config.OVERLAY_LARGE_LOG_SETTINGS}

    @staticmethod
    def getOverlayShowOnlyTranslatedMessages(*args, **kwargs) -> dict:
        return {"status":200, "result":config.OVERLAY_SHOW_ONLY_TRANSLATED_MESSAGES}

    @staticmethod
    def setEnableOverlayShowOnlyTranslatedMessages(*args, **kwargs) -> dict:
        if config.OVERLAY_SHOW_ONLY_TRANSLATED_MESSAGES is False:
            config.OVERLAY_SHOW_ONLY_TRANSLATED_MESSAGES = True
        return {"status":200, "result":config.OVERLAY_SHOW_ONLY_TRANSLATED_MESSAGES}

    @staticmethod
    def setDisableOverlayShowOnlyTranslatedMessages(*args, **kwargs) -> dict:
        if config.OVERLAY_SHOW_ONLY_TRANSLATED_MESSAGES is True:
            config.OVERLAY_SHOW_ONLY_TRANSLATED_MESSAGES = False
        return {"status":200, "result":config.OVERLAY_SHOW_ONLY_TRANSLATED_MESSAGES}

    @staticmethod
    def getSendMessageToVrc(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SEND_MESSAGE_TO_VRC}

    @staticmethod
    def setEnableSendMessageToVrc(*args, **kwargs) -> dict:
        if config.SEND_MESSAGE_TO_VRC is False:
            config.SEND_MESSAGE_TO_VRC = True
        return {"status":200, "result":config.SEND_MESSAGE_TO_VRC}

    @staticmethod
    def setDisableSendMessageToVrc(*args, **kwargs) -> dict:
        if config.SEND_MESSAGE_TO_VRC is True:
            config.SEND_MESSAGE_TO_VRC = False
        return {"status":200, "result":config.SEND_MESSAGE_TO_VRC}

    @staticmethod
    def getSendReceivedMessageToVrc(*args, **kwargs) -> dict:
        return {"status":200, "result":config.SEND_RECEIVED_MESSAGE_TO_VRC}

    @staticmethod
    def setEnableSendReceivedMessageToVrc(*args, **kwargs) -> dict:
        if config.SEND_RECEIVED_MESSAGE_TO_VRC is False:
            config.SEND_RECEIVED_MESSAGE_TO_VRC = True
        return {"status":200, "result":config.SEND_RECEIVED_MESSAGE_TO_VRC}

    @staticmethod
    def setDisableSendReceivedMessageToVrc(*args, **kwargs) -> dict:
        if config.SEND_RECEIVED_MESSAGE_TO_VRC is True:
            config.SEND_RECEIVED_MESSAGE_TO_VRC = False
        return {"status":200, "result":config.SEND_RECEIVED_MESSAGE_TO_VRC}

    @staticmethod
    def getLoggerFeature(*args, **kwargs) -> dict:
        return {"status":200, "result":config.LOGGER_FEATURE}

    @staticmethod
    def setEnableLoggerFeature(*args, **kwargs) -> dict:
        if config.LOGGER_FEATURE is False:
            model.startLogger()
            config.LOGGER_FEATURE = True
        return {"status":200, "result":config.LOGGER_FEATURE}

    @staticmethod
    def setDisableLoggerFeature(*args, **kwargs) -> dict:
        if config.LOGGER_FEATURE is True:
            model.stopLogger()
            config.LOGGER_FEATURE = False
        return {"status":200, "result":config.LOGGER_FEATURE}

    @staticmethod
    def getVrcMicMuteSync(*args, **kwargs) -> dict:
        return {"status":200, "result":config.VRC_MIC_MUTE_SYNC}

    @staticmethod
    def setEnableVrcMicMuteSync(*args, **kwargs) -> dict:
        if config.VRC_MIC_MUTE_SYNC is False:
            if model.getIsOscQueryEnabled() is True:
                config.VRC_MIC_MUTE_SYNC = True
                model.setMuteSelfStatus()
                model.changeMicTranscriptStatus()
                response = {"status":200, "result":config.VRC_MIC_MUTE_SYNC}
            else:
                response = VRCTError.create_error_response(
                    ErrorCode.VRC_MIC_MUTE_SYNC_OSC_DISABLED,
                    data=config.VRC_MIC_MUTE_SYNC
                )
        else:
            response = {"status":200, "result":config.VRC_MIC_MUTE_SYNC}
        return response

    @staticmethod
    def setDisableVrcMicMuteSync(*args, **kwargs) -> dict:
        if config.VRC_MIC_MUTE_SYNC is True:
            config.VRC_MIC_MUTE_SYNC = False
            model.changeMicTranscriptStatus()
        return {"status":200, "result":config.VRC_MIC_MUTE_SYNC}

    def setEnableCheckSpeakerThreshold(self, *args, **kwargs) -> dict:
        if config.ENABLE_CHECK_ENERGY_RECEIVE is False:
            self.startThreadingCheckSpeakerEnergy()
            config.ENABLE_CHECK_ENERGY_RECEIVE = True
        return {"status":200, "result":config.ENABLE_CHECK_ENERGY_RECEIVE}

    def setDisableCheckSpeakerThreshold(self, *args, **kwargs) -> dict:
        if config.ENABLE_CHECK_ENERGY_RECEIVE is True:
            self.stopThreadingCheckSpeakerEnergy()
            config.ENABLE_CHECK_ENERGY_RECEIVE = False
        return {"status":200, "result":config.ENABLE_CHECK_ENERGY_RECEIVE}

    def setEnableCheckMicThreshold(self, *args, **kwargs) -> dict:
        if config.ENABLE_CHECK_ENERGY_SEND is False:
            self.startThreadingCheckMicEnergy()
            config.ENABLE_CHECK_ENERGY_SEND = True
        return {"status":200, "result":config.ENABLE_CHECK_ENERGY_SEND}

    def setDisableCheckMicThreshold(self, *args, **kwargs) -> dict:
        if config.ENABLE_CHECK_ENERGY_SEND is True:
            self.stopThreadingCheckMicEnergy()
            config.ENABLE_CHECK_ENERGY_SEND = False
        return {"status":200, "result":config.ENABLE_CHECK_ENERGY_SEND}

    @staticmethod
    def openFilepathLogs(*args, **kwargs) -> dict:
        Popen(['explorer', config.PATH_LOGS.replace('/', '\\')], shell=True)
        return {"status":200, "result":True}

    @staticmethod
    def openFilepathConfigFile(*args, **kwargs) -> dict:
        Popen(['explorer', config.PATH_DATA.replace('/', '\\')], shell=True)
        return {"status":200, "result":True}

    def _transcriptionActivationError(
        self,
        source: PipelineSource,
        error: Exception,
    ) -> dict:
        if isinstance(error, DeviceUnavailableError):
            return self._activationErrorResponse(error.error_code)

        try:
            is_vram_error, _error_message = model.detectVRAMError(error)
        except Exception:
            errorLogging()
            is_vram_error = False
        if is_vram_error:
            if source is PipelineSource.MIC:
                error_code = ErrorCode.TRANSCRIPTION_VRAM_MIC
                disabled_code = ErrorCode.TRANSCRIPTION_SEND_DISABLED_VRAM
                error_endpoint = "error_transcription_mic_vram_overflow"
                state_endpoint = "enable_transcription_send"
            else:
                error_code = ErrorCode.TRANSCRIPTION_VRAM_SPEAKER
                disabled_code = ErrorCode.TRANSCRIPTION_RECEIVE_DISABLED_VRAM
                error_endpoint = "error_transcription_speaker_vram_overflow"
                state_endpoint = "enable_transcription_receive"
            response = self._activationErrorResponse(error_code)
            self._safeActivationEvent(error_endpoint, response)
            self._safeActivationEvent(
                state_endpoint,
                self._activationErrorResponse(disabled_code),
            )
            return response

        errorLogging()
        return self._activationErrorResponse(
            ErrorCode.TRANSCRIPTION_START_FAILED,
            status=500,
        )

    def setEnableTranscriptionSend(self, *args, **kwargs) -> dict:
        if config.ENABLE_TRANSCRIPTION_SEND is True:
            return {"status": 200, "result": True}
        config.ENABLE_TRANSCRIPTION_SEND = True
        try:
            if self.startTranscriptionSendMessage() is not True:
                raise RuntimeError("transcription activation was cancelled")
            return {"status": 200, "result": True}
        except Exception as error:
            config.ENABLE_TRANSCRIPTION_SEND = False
            try:
                self.stopTranscriptionSendMessage()
            except Exception:
                errorLogging()
            return self._transcriptionActivationError(
                PipelineSource.MIC,
                error,
            )

    def setDisableTranscriptionSend(self, *args, **kwargs) -> dict:
        if config.ENABLE_TRANSCRIPTION_SEND is True:
            config.ENABLE_TRANSCRIPTION_SEND = False
            self.stopThreadingTranscriptionSendMessage()
        return {"status":200, "result":config.ENABLE_TRANSCRIPTION_SEND}

    def setEnableTranscriptionReceive(self, *args, **kwargs) -> dict:
        if config.ENABLE_TRANSCRIPTION_RECEIVE is True:
            return {"status": 200, "result": True}
        config.ENABLE_TRANSCRIPTION_RECEIVE = True
        try:
            if self.startTranscriptionReceiveMessage() is not True:
                raise RuntimeError("transcription activation was cancelled")
            return {"status": 200, "result": True}
        except Exception as error:
            config.ENABLE_TRANSCRIPTION_RECEIVE = False
            try:
                self.stopTranscriptionReceiveMessage()
            except Exception:
                errorLogging()
            return self._transcriptionActivationError(
                PipelineSource.SPEAKER,
                error,
            )

    def setDisableTranscriptionReceive(self, *args, **kwargs) -> dict:
        if config.ENABLE_TRANSCRIPTION_RECEIVE is True:
            config.ENABLE_TRANSCRIPTION_RECEIVE = False
            self.stopThreadingTranscriptionReceiveMessage()
        return {"status":200, "result":config.ENABLE_TRANSCRIPTION_RECEIVE}

    def sendMessageBox(self, data, *args, **kwargs) -> dict:
        response = self.chatMessage(data)
        return response

    @staticmethod
    def typingMessageBox(*args, **kwargs) -> dict:
        if config.SEND_MESSAGE_TO_VRC is True:
            model.oscStartSendTyping()
        return {"status":200, "result":True}

    @staticmethod
    def stopTypingMessageBox(*args, **kwargs) -> dict:
        if config.SEND_MESSAGE_TO_VRC is True:
            model.oscStopSendTyping()
        return {"status":200, "result":True}

    @staticmethod
    def sendTextOverlay(data, *args, **kwargs) -> dict:
        if config.OVERLAY_SMALL_LOG is True:
            overlay_image = model.createOverlayImageSmallMessage(data)
            model.updateOverlaySmallLog(overlay_image)

        if config.OVERLAY_LARGE_LOG is True:
            overlay_image = model.createOverlayImageLargeMessage(data)
            model.updateOverlayLargeLog(overlay_image)
        return {"status":200, "result":data}

    @staticmethod
    def getTelemetry(*args, **kwargs) -> dict:
        return {"status":200, "result":config.ENABLE_TELEMETRY}

    @staticmethod
    def setEnableTelemetry(*args, **kwargs) -> dict:
        if config.ENABLE_TELEMETRY is False:
            config.ENABLE_TELEMETRY = True
            model.telemetryInit(enabled=True, app_version=config.VERSION)
        return {"status":200, "result":config.ENABLE_TELEMETRY}

    @staticmethod
    def setDisableTelemetry(*args, **kwargs) -> dict:
        if config.ENABLE_TELEMETRY is True:
            config.ENABLE_TELEMETRY = False
            model.telemetryShutdown()
        return {"status":200, "result":config.ENABLE_TELEMETRY}

    def _restartActiveTranscription(self) -> None:
        """Restart any running transcription engines so they pick up new language settings.

        This is called after swapping Your Language and Target Language to ensure
        the transcription models are re-initialized with the updated config, matching
        the dynamic behavior of Google/Whisper engines.
        """
        self._requestCoordinatedTranscriptionRestart()

    def _requestTranscriptionSourcesRestartLocked(
        self,
        sources: tuple[PipelineSource, ...],
    ) -> Optional[bool]:
        """Restart each requested active source once, stopping before loading."""
        if (
            self._transcription_shutdown_state != "running"
            or self._transcription_shutdown_requested.is_set()
        ):
            return None
        is_active = getattr(model, "isTranscriptionSourceActive", None)
        selected = []
        for source in dict.fromkeys(sources):
            active = (
                bool(is_active(source))
                if callable(is_active)
                else (
                    config.ENABLE_TRANSCRIPTION_SEND is True
                    if source is PipelineSource.MIC
                    else config.ENABLE_TRANSCRIPTION_RECEIVE is True
                )
            )
            if not active:
                continue
            if source is PipelineSource.MIC:
                selected.append(
                    (source, self.stopTranscriptionSendMessage, self.startTranscriptionSendMessage)
                )
            else:
                selected.append(
                    (source, self.stopTranscriptionReceiveMessage, self.startTranscriptionReceiveMessage)
                )

        for _source, stop, _start in selected:
            try:
                stop()
            except Exception:
                errorLogging()
                return False

        all_established = True
        for source, _stop, start in selected:
            try:
                established = start() is True
            except Exception:
                errorLogging()
                established = False
            if established and callable(is_active):
                try:
                    established = bool(is_active(source))
                except Exception:
                    errorLogging()
                    established = False
            all_established = all_established and established
        return all_established

    def _requestCoordinatedTranscriptionRestart(
        self,
        reason: str = "configuration_changed",
        *,
        expected_source: Optional[PipelineSource] = None,
        expected_generation: Optional[int] = None,
    ) -> Optional[bool]:
        """Stop all active generations before any replacement runtime loads."""
        del reason  # The reason is carried by recovery metrics at the caller.
        with self._transcription_restart_lock:
            if (
                self._transcription_shutdown_state != "running"
                or self._transcription_shutdown_requested.is_set()
            ):
                return None
            is_active = getattr(model, "isTranscriptionSourceActive", None)
            is_generation_current = getattr(
                model,
                "isSourcePipelineGenerationCurrent",
                None,
            )

            recovery_identity_supplied = (
                expected_source is not None or expected_generation is not None
            )
            if recovery_identity_supplied:
                if (
                    expected_source is None
                    or expected_generation is None
                    or not callable(is_generation_current)
                ):
                    return None
                try:
                    still_current = bool(
                        is_generation_current(
                            expected_source,
                            expected_generation,
                        )
                    )
                    still_active = (
                        bool(is_active(expected_source))
                        if callable(is_active)
                        else False
                    )
                except Exception:
                    errorLogging()
                    return None
                if not still_current or not still_active:
                    return None

            return self._requestTranscriptionSourcesRestartLocked(
                (PipelineSource.MIC, PipelineSource.SPEAKER)
            )

    def swapYourLanguageAndTargetLanguage(self, *args, **kwargs) -> dict:
        selected_tab = config.SELECTED_TAB_NO
        your_languages = deepcopy(config.SELECTED_YOUR_LANGUAGES)
        target_languages = deepcopy(config.SELECTED_TARGET_LANGUAGES)
        original_your = deepcopy(your_languages[selected_tab])
        original_target = deepcopy(target_languages[selected_tab])

        your_languages[selected_tab] = normalize_language_slots(
            original_target,
            your_languages[selected_tab],
            minimum_enabled=1,
            maximum_enabled=3,
        )
        target_languages[selected_tab] = normalize_language_slots(
            original_your,
            target_languages[selected_tab],
            minimum_enabled=1,
            maximum_enabled=3,
        )

        config.SELECTED_YOUR_LANGUAGES = your_languages
        config.SELECTED_TARGET_LANGUAGES = target_languages
        self.updateTranslationEngineAndEngineList()
        self._requestCoordinatedTranscriptionRestart()

        return {
            "status":200,
            "result":{
                "your":config.SELECTED_YOUR_LANGUAGES,
                "your_translation":config.SELECTED_YOUR_TRANSLATION_LANGUAGES,
                "target":config.SELECTED_TARGET_LANGUAGES,
                }
            }

    def updateSoftware(self, *args, **kwargs) -> dict:
        th_start_update_software = Thread(target=model.updateSoftware)
        th_start_update_software.daemon = True
        th_start_update_software.start()
        return {"status":200, "result":True}

    def downloadCtranslate2Weight(self, data:str, asynchronous:bool=True, *args, **kwargs) -> dict:
        weight_type = str(data)
        download_ctranslate2 = self.DownloadCTranslate2(
            self.run_mapping,
            weight_type,
            self.run
            )

        if asynchronous is True:
            self.startThreadingDownloadCtranslate2Weight(
                weight_type,
                download_ctranslate2.progressBar,
                download_ctranslate2.downloaded,
                )
        else:
            try:
                if model.downloadCTranslate2ModelWeight(weight_type, download_ctranslate2.progressBar, None):
                    model.downloadCTranslate2ModelTokenizer(weight_type)
            except Exception:
                errorLogging()
            finally:
                download_ctranslate2.downloaded()
        return {"status":200, "result":True}

    def downloadWhisperWeight(self, data:str, asynchronous:bool=True, *args, **kwargs) -> dict:
        weight_type = str(data)
        download_whisper = self.DownloadWhisper(
            self.run_mapping,
            weight_type,
            self.run
        )
        if asynchronous is True:
            self.startThreadingDownloadWhisperWeight(
                weight_type,
                download_whisper.progressBar,
                download_whisper.downloaded,
                )
        else:
            model.downloadWhisperModelWeight(weight_type, download_whisper.progressBar, download_whisper.downloaded)
        return {"status":200, "result":True}

    def downloadVoskWeight(self, data:str, asynchronous:bool=True, *args, **kwargs) -> dict:
        weight_type = str(data)
        dl = self.DownloadVosk(self.run_mapping, weight_type, self.run)
        if asynchronous is True:
            th = Thread(target=model.downloadVoskModelWeight, args=(weight_type, dl.progressBar, dl.downloaded))
            th.daemon = True
            th.start()
        else:
            model.downloadVoskModelWeight(weight_type, dl.progressBar, dl.downloaded)
        return {"status":200, "result":True}

    def downloadParakeetWeight(self, data:str, asynchronous:bool=True, *args, **kwargs) -> dict:
        weight_type = str(data)
        dl = self.DownloadParakeet(self.run_mapping, weight_type, self.run)
        if asynchronous is True:
            th = Thread(target=model.downloadParakeetModelWeight, args=(weight_type, dl.progressBar, dl.downloaded))
            th.daemon = True
            th.start()
        else:
            model.downloadParakeetModelWeight(weight_type, dl.progressBar, dl.downloaded)
        return {"status":200, "result":True}

    def downloadSenseVoiceWeight(self, data:str, asynchronous:bool=True, *args, **kwargs) -> dict:
        weight_type = str(data)
        dl = self.DownloadSenseVoice(self.run_mapping, weight_type, self.run)
        if asynchronous is True:
            th = Thread(target=model.downloadSenseVoiceModelWeight, args=(weight_type, dl.progressBar, dl.downloaded))
            th.daemon = True
            th.start()
        else:
            model.downloadSenseVoiceModelWeight(weight_type, dl.progressBar, dl.downloaded)
        return {"status":200, "result":True}

    @staticmethod
    def messageFormatter(format_type:str, translation:list, message:str) -> str:
        if format_type == "RECEIVED":
            format_parts = config.RECEIVED_MESSAGE_FORMAT_PARTS
        elif format_type == "SEND":
            format_parts = config.SEND_MESSAGE_FORMAT_PARTS
        else:
            raise ValueError("format_type is not found", format_type)

        message_part = format_parts["message"]["prefix"] + message + format_parts["message"]["suffix"]
        translation_part = format_parts["translation"]["prefix"] + format_parts["translation"]["separator"].join(translation) + format_parts["translation"]["suffix"]

        if len(translation) > 0 and message != "":
            # 翻訳とメッセージの順序を決定
            if format_parts["translation_first"]:
                osc_message = translation_part + format_parts["separator"] + message_part
            else:
                osc_message = message_part + format_parts["separator"] + translation_part
        elif len(translation) > 0 and message == "":
            osc_message = translation_part
        else:
            osc_message = message_part
        return osc_message

    def startTranscriptionSendMessage(self) -> bool:
        with self._transcription_restart_lock:
            if (
                self._transcription_shutdown_state != "running"
                or self._transcription_shutdown_requested.is_set()
            ):
                return False
            return self._startTranscriptionSendMessageUnlocked()

    def _waitForDeviceAccessOrShutdown(self) -> bool:
        while self.device_access_status is False:
            # Shutdown publishes this Event before waiting for the restart
            # lock, so a start already holding that lock can unwind promptly.
            if self._transcription_shutdown_requested.wait(0.1):
                return False
        return not self._transcription_shutdown_requested.is_set()

    def _startTranscriptionSendMessageUnlocked(self) -> bool:
        if not self._waitForDeviceAccessOrShutdown():
            return False
        self.device_access_status = False
        try:
            validate_device = getattr(
                model,
                "validateMicTranscriptDevice",
                None,
            )
            if callable(validate_device):
                validate_device()
            model.ensureSourcePipeline(
                PipelineSource.MIC,
                self._sourcePipelineCallbacks(PipelineSource.MIC),
                self._sourcePipelineGeneration(PipelineSource.MIC),
            )
            session_established = model.startMicTranscript(self.micMessage)
            if session_established is not True:
                model.stopSourcePipeline(PipelineSource.MIC)
                return False
            if (
                self._transcription_shutdown_state != "running"
                or self._transcription_shutdown_requested.is_set()
            ):
                model.stopMicTranscript()
                return False
            return True
        except Exception:
            try:
                model.stopSourcePipeline(PipelineSource.MIC)
            except Exception:
                errorLogging()
            raise
        finally:
            self.device_access_status = True

    def stopTranscriptionSendMessage(self) -> None:
        with self._transcription_restart_lock:
            model.stopMicTranscript()

    def startThreadingTranscriptionSendMessage(self) -> None:
        th_startTranscriptionSendMessage = Thread(target=self.startTranscriptionSendMessage)
        th_startTranscriptionSendMessage.daemon = True
        th_startTranscriptionSendMessage.start()

    def stopThreadingTranscriptionSendMessage(self) -> None:
        th_stopTranscriptionSendMessage = Thread(target=self.stopTranscriptionSendMessage)
        th_stopTranscriptionSendMessage.daemon = True
        th_stopTranscriptionSendMessage.start()
        th_stopTranscriptionSendMessage.join()

    def startTranscriptionReceiveMessage(self) -> bool:
        with self._transcription_restart_lock:
            if (
                self._transcription_shutdown_state != "running"
                or self._transcription_shutdown_requested.is_set()
            ):
                return False
            return self._startTranscriptionReceiveMessageUnlocked()

    def _startTranscriptionReceiveMessageUnlocked(self) -> bool:
        if not self._waitForDeviceAccessOrShutdown():
            return False
        self.device_access_status = False
        try:
            validate_device = getattr(
                model,
                "validateSpeakerTranscriptDevice",
                None,
            )
            if callable(validate_device):
                validate_device()
            model.ensureSourcePipeline(
                PipelineSource.SPEAKER,
                self._sourcePipelineCallbacks(PipelineSource.SPEAKER),
                self._sourcePipelineGeneration(PipelineSource.SPEAKER),
            )
            session_established = model.startSpeakerTranscript(self.speakerMessage)
            if session_established is not True:
                model.stopSourcePipeline(PipelineSource.SPEAKER)
                return False
            if (
                self._transcription_shutdown_state != "running"
                or self._transcription_shutdown_requested.is_set()
            ):
                model.stopSpeakerTranscript()
                return False
            return True
        except Exception:
            try:
                model.stopSourcePipeline(PipelineSource.SPEAKER)
            except Exception:
                errorLogging()
            raise
        finally:
            self.device_access_status = True

    def stopTranscriptionReceiveMessage(self) -> None:
        with self._transcription_restart_lock:
            model.stopSpeakerTranscript()

    def startThreadingTranscriptionReceiveMessage(self) -> None:
        th_startTranscriptionReceiveMessage = Thread(target=self.startTranscriptionReceiveMessage)
        th_startTranscriptionReceiveMessage.daemon = True
        th_startTranscriptionReceiveMessage.start()

    def stopThreadingTranscriptionReceiveMessage(self) -> None:
        th_stopTranscriptionReceiveMessage = Thread(target=self.stopTranscriptionReceiveMessage)
        th_stopTranscriptionReceiveMessage.daemon = True
        th_stopTranscriptionReceiveMessage.start()
        th_stopTranscriptionReceiveMessage.join()

    @staticmethod
    def replaceExclamationsWithRandom(text):
        # ![...] にマッチする正規表現
        pattern = r'!\[(.*?)\]'

        # 乱数と置換部分を保存する辞書
        replacement_dict = {}

        num = 4096
        # マッチした部分を4096から始まる整数に置換する。置換毎に4097, 4098, ... と増える
        def replace(match):
            original = match.group(1)
            nonlocal num
            rand_value = hex(num)
            replacement_dict[rand_value] = original
            num += 1
            return f" ${rand_value} "

        # 文章内の ![] の部分を置換
        replaced_text = re.sub(pattern, replace, text)

        return replaced_text, replacement_dict

    @staticmethod
    def restoreText(escaped_text, escape_dict):
        # 大文字小文字を無視して置換するために、正規表現を使う
        for escape_seq, char in escape_dict.items():
            # escaped_text の部分を pattern で置換
            pattern = re.escape(f"${escape_seq}") + r"|\$\s+" + re.escape(escape_seq)
            escaped_text = re.sub(pattern, char, escaped_text, flags=re.IGNORECASE)
        return escaped_text

    @staticmethod
    def removeExclamations(text):
        # ![...] を [...] に置換する正規表現
        pattern = r'!\[(.*?)\]'
        # ![...] の部分を [] 内のテキストに置換
        cleaned_text = re.sub(pattern, r'\1', text)
        return cleaned_text

    def updateDownloadedCTranslate2ModelWeight(self, scan_all: bool = False) -> None:
        # キャッシュされた結果を使用（起動時の重複チェックを回避）
        if hasattr(self, '_ctranslate2_available_cache'):
            # 起動時のキャッシュを使用: 選択中の重みタイプのみ設定
            config.SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT[config.CTRANSLATE2_WEIGHT_TYPE] = self._ctranslate2_available_cache

        if scan_all is False:
            return

        # すべての重みタイプをチェック（キャッシュされていないものだけ）
        for weight_type in config.SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT.keys():
            # 選択中のウェイトはキャッシュで設定済みなのでスキップ
            if hasattr(self, '_ctranslate2_available_cache') and weight_type == config.CTRANSLATE2_WEIGHT_TYPE:
                continue
            config.SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT[weight_type] = model.checkTranslatorCTranslate2ModelWeight(weight_type)

    def updateTranslationEngineAndEngineList(self):
        engines = config.SELECTED_TRANSLATION_ENGINES
        selected_engines = list(
            boundedTranslationProviderSnapshot(engines[config.SELECTED_TAB_NO])
        )
        selectable_engines = self.getTranslationEngines()["result"]
        selected_engines = [engine for engine in selected_engines if engine in selectable_engines]
        engines[config.SELECTED_TAB_NO] = self._collapseTranslationProviderSelection(
            selected_engines
        )
        config.SELECTED_TRANSLATION_ENGINES = engines
        model.resetTranslationProviderRotation()

        self.run(200, self.run_mapping["selected_translation_engines"], config.SELECTED_TRANSLATION_ENGINES)
        self.run(200, self.run_mapping["translation_engines"], selectable_engines)

    def updateDownloadedWhisperModelWeight(self, scan_all: bool = False) -> None:
        # キャッシュされた結果を使用（起動時の重複チェックを回避）
        checked_weight_types = set()
        if hasattr(self, '_whisper_available_cache'):
            # 起動時のキャッシュを使用: 起動に必要な最小ウェイトのみ設定
            cached_weight_type = getattr(self, '_whisper_available_cache_key', config.WHISPER_WEIGHT_TYPE)
            config.SELECTABLE_WHISPER_WEIGHT_TYPE_DICT[cached_weight_type] = self._whisper_available_cache
            checked_weight_types.add(cached_weight_type)

        for selected_weight_type in self._selectedTranscriptionModelWeights("Whisper"):
            if selected_weight_type not in checked_weight_types:
                config.SELECTABLE_WHISPER_WEIGHT_TYPE_DICT[selected_weight_type] = model.checkTranscriptionWhisperModelWeight(selected_weight_type)
                checked_weight_types.add(selected_weight_type)

        if scan_all is False:
            return

        # すべての重みタイプをチェック（キャッシュされていないものだけ）
        for weight_type in config.SELECTABLE_WHISPER_WEIGHT_TYPE_DICT.keys():
            # 起動時に確認済みのウェイトはキャッシュで設定済みなのでスキップ
            if weight_type in checked_weight_types:
                continue
            config.SELECTABLE_WHISPER_WEIGHT_TYPE_DICT[weight_type] = model.checkTranscriptionWhisperModelWeight(weight_type)

    def updateDownloadedVoskModelWeight(self, scan_all: bool = False) -> None:
        selected_weight_types = self._selectedTranscriptionModelWeights("Vosk")
        for selected_weight_type in selected_weight_types:
            config.SELECTABLE_VOSK_WEIGHT_TYPE_DICT[selected_weight_type] = model.checkTranscriptionVoskModelWeight(selected_weight_type)
        if scan_all is False:
            return
        for weight_type in config.SELECTABLE_VOSK_WEIGHT_TYPE_DICT.keys():
            if weight_type in selected_weight_types:
                continue
            config.SELECTABLE_VOSK_WEIGHT_TYPE_DICT[weight_type] = model.checkTranscriptionVoskModelWeight(weight_type)

    def updateDownloadedParakeetModelWeight(self, scan_all: bool = False) -> None:
        selected_weight_types = self._selectedTranscriptionModelWeights("Parakeet")
        for selected_weight_type in selected_weight_types:
            config.SELECTABLE_PARAKEET_WEIGHT_TYPE_DICT[selected_weight_type] = model.checkTranscriptionParakeetModelWeight(selected_weight_type)
        if scan_all is False:
            return
        for weight_type in config.SELECTABLE_PARAKEET_WEIGHT_TYPE_DICT.keys():
            if weight_type in selected_weight_types:
                continue
            config.SELECTABLE_PARAKEET_WEIGHT_TYPE_DICT[weight_type] = model.checkTranscriptionParakeetModelWeight(weight_type)

    def updateDownloadedSenseVoiceModelWeight(self, scan_all: bool = False) -> None:
        selected_weight_types = self._selectedTranscriptionModelWeights("SenseVoice")
        for selected_weight_type in selected_weight_types:
            config.SELECTABLE_SENSEVOICE_WEIGHT_TYPE_DICT[selected_weight_type] = model.checkTranscriptionSenseVoiceModelWeight(selected_weight_type)
        if scan_all is False:
            return
        for weight_type in config.SELECTABLE_SENSEVOICE_WEIGHT_TYPE_DICT.keys():
            if weight_type in selected_weight_types:
                continue
            config.SELECTABLE_SENSEVOICE_WEIGHT_TYPE_DICT[weight_type] = model.checkTranscriptionSenseVoiceModelWeight(weight_type)

    def _selectedTranscriptionModelWeights(self, provider: str) -> tuple[str, ...]:
        selected = []
        for source in (PipelineSource.MIC, PipelineSource.SPEAKER):
            weight_type = self._getSourceTranscriptionProfile(source)["models"].get(provider, "")
            if weight_type and weight_type not in selected:
                selected.append(weight_type)
        return tuple(selected)

    def updateTranscriptionEngine(self):
        weight_type = config.WHISPER_WEIGHT_TYPE
        weight_type_dict = config.SELECTABLE_WHISPER_WEIGHT_TYPE_DICT
        weight_available = bool(weight_type_dict.get(weight_type))
        selected_engines = [key for key, value in config.SELECTABLE_TRANSCRIPTION_ENGINE_STATUS.items() if value is True]

        for source in (PipelineSource.MIC, PipelineSource.SPEAKER):
            current_engine = self._getSourceTranscriptionEngine(source)
            if current_engine in selected_engines:
                continue
            if weight_available and "Whisper" in selected_engines:
                fallback_engine = "Whisper"
            elif "Google" in selected_engines:
                fallback_engine = "Google"
            elif selected_engines:
                fallback_engine = selected_engines[0]
            else:
                fallback_engine = "Whisper"
            profile = self._getSourceTranscriptionProfile(source)
            profile["engine"] = fallback_engine
            setattr(config, self._sourceTranscriptionProfileName(source), profile)
            self._syncSourceTranscriptionCompatibilityFields(source)
        self._syncLegacyTranscriptionSettingsFromSend()

        self._normalizeAllSourceTranscriptionRuntimeSelections()
        self._normalizeSelectedYourLanguageForTranscription()

    def startCheckMicEnergy(self) -> None:
        if not self._waitForDeviceAccessOrShutdown():
            return
        with self._transcription_restart_lock:
            if (
                self._transcription_shutdown_state != "running"
                or self._transcription_shutdown_requested.is_set()
            ):
                return
            self.device_access_status = False
            try:
                # Starting the recorder/thread is the energy-check lifecycle
                # publication point. Keep it ordered with terminal shutdown.
                model.startCheckMicEnergy(self.progressBarMicEnergy)
            finally:
                self.device_access_status = True

    def startThreadingCheckMicEnergy(self) -> None:
        th_startCheckMicEnergy = Thread(target=self.startCheckMicEnergy)
        th_startCheckMicEnergy.daemon = True
        th_startCheckMicEnergy.start()

    def stopCheckMicEnergy(self) -> None:
        model.stopCheckMicEnergy()

    def stopThreadingCheckMicEnergy(self) -> None:
        th_stopCheckMicEnergy = Thread(target=self.stopCheckMicEnergy)
        th_stopCheckMicEnergy.daemon = True
        th_stopCheckMicEnergy.start()
        th_stopCheckMicEnergy.join()

    def startCheckSpeakerEnergy(self) -> None:
        if not self._waitForDeviceAccessOrShutdown():
            return
        with self._transcription_restart_lock:
            if (
                self._transcription_shutdown_state != "running"
                or self._transcription_shutdown_requested.is_set()
            ):
                return
            self.device_access_status = False
            try:
                # Starting the recorder/thread is the energy-check lifecycle
                # publication point. Keep it ordered with terminal shutdown.
                model.startCheckSpeakerEnergy(self.progressBarSpeakerEnergy)
            finally:
                self.device_access_status = True

    def startThreadingCheckSpeakerEnergy(self) -> None:
        th_startCheckSpeakerEnergy = Thread(target=self.startCheckSpeakerEnergy)
        th_startCheckSpeakerEnergy.daemon = True
        th_startCheckSpeakerEnergy.start()

    def stopCheckSpeakerEnergy(self) -> None:
        model.stopCheckSpeakerEnergy()

    def stopThreadingCheckSpeakerEnergy(self) -> None:
        th_stopCheckSpeakerEnergy = Thread(target=self.stopCheckSpeakerEnergy)
        th_stopCheckSpeakerEnergy.daemon = True
        th_stopCheckSpeakerEnergy.start()
        th_stopCheckSpeakerEnergy.join()

    @staticmethod
    def startThreadingDownloadCtranslate2Weight(weight_type:str, callback:Callable[[float], None], end_callback:Optional[Callable[..., None]] = None) -> None:
        def run_download():
            try:
                if model.downloadCTranslate2ModelWeight(weight_type, callback, None):
                    model.downloadCTranslate2ModelTokenizer(weight_type)
            except Exception:
                errorLogging()
            finally:
                if end_callback is not None:
                    end_callback()

        th_download = Thread(target=run_download)
        th_download.daemon = True
        th_download.start()

    @staticmethod
    def startThreadingDownloadWhisperWeight(weight_type:str, callback:Callable[[float], None], end_callback:Optional[Callable[..., None]] = None) -> None:
        th_download = Thread(target=model.downloadWhisperModelWeight, args=(weight_type, callback, end_callback))
        th_download.daemon = True
        th_download.start()

    @staticmethod
    def startWatchdog(*args, **kwargs) -> dict:
        model.startWatchdog()
        return {"status":200, "result":True}

    @staticmethod
    def feedWatchdog(*args, **kwargs) -> dict:
        model.feedWatchdog()
        return {"status":200, "result":True}

    @staticmethod
    def setWatchdogCallback(callback) -> dict:
        model.setWatchdogCallback(callback)
        return {"status":200, "result":True}

    @staticmethod
    def stopWatchdog(*args, **kwargs) -> dict:
        model.stopWatchdog()
        return {"status":200, "result":True}

    @staticmethod
    def getWebSocketHost(*args, **kwargs) -> dict:
        return {"status":200, "result":config.WEBSOCKET_HOST}

    @staticmethod
    def setWebSocketHost(data, *args, **kwargs) -> dict:
        if isValidIpAddress(data) is False:
            response = VRCTError.create_error_response(
                ErrorCode.VALIDATION_INVALID_IP,
                data=config.WEBSOCKET_HOST
            )
        else:
            if model.checkWebSocketServerAlive() is False:
                config.WEBSOCKET_HOST = data
                response = {"status":200, "result":config.WEBSOCKET_HOST}
            else:
                if data == config.WEBSOCKET_HOST:
                    response = {"status":200, "result":config.WEBSOCKET_HOST}
                elif isAvailableWebSocketServer(data, config.WEBSOCKET_PORT):
                    model.stopWebSocketServer()
                    model.startWebSocketServer(data, config.WEBSOCKET_PORT)
                    config.WEBSOCKET_HOST = data
                    response = {"status":200, "result":config.WEBSOCKET_HOST}
                else:
                    response = VRCTError.create_error_response(
                        ErrorCode.WEBSOCKET_HOST_UNAVAILABLE,
                        data=config.WEBSOCKET_HOST
                    )

        return response

    @staticmethod
    def getWebSocketPort(*args, **kwargs) -> dict:
        return {"status":200, "result":config.WEBSOCKET_PORT}

    @staticmethod
    def setWebSocketPort(data, *args, **kwargs) -> dict:
        if model.checkWebSocketServerAlive() is False:
            config.WEBSOCKET_PORT = int(data)
            response = {"status":200, "result":config.WEBSOCKET_PORT}
        else:
            if int(data) == config.WEBSOCKET_PORT:
                return {"status":200, "result":config.WEBSOCKET_PORT}
            elif isAvailableWebSocketServer(config.WEBSOCKET_HOST, int(data)) is True:
                model.stopWebSocketServer()
                model.startWebSocketServer(config.WEBSOCKET_HOST, int(data))
                config.WEBSOCKET_PORT = int(data)
                response = {"status":200, "result":config.WEBSOCKET_PORT}
            else:
                response = VRCTError.create_error_response(
                    ErrorCode.WEBSOCKET_PORT_UNAVAILABLE,
                    data=config.WEBSOCKET_PORT
                )
        return response

    @staticmethod
    def getWebSocketServer(*args, **kwargs) -> dict:
        return {"status":200, "result":config.WEBSOCKET_SERVER}

    @staticmethod
    def setEnableWebSocketServer(*args, **kwargs) -> dict:
        if config.WEBSOCKET_SERVER is False:
            if isAvailableWebSocketServer(config.WEBSOCKET_HOST, config.WEBSOCKET_PORT) is True:
                model.startWebSocketServer(config.WEBSOCKET_HOST, config.WEBSOCKET_PORT)
                config.WEBSOCKET_SERVER = True
                response = {"status":200, "result":config.WEBSOCKET_SERVER}
            else:
                response = VRCTError.create_error_response(
                    ErrorCode.WEBSOCKET_SERVER_UNAVAILABLE,
                    data=config.WEBSOCKET_SERVER
                )
        else:
            response = {"status":200, "result":config.WEBSOCKET_SERVER}
        return response

    @staticmethod
    def setDisableWebSocketServer(*args, **kwargs) -> dict:
        if config.WEBSOCKET_SERVER is True:
            config.WEBSOCKET_SERVER = False
            model.stopWebSocketServer()
        return {"status":200, "result":config.WEBSOCKET_SERVER}

    # Clipboard control
    @staticmethod
    def getClipboard(*args, **kwargs) -> dict:
        return {"status":200, "result":config.ENABLE_CLIPBOARD}

    @staticmethod
    def setEnableClipboard(*args, **kwargs) -> dict:
        if config.ENABLE_CLIPBOARD is False:
            config.ENABLE_CLIPBOARD = True
        return {"status":200, "result":config.ENABLE_CLIPBOARD}

    @staticmethod
    def setDisableClipboard(*args, **kwargs) -> dict:
        if config.ENABLE_CLIPBOARD is True:
            config.ENABLE_CLIPBOARD = False
        return {"status":200, "result":config.ENABLE_CLIPBOARD}

    def initializationProgress(self, progress):
        self.run(200, self.run_mapping["initialization_progress"], progress)

    def initializationStatus(
        self,
        message: str,
        detail: str = "",
        visible: bool = True,
        phase: str = "starting",
        message_key: str = "",
        detail_key: str = "",
    ):
        self.run(
            200,
            self.run_mapping["initialization_status"],
            {
                "message": message,
                "detail": detail,
                "visible": visible,
                "phase": phase,
                "message_key": message_key,
                "detail_key": detail_key,
            },
        )

    def _applyFastStartupTranslationStatus(self, connected_network: bool, ctranslate2_available: bool) -> None:
        online_engines = {"Google", "Bing", "Papago", "DeepL"}
        for engine in config.SELECTABLE_TRANSLATION_ENGINE_STATUS.keys():
            if engine == "CTranslate2":
                config.SELECTABLE_TRANSLATION_ENGINE_STATUS[engine] = ctranslate2_available
            elif engine in online_engines:
                config.SELECTABLE_TRANSLATION_ENGINE_STATUS[engine] = connected_network
            else:
                config.SELECTABLE_TRANSLATION_ENGINE_STATUS[engine] = False

    def _applyFastStartupTranscriptionStatus(self, connected_network: bool, whisper_available: bool) -> None:
        for engine in config.SELECTABLE_TRANSCRIPTION_ENGINE_STATUS.keys():
            match engine:
                case "Whisper":
                    config.SELECTABLE_TRANSCRIPTION_ENGINE_STATUS[engine] = whisper_available
                case "Vosk":
                    config.SELECTABLE_TRANSCRIPTION_ENGINE_STATUS[engine] = any(
                        model.checkTranscriptionVoskModelWeight(wt)
                        for wt in config.SELECTABLE_VOSK_WEIGHT_TYPE_DICT.keys()
                    )
                case "Parakeet":
                    config.SELECTABLE_TRANSCRIPTION_ENGINE_STATUS[engine] = any(
                        model.checkTranscriptionParakeetModelWeight(wt)
                        for wt in config.SELECTABLE_PARAKEET_WEIGHT_TYPE_DICT.keys()
                    )
                case "SenseVoice":
                    config.SELECTABLE_TRANSCRIPTION_ENGINE_STATUS[engine] = any(
                        model.checkTranscriptionSenseVoiceModelWeight(wt)
                        for wt in config.SELECTABLE_SENSEVOICE_WEIGHT_TYPE_DICT.keys()
                    )
                case _:
                    config.SELECTABLE_TRANSCRIPTION_ENGINE_STATUS[engine] = connected_network

    def _finishInitializationInBackground(self, connected_network: bool) -> None:
        try:
            self.initializationStatus(
                "Loading devices and local services",
                "Refreshing audio devices and optional local providers.",
                visible=True,
                phase="services",
            )
            self.sendDeferredConfigSettings()

            self.initializationStatus(
                "Checking translation services",
                "Verifying online engines and optional local providers.",
                visible=True,
                phase="services",
            )

            ctranslate2_available = getattr(self, "_ctranslate2_available_cache", False)
            engines_to_check = list(config.SELECTABLE_TRANSLATION_ENGINE_LIST)
            engine_results = {}

            def check_translation_engine(engine: str) -> tuple:
                status = False
                auth_key_invalid = False
                model_list = None
                selected_model = None

                try:
                    match engine:
                        case "CTranslate2":
                            status = ctranslate2_available
                        case "DeepL_API":
                            if config.AUTH_KEYS[engine] is None:
                                status = False
                            else:
                                if model.authenticationTranslatorDeepLAuthKey(auth_key=config.AUTH_KEYS[engine]) is True:
                                    status = True
                                else:
                                    auth_key_invalid = True
                        case "Plamo_API":
                            if config.AUTH_KEYS[engine] is None:
                                status = False
                            else:
                                if model.authenticationTranslatorPlamoAuthKey(auth_key=config.AUTH_KEYS[engine]) is True:
                                    model_list = model.getTranslatorPlamoModelList()
                                    selected_model = config.SELECTED_PLAMO_MODEL if config.SELECTED_PLAMO_MODEL in model_list else model_list[0]
                                    status = True
                                else:
                                    auth_key_invalid = True
                        case "Gemini_API":
                            if config.AUTH_KEYS[engine] is None:
                                status = False
                            else:
                                if model.authenticationTranslatorGeminiAuthKey(auth_key=config.AUTH_KEYS[engine]) is True:
                                    model_list = model.getTranslatorGeminiModelList()
                                    selected_model = config.SELECTED_GEMINI_MODEL if config.SELECTED_GEMINI_MODEL in model_list else model_list[0]
                                    status = True
                                else:
                                    auth_key_invalid = True
                        case "OpenAI_API":
                            if config.AUTH_KEYS[engine] is None:
                                status = False
                            else:
                                if model.authenticationTranslatorOpenAIAuthKey(auth_key=config.AUTH_KEYS[engine]) is True:
                                    model_list = model.getTranslatorOpenAIModelList()
                                    selected_model = config.SELECTED_OPENAI_MODEL if config.SELECTED_OPENAI_MODEL in model_list else model_list[0]
                                    status = True
                                else:
                                    auth_key_invalid = True
                        case "DeepSeek_API":
                            if config.AUTH_KEYS[engine] is None:
                                status = False
                            elif model.authenticationTranslatorDeepSeekAuthKey(auth_key=config.AUTH_KEYS[engine]) is True:
                                model_list = model.getTranslatorDeepSeekModelList()
                                selected_model = config.SELECTED_DEEPSEEK_MODEL if config.SELECTED_DEEPSEEK_MODEL in model_list else model_list[0]
                                status = True
                        case "Groq_API":
                            if config.AUTH_KEYS[engine] is None:
                                status = False
                            else:
                                if model.authenticationTranslatorGroqAuthKey(auth_key=config.AUTH_KEYS[engine]) is True:
                                    model_list = model.getTranslatorGroqModelList()
                                    selected_model = config.SELECTED_GROQ_MODEL if config.SELECTED_GROQ_MODEL in model_list else model_list[0]
                                    status = True
                                else:
                                    auth_key_invalid = True
                        case "OpenRouter_API":
                            if config.AUTH_KEYS[engine] is None:
                                status = False
                            else:
                                if model.authenticationTranslatorOpenRouterAuthKey(auth_key=config.AUTH_KEYS[engine]) is True:
                                    model_list = model.getTranslatorOpenRouterModelList()
                                    selected_model = config.SELECTED_OPENROUTER_MODEL if config.SELECTED_OPENROUTER_MODEL in model_list else model_list[0]
                                    status = True
                                else:
                                    auth_key_invalid = True
                        case "LMStudio":
                            if config.LMSTUDIO_URL is not None:
                                if model.authenticationTranslatorLMStudio(base_url=config.LMSTUDIO_URL) is True:
                                    model_list = model.getTranslatorLMStudioModelList()
                                    if len(model_list) > 0:
                                        selected_model = config.SELECTED_LMSTUDIO_MODEL if config.SELECTED_LMSTUDIO_MODEL in model_list else model_list[0]
                                        status = True
                        case "Ollama":
                            if model.authenticationTranslatorOllama() is True:
                                model_list = model.getTranslatorOllamaModelList()
                                if len(model_list) > 0:
                                    selected_model = config.SELECTED_OLLAMA_MODEL if config.SELECTED_OLLAMA_MODEL in model_list else model_list[0]
                                    status = True
                        case _:
                            status = connected_network is True
                except Exception as e:
                    printLog(f"Error checking engine {engine}: {str(e)}")
                    errorLogging()
                    status = False

                return engine, status, auth_key_invalid, model_list, selected_model

            with ThreadPoolExecutor(max_workers=4) as executor:
                future_to_engine = {executor.submit(check_translation_engine, engine): engine for engine in engines_to_check}
                for future in as_completed(future_to_engine):
                    engine, status, auth_key_invalid, model_list, selected_model = future.result()
                    engine_results[engine] = (status, auth_key_invalid, model_list, selected_model)

            for engine in engines_to_check:
                if engine not in engine_results:
                    continue

                status, auth_key_invalid, model_list, selected_model = engine_results[engine]
                if engine == "DeepSeek_API":
                    self._setDeepSeekStartupAvailability(status)
                else:
                    config.SELECTABLE_TRANSLATION_ENGINE_STATUS[engine] = status

                if auth_key_invalid:
                    auth_keys = config.AUTH_KEYS
                    auth_keys[engine] = None
                    config.AUTH_KEYS = auth_keys
                    printLog(f"{engine} auth key is invalid")

                if engine == "LMStudio" and not status:
                    config.SELECTABLE_LMSTUDIO_MODEL_LIST = []
                    config.SELECTED_LMSTUDIO_MODEL = None
                if engine == "Ollama" and not status:
                    config.SELECTABLE_OLLAMA_MODEL_LIST = []
                    config.SELECTED_OLLAMA_MODEL = None

                if model_list is not None and status:
                    match engine:
                        case "Plamo_API":
                            config.SELECTABLE_PLAMO_MODEL_LIST = model_list
                            config.SELECTED_PLAMO_MODEL = selected_model
                            model.setTranslatorPlamoModel(selected_model)
                            model.updateTranslatorPlamoClient()
                        case "Gemini_API":
                            config.SELECTABLE_GEMINI_MODEL_LIST = model_list
                            config.SELECTED_GEMINI_MODEL = selected_model
                            model.setTranslatorGeminiModel(selected_model)
                            model.updateTranslatorGeminiClient()
                        case "OpenAI_API":
                            config.SELECTABLE_OPENAI_MODEL_LIST = model_list
                            config.SELECTED_OPENAI_MODEL = selected_model
                            model.setTranslatorOpenAIModel(selected_model)
                            model.updateTranslatorOpenAIClient()
                        case "DeepSeek_API":
                            config.SELECTABLE_DEEPSEEK_MODEL_LIST = model_list
                            config.SELECTED_DEEPSEEK_MODEL = selected_model
                            model.setTranslatorDeepSeekModel(selected_model)
                            model.updateTranslatorDeepSeekClient()
                        case "Groq_API":
                            config.SELECTABLE_GROQ_MODEL_LIST = model_list
                            config.SELECTED_GROQ_MODEL = selected_model
                            model.setTranslatorGroqModel(selected_model)
                            model.updateTranslatorGroqClient()
                        case "OpenRouter_API":
                            config.SELECTABLE_OPENROUTER_MODEL_LIST = model_list
                            config.SELECTED_OPENROUTER_MODEL = selected_model
                            model.setTranslatorOpenRouterModel(selected_model)
                            model.updateTranslatorOpenRouterClient()
                        case "LMStudio":
                            config.SELECTABLE_LMSTUDIO_MODEL_LIST = model_list
                            config.SELECTED_LMSTUDIO_MODEL = selected_model
                            model.setTranslatorLMStudioModel(selected_model)
                            model.updateTranslatorLMStudioClient()
                        case "Ollama":
                            config.SELECTABLE_OLLAMA_MODEL_LIST = model_list
                            config.SELECTED_OLLAMA_MODEL = selected_model
                            model.setTranslatorOllamaModel(selected_model)
                            model.updateTranslatorOllamaClient()

            self.updateTranslationEngineAndEngineList()

            self.initializationStatus(
                "Starting background services",
                "Bringing up transliteration, OSC, and overlay.",
                visible=True,
                phase="services",
            )
            self.initializationProgress(4)

            if config.CONVERT_MESSAGE_TO_ROMAJI is True or config.CONVERT_MESSAGE_TO_HIRAGANA is True:
                model.startTransliteration()

            model.addKeywords()

            if config.LOGGER_FEATURE is True:
                model.startLogger()

            def init_osc_receive_background():
                try:
                    model.startReceiveOSC()
                    osc_query_enabled = model.getIsOscQueryEnabled()
                    if osc_query_enabled is True:
                        self.enableOscQuery()
                        if config.VRC_MIC_MUTE_SYNC is True:
                            self.setEnableVrcMicMuteSync()
                    else:
                        mute_sync_info_flag = False
                        if config.VRC_MIC_MUTE_SYNC is True:
                            self.setDisableVrcMicMuteSync()
                            mute_sync_info_flag = True
                        self.disableOscQuery(mute_sync_info=mute_sync_info_flag)
                    printLog("[Background] OSC Receive initialization completed")
                except Exception:
                    errorLogging()
                    printLog("[Background] OSC Receive initialization failed")

            bg_thread = Thread(target=init_osc_receive_background)
            bg_thread.daemon = True
            bg_thread.start()

            device_manager.setCallbackHostList(self.updateMicHostList)
            device_manager.setCallbackMicDeviceList(self.updateMicDeviceList)
            device_manager.setCallbackSpeakerDeviceList(self.updateSpeakerDeviceList)

            if config.AUTO_MIC_SELECT is True:
                self.applyAutoMicSelect()
            if config.AUTO_SPEAKER_SELECT is True:
                self.applyAutoSpeakerSelect()

            if (config.OVERLAY_SMALL_LOG is True or config.OVERLAY_LARGE_LOG is True):
                model.startOverlay()

            if config.WEBSOCKET_SERVER is True:
                if isAvailableWebSocketServer(config.WEBSOCKET_HOST, config.WEBSOCKET_PORT) is True:
                    model.startWebSocketServer(config.WEBSOCKET_HOST, config.WEBSOCKET_PORT)
                else:
                    config.WEBSOCKET_SERVER = False
                    model.stopWebSocketServer()
                    printLog("WebSocket server host or port is not available")

            config.revalidate_selected_models()

            if config.ENABLE_TELEMETRY is True:
                model.telemetryInit(enabled=config.ENABLE_TELEMETRY, app_version=config.VERSION)

            if connected_network is True:
                self.checkSoftwareUpdated()

            self.updateConfigSettings()
            self.initializationStatus("", "", visible=False, phase="done")
            self.startWatchdog()
        except Exception:
            errorLogging()
            self.initializationStatus(
                "Startup hit a background error",
                "Some services may need another second or a restart.",
                visible=True,
                phase="error",
            )

    def enableOscQuery(self):
        self.run(
            200,
            self.run_mapping["enable_osc_query"],
            {
                "data": True,
                "disabled_functions": []
            }
        )

    def disableOscQuery(self, mute_sync_info:bool=False):
        disabled_functions = []
        if mute_sync_info is True:
            disabled_functions.append("vrc_mic_mute_sync")
        self.run(200, self.run_mapping["enable_osc_query"], {
            "data": False,
            "disabled_functions": disabled_functions
        })

    def init(self, *args, **kwargs) -> None:
        removeLog()
        printLog("Start Initialization")
        self.initializationStatus("Starting VRCNT", "Preparing the core app and local settings.", visible=True, phase="starting")

        # Network check
        connected_network = isConnectedNetwork()
        if connected_network is True:
            self.connectedNetwork()
        else:
            self.disconnectedNetwork()
        printLog(f"Connected Network: {connected_network}")
        self.initializationStatus(
            "Checking local environment",
            "Detecting connectivity, local models, and startup defaults.",
            visible=True,
            phase="local",
        )

        self.initializationProgress(1)

        # Download weights
        startup_whisper_weight_type = self._startupWhisperWeightType()
        if connected_network is True:
            printLog("Download CTranslate2 Model Weight")
            # 後方互換用
            model.backwardCompatibleTranslatorCTranslate2ModelRenameWeightsDir()

            download_threads = []
            weight_type = config.CTRANSLATE2_WEIGHT_TYPE
            if (
                model.checkTranslatorCTranslate2ModelWeight(weight_type) is False
                or model.checkTranslatorCTranslate2ModelTokenizer(weight_type) is False
            ):
                th_download_ctranslate2 = Thread(target=self.downloadCtranslate2Weight, args=(weight_type, False))
                th_download_ctranslate2.daemon = True
                th_download_ctranslate2.start()
                download_threads.append(th_download_ctranslate2)

            printLog("Download Whisper Model Weight")
            weight_type = startup_whisper_weight_type
            if model.checkTranscriptionWhisperModelWeight(weight_type) is False:
                th_download_whisper = Thread(target=self.downloadWhisperWeight, args=(weight_type, False))
                th_download_whisper.daemon = True
                th_download_whisper.start()
                download_threads.append(th_download_whisper)

            if len(download_threads) > 0:
                self.initializationStatus(
                    "Downloading required AI models",
                    "Preparing the selected local translation and Whisper models.",
                    visible=True,
                    phase="download",
                )
                for download_thread in download_threads:
                    download_thread.join()

        # Check and disable/enable AI models (parallel)

        def check_ctranslate2() -> bool:
            return (
                model.checkTranslatorCTranslate2ModelWeight(config.CTRANSLATE2_WEIGHT_TYPE) is True
                and model.checkTranslatorCTranslate2ModelTokenizer(config.CTRANSLATE2_WEIGHT_TYPE) is True
            )

        def check_whisper() -> bool:
            return model.checkTranscriptionWhisperModelWeight(startup_whisper_weight_type) is True

        with ThreadPoolExecutor(max_workers=2) as executor:
            future_ctranslate2 = executor.submit(check_ctranslate2)
            future_whisper = executor.submit(check_whisper)
            ctranslate2_available = future_ctranslate2.result()
            whisper_available = future_whisper.result()

        # インスタンス変数にキャッシュ（後続の処理で再利用）
        self._ctranslate2_available_cache = ctranslate2_available
        self._whisper_available_cache_key = startup_whisper_weight_type
        self._whisper_available_cache = whisper_available
        self._fallbackSelectedWhisperWeight(startup_whisper_weight_type, whisper_available)

        if not ctranslate2_available or not whisper_available:
            self.disableAiModels()
        else:
            self.enableAiModels()

        self._applyFastStartupTranslationStatus(connected_network, ctranslate2_available)
        self._applyFastStartupTranscriptionStatus(connected_network, whisper_available)

        self.updateDownloadedCTranslate2ModelWeight()
        self.updateDownloadedWhisperModelWeight()
        self.updateDownloadedVoskModelWeight()
        self.updateDownloadedParakeetModelWeight()
        self.updateDownloadedSenseVoiceModelWeight()
        self.updateTranslationEngineAndEngineList()
        self.updateTranscriptionEngine()
        device_manager.setCallbackHostList(self.updateMicHostList)
        device_manager.setCallbackMicDeviceList(self.updateMicDeviceList)
        device_manager.setCallbackSpeakerDeviceList(self.updateSpeakerDeviceList)

        if config.AUTO_MIC_SELECT is True:
            self.applyAutoMicSelect()
        if config.AUTO_SPEAKER_SELECT is True:
            self.applyAutoSpeakerSelect()

        self.initializationProgress(2)
        self.initializationStatus(
            "Opening interface",
            "The main window is ready. Finishing optional startup tasks in the background.",
            visible=True,
            phase="readying_ui",
        )
        self.updateConfigSettings()
        self.initializationProgress(3)

        bg_thread = Thread(target=self._finishInitializationInBackground, args=(connected_network,))
        bg_thread.daemon = True
        bg_thread.start()

        printLog("End Initialization (core ready, background tasks running)")
