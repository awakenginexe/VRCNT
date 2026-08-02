import os
import sys
import threading
import time
import unittest


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from models.pipeline.manual_translation_retry import (
    ManualTranslationRetryCoordinator,
)
from models.pipeline.pipeline_types import (
    ManualTranslationRetryRequest,
    TranslationAttempt,
    TranslationStatus,
    TranslationTarget,
)


class FakeTranslator:
    def __init__(self, cooldowns=None, attempts=None):
        self.cooldowns = dict(cooldowns or {})
        self.attempts = list(attempts or [])
        self.calls = []

    def getRateLimitedProviderCooldowns(self, providers):
        return {
            provider: self.cooldowns[provider]
            for provider in providers
            if provider in self.cooldowns
        }

    def rememberProviderTimeout(self, provider):
        self.cooldowns[provider] = 15
        return 15

    def translateAttempt(self, **kwargs):
        self.calls.append(kwargs)
        if self.attempts:
            attempt = self.attempts.pop(0)
            if callable(attempt):
                return attempt(kwargs)
            return attempt
        return TranslationAttempt(
            TranslationStatus.SUCCESS,
            kwargs["translator_name"],
            f"translated:{kwargs['message']}",
            1,
            None,
        )


class UpdateRecorder:
    def __init__(self):
        self.condition = threading.Condition()
        self.updates = []

    def emit(self, update):
        with self.condition:
            self.updates.append(update)
            self.condition.notify_all()

    def wait_for(self, predicate, timeout=1.0):
        deadline = time.monotonic() + timeout
        with self.condition:
            while not predicate():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                self.condition.wait(remaining)
            return True


class ManualTranslationRetryTests(unittest.TestCase):
    @staticmethod
    def request():
        return ManualTranslationRetryRequest(
            trace_id="trace-1",
            target_slot="1",
            original_message="hello",
            source_language="English",
            target=TranslationTarget("1", "Japanese", "Japan"),
        )

    def make_coordinator(
        self,
        translator,
        recorder,
        *,
        fallback=False,
        providers=("Google", "Bing"),
        prepare_local_fallback=lambda: None,
    ):
        return ManualTranslationRetryCoordinator(
            translator=translator,
            emit_update=recorder.emit,
            transliterate=lambda message, _language: (
                {"text": message, "reading": ""},
            ),
            get_providers=lambda: providers,
            get_weight_type=lambda: "Small",
            get_context_history=lambda: (),
            local_fallback_enabled=lambda: fallback,
            prepare_local_fallback=prepare_local_fallback,
            cloud_timeout_seconds=0.05,
        )

    def test_all_cooling_providers_reject_without_fallback(self):
        translator = FakeTranslator(cooldowns={"Google": 24, "Bing": 41})
        recorder = UpdateRecorder()
        coordinator = self.make_coordinator(
            translator,
            recorder,
            fallback=False,
        )

        admission = coordinator.submit(self.request())

        self.assertFalse(admission.accepted)
        self.assertEqual(admission.cooldowns, {"Google": 24, "Bing": 41})
        self.assertEqual(admission.reason, "providers_rate_limited")
        self.assertEqual(translator.calls, [])
        self.assertEqual(recorder.updates, [])

    def test_all_cooling_providers_use_enabled_local_fallback(self):
        translator = FakeTranslator(cooldowns={"Google": 24, "Bing": 41})
        recorder = UpdateRecorder()
        prepared = []
        coordinator = self.make_coordinator(
            translator,
            recorder,
            fallback=True,
            prepare_local_fallback=lambda: prepared.append("loaded"),
        )

        admission = coordinator.submit(self.request())

        self.assertTrue(admission.accepted)
        self.assertTrue(
            recorder.wait_for(
                lambda: recorder.updates
                and recorder.updates[-1].status is TranslationStatus.SUCCESS
            )
        )
        self.assertEqual(
            [call["translator_name"] for call in translator.calls],
            ["CTranslate2"],
        )
        self.assertEqual(prepared, ["loaded"])
        self.assertEqual(recorder.updates[-1].engine, "CTranslate2")
        self.assertEqual(recorder.updates[-1].retry_generation, 1)

    def test_ready_second_provider_is_used_when_first_is_cooling(self):
        translator = FakeTranslator(cooldowns={"Google": 24})
        recorder = UpdateRecorder()
        coordinator = self.make_coordinator(
            translator,
            recorder,
            fallback=True,
        )

        admission = coordinator.submit(self.request())

        self.assertTrue(admission.accepted)
        self.assertTrue(
            recorder.wait_for(
                lambda: recorder.updates
                and recorder.updates[-1].status is TranslationStatus.SUCCESS
            )
        )
        self.assertEqual(
            [call["translator_name"] for call in translator.calls],
            ["Bing"],
        )
        terminal = recorder.updates[-1]
        self.assertEqual(terminal.trace_id, "trace-1")
        self.assertEqual(terminal.target_slot, "1")
        self.assertEqual(terminal.retry_generation, 1)

    def test_missing_deepseek_attempt_falls_through_to_the_next_provider(self):
        translator = FakeTranslator(
            attempts=[
                TranslationAttempt(
                    TranslationStatus.ERROR,
                    "DeepSeek_API",
                    None,
                    1,
                    "empty_provider_result",
                ),
                TranslationAttempt(
                    TranslationStatus.SUCCESS,
                    "Google",
                    "translated",
                    1,
                    None,
                ),
            ]
        )
        recorder = UpdateRecorder()
        coordinator = self.make_coordinator(
            translator,
            recorder,
            fallback=False,
            providers=("DeepSeek_API", "Google"),
        )

        admission = coordinator.submit(self.request())

        self.assertTrue(admission.accepted)
        self.assertTrue(
            recorder.wait_for(
                lambda: recorder.updates
                and recorder.updates[-1].status is TranslationStatus.SUCCESS
            )
        )
        self.assertEqual(
            [call["translator_name"] for call in translator.calls],
            ["DeepSeek_API", "Google"],
        )
        self.assertEqual(recorder.updates[-1].engine, "Google")

    def test_duplicate_active_retry_is_rejected_and_later_retry_increments_generation(self):
        entered = threading.Event()
        release = threading.Event()

        def blocking_attempt(kwargs):
            entered.set()
            release.wait(1.0)
            return TranslationAttempt(
                TranslationStatus.SUCCESS,
                kwargs["translator_name"],
                "translated",
                1,
                None,
            )

        translator = FakeTranslator(attempts=[blocking_attempt])
        recorder = UpdateRecorder()
        coordinator = self.make_coordinator(
            translator,
            recorder,
            fallback=False,
        )

        first = coordinator.submit(self.request())
        self.assertTrue(first.accepted)
        self.assertTrue(entered.wait(1.0))

        duplicate = coordinator.submit(self.request())
        self.assertFalse(duplicate.accepted)
        self.assertEqual(duplicate.reason, "retry_active")

        release.set()
        self.assertTrue(
            recorder.wait_for(
                lambda: recorder.updates
                and recorder.updates[-1].status is TranslationStatus.SUCCESS
            )
        )

        later = coordinator.submit(self.request())
        self.assertTrue(later.accepted)
        self.assertEqual(later.retry_generation, 2)
        self.assertTrue(
            recorder.wait_for(
                lambda: recorder.updates
                and recorder.updates[-1].retry_generation == 2
                and recorder.updates[-1].status is TranslationStatus.SUCCESS
            )
        )


if __name__ == "__main__":
    unittest.main()
