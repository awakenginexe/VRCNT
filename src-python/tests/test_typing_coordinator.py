import os
import sys
import unittest
from threading import Event, RLock
from unittest.mock import Mock


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from models.osc.typing_coordinator import TypingCoordinator
from models.pipeline.pipeline_types import PipelineSource
import model as model_module


class TypingCoordinatorTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.coordinator = TypingCoordinator(
            on_start=lambda: self.events.append("start"),
            on_stop=lambda: self.events.append("stop"),
            release_after=0.4,
        )

    def test_voice_activity_starts_once_and_releases_after_quiet_grace(self):
        self.coordinator.update_voice_activity(True, at=10.0)
        self.coordinator.update_voice_activity(True, at=10.1)
        self.coordinator.update_voice_activity(False, at=10.2)
        self.coordinator.update_voice_activity(False, at=10.5)
        self.assertEqual(self.events, ["start"])

        self.coordinator.update_voice_activity(False, at=10.7)
        self.assertEqual(self.events, ["start", "stop"])

    def test_processing_keeps_indicator_on_after_speech_ends(self):
        self.coordinator.update_voice_activity(True, at=20.0)
        self.coordinator.begin_processing()
        self.coordinator.update_voice_activity(False, at=20.1)
        self.coordinator.update_voice_activity(False, at=20.7)
        self.assertEqual(self.events, ["start"])

        self.coordinator.end_processing()
        self.assertEqual(self.events, ["start", "stop"])

    def test_reset_is_idempotent_and_clears_processing(self):
        self.coordinator.begin_processing()
        self.coordinator.reset()
        self.coordinator.reset()
        self.assertEqual(self.events, ["start", "stop"])
        self.assertFalse(self.coordinator.active)

    def test_microphone_recorder_callback_is_forwarded_only_for_current_session(self):
        instance = object.__new__(model_module.Model)
        instance._source_session_lock = RLock()
        instance._source_pipeline_generations = {PipelineSource.MIC: 7}
        instance._source_transcription_sessions = {
            PipelineSource.MIC: {
                "generation": 7,
                "stop_event": Event(),
            }
        }
        instance.mic_audio_recorder = object()
        instance.mic_source_pipeline = object()
        instance._typing_coordinator = Mock()
        instance._emitTranscriptionLifecycleMetric = Mock()
        audio_queue = Mock()

        callbacks = instance._recorderCallbacks(
            PipelineSource.MIC,
            7,
            audio_queue,
        )
        callbacks["on_voice_activity"](True, 12.5)
        callbacks["on_audio_chunk"](12.6)
        instance._source_transcription_sessions[PipelineSource.MIC]["stop_event"].set()
        callbacks["on_voice_activity"](True, 13.0)

        instance._typing_coordinator.update_voice_activity.assert_called_once_with(
            True,
            at=12.5,
        )
        instance._typing_coordinator.begin_processing.assert_called_once_with()
        instance._emitTranscriptionLifecycleMetric.assert_called_once_with(
            PipelineSource.MIC,
            stage="capture",
            outcome="phrase_ready",
            queue_depth=0,
            duration_ms=100,
        )


if __name__ == "__main__":
    unittest.main()
