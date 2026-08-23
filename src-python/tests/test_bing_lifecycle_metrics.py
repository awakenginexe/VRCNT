import os
import sys
import unittest
from unittest.mock import Mock, patch


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import model as model_module
from model import Model
from models.pipeline.pipeline_types import PipelineSource


class _FakeBingSession:
    def __init__(self, *args, **kwargs):
        del args
        self.callbacks = kwargs


class BingLifecycleMetricTests(unittest.TestCase):
    def test_bing_hypothesis_and_phrase_publish_transcription_lifecycle_status(self):
        instance = object.__new__(Model)
        instance._currentBingLanguageSelection = Mock(
            return_value=("th-TH", "Thai"),
        )
        instance.isSourcePipelineGenerationCurrent = Mock(return_value=True)
        instance._recordVoiceActivity = Mock()
        instance._recordCaptureHeartbeat = Mock()
        instance._emitTranscriptionLifecycleMetric = Mock()
        results = []

        with patch.object(model_module, "BingStreamingSession", _FakeBingSession):
            session, _sync_locale = instance._makeBingStreamingSession(
                PipelineSource.MIC,
                7,
                object(),
                results.append,
            )

        session.callbacks["on_hypothesis"]("สวัสดี")
        session.callbacks["on_voice_activity"](True, 10.0)
        session.callbacks["on_phrase"]("สวัสดีครับ")

        self.assertEqual(
            [(result["text"], result["interim"]) for result in results],
            [("สวัสดี", True), ("สวัสดีครับ", False)],
        )
        lifecycle_calls = [
            call
            for call in instance._emitTranscriptionLifecycleMetric.call_args_list
            if call.kwargs["stage"] == "transcription"
        ]
        self.assertEqual(
            [call.kwargs["outcome"] for call in lifecycle_calls],
            ["running", "success"],
        )
        self.assertTrue(
            all(call.args[0] is PipelineSource.MIC for call in lifecycle_calls)
        )
        self.assertTrue(
            all(call.kwargs["engine"] == "Bing" for call in lifecycle_calls)
        )

    def test_bing_reconnect_publishes_running_status_again(self):
        instance = object.__new__(Model)
        instance._currentBingLanguageSelection = Mock(
            return_value=("th-TH", "Thai"),
        )
        instance.isSourcePipelineGenerationCurrent = Mock(return_value=True)
        instance._recordVoiceActivity = Mock()
        instance._recordCaptureHeartbeat = Mock()
        instance._emitTranscriptionLifecycleMetric = Mock()

        with patch.object(model_module, "BingStreamingSession", _FakeBingSession):
            session, _sync_locale = instance._makeBingStreamingSession(
                PipelineSource.MIC,
                7,
                object(),
                Mock(),
            )

        session.callbacks["on_timing"]("connection_start", 12.0, {})

        self.assertEqual(
            [call.kwargs["outcome"] for call in instance._emitTranscriptionLifecycleMetric.call_args_list],
            ["running", "success"],
        )
        self.assertEqual(
            [call.kwargs["stage"] for call in instance._emitTranscriptionLifecycleMetric.call_args_list],
            ["transcription", "queue"],
        )


if __name__ == "__main__":
    unittest.main()
