"""Shared Parakeet ownership across microphone and speaker sessions."""

import os
import sys
import threading
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from models.transcription.parakeet_runtime import ParakeetRuntimeManager


class FakeModel:
    def __init__(self):
        self.calls = 0
        self.entered = threading.Event()
        self.release = threading.Event()
        self.release.set()

    def transcribe(self, audio, sample_rate=16000):
        self.calls += 1
        self.entered.set()
        self.release.wait(1)
        return f"phrase {self.calls}"


class ParakeetSharedRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.models = []

        def factory(*_args):
            model = FakeModel()
            self.models.append(model)
            return model

        self.manager = ParakeetRuntimeManager(factory=factory)
        self.audio = np.zeros(160, dtype=np.float32)

    def acquire(self, model="parakeet-v3", device="cuda"):
        return self.manager.acquire("root", model, device, 0)

    def test_same_configuration_loads_once_and_release_preserves_other_source(self):
        mic = self.acquire()
        speaker = self.acquire()
        self.assertEqual(len(self.models), 1)
        mic.close()
        self.assertEqual(speaker.transcribe(self.audio), "phrase 1")
        speaker.close()
        with self.assertRaisesRegex(RuntimeError, "closed"):
            speaker.transcribe(self.audio)
        replacement = self.acquire()
        self.assertEqual(len(self.models), 2)
        replacement.close()

    def test_switch_requires_previous_sources_to_release(self):
        mic = self.acquire()
        speaker = self.acquire()
        with self.assertRaisesRegex(RuntimeError, "still in use"):
            self.acquire(model="another-model")
        mic.close()
        speaker.close()
        changed = self.acquire(model="another-model")
        self.assertEqual(len(self.models), 2)
        changed.close()

    def test_queued_inference_serializes_and_closed_lease_does_not_run(self):
        mic = self.acquire()
        speaker = self.acquire()
        self.models[0].release.clear()
        first = threading.Thread(target=lambda: mic.transcribe(self.audio))
        first.start()
        self.assertTrue(self.models[0].entered.wait(1))
        second_result = []

        def second_call():
            try:
                second_result.append(speaker.transcribe(self.audio))
            except Exception as exc:
                second_result.append(exc)

        second = threading.Thread(target=second_call)
        second.start()
        speaker.close()
        self.models[0].release.set()
        first.join(1)
        second.join(1)
        self.assertEqual(self.models[0].calls, 1)
        self.assertIsInstance(second_result[0], RuntimeError)
        mic.close()

    def test_factory_failure_leaves_manager_reusable(self):
        attempts = 0

        def sometimes_fails(*_args):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise RuntimeError("load failed")
            return FakeModel()

        manager = ParakeetRuntimeManager(factory=sometimes_fails)
        with self.assertRaisesRegex(RuntimeError, "load failed"):
            manager.acquire("root", "v3", "cuda", 0)
        lease = manager.acquire("root", "v3", "cuda", 0)
        self.assertEqual(attempts, 2)
        lease.close()

    def test_shutdown_rejects_acquire_and_waits_to_unload_active_inference(self):
        lease = self.acquire()
        self.models[0].release.clear()
        worker = threading.Thread(target=lambda: lease.transcribe(self.audio))
        worker.start()
        self.assertTrue(self.models[0].entered.wait(1))
        self.manager.shutdown()
        self.assertIsNotNone(self.manager.active_model)
        with self.assertRaisesRegex(RuntimeError, "shut down"):
            self.acquire()
        self.models[0].release.set()
        worker.join(1)
        self.assertIsNone(self.manager.active_model)

    def test_audio_transcribers_share_lease_and_keep_stream_state_separate(self):
        from models.transcription import transcription_transcriber as transcriber_module

        class Source:
            SAMPLE_RATE = 16000
            SAMPLE_WIDTH = 2
            channels = 1

        with patch.object(
            transcriber_module, "_getParakeetHelpers",
            return_value=(self.manager.acquire, lambda *_args: True),
        ):
            mic = transcriber_module.AudioTranscriber(
                speaker=False, source=Source(), phrase_timeout=3, max_phrases=10,
                transcription_engine="Parakeet", root="root",
                parakeet_weight_type="parakeet-v3", device="cuda",
            )
            speaker = transcriber_module.AudioTranscriber(
                speaker=True, source=Source(), phrase_timeout=3, max_phrases=10,
                transcription_engine="Parakeet", root="root",
                parakeet_weight_type="parakeet-v3", device="cuda",
            )
        self.assertEqual(len(self.models), 1)
        self.assertIsNot(mic.audio_sources, speaker.audio_sources)
        mic.close()
        self.assertIsNotNone(self.manager.active_model)
        speaker.close()
        self.assertIsNone(self.manager.active_model)


if __name__ == "__main__":
    unittest.main()
