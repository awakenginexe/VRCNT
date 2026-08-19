import os
import sys
import threading
import unittest
from unittest.mock import Mock, patch


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import controller as controller_module
import model as model_module
from controller import Controller
from models.pipeline.pipeline_types import PipelineSource


def _controller_for_activation():
    controller = object.__new__(Controller)
    controller.device_access_status = True
    controller._transcription_restart_lock = threading.RLock()
    controller._translation_activation_lock = threading.RLock()
    controller._transcription_shutdown_requested = threading.Event()
    controller._transcription_shutdown_state = "running"
    controller.run = Mock()
    controller.run_mapping = {}
    return controller


def _profile(engine, weight_type):
    return {"engine": engine, "models": {engine: weight_type}}


class TranscriptionModelReadinessTests(unittest.TestCase):
    def _enable(self, source):
        return (
            self.controller.setEnableTranscriptionSend
            if source is PipelineSource.MIC
            else self.controller.setEnableTranscriptionReceive
        )

    def _config_name(self, source):
        return (
            "_ENABLE_TRANSCRIPTION_SEND"
            if source is PipelineSource.MIC
            else "_ENABLE_TRANSCRIPTION_RECEIVE"
        )

    def setUp(self):
        self.controller = _controller_for_activation()

    def test_missing_local_model_rejects_activation_without_starting_pipeline(self):
        cases = (
            (PipelineSource.MIC, "Whisper", "tiny", "checkTranscriptionWhisperModelWeight"),
            (
                PipelineSource.SPEAKER,
                "Whisper Thai",
                "tiny",
                "checkTranscriptionWhisperThaiModelWeight",
            ),
        )

        for source, engine, weight_type, check_name in cases:
            with self.subTest(source=source, engine=engine):
                start_name = (
                    "startTranscriptionSendMessage"
                    if source is PipelineSource.MIC
                    else "startTranscriptionReceiveMessage"
                )
                with (
                    patch.object(
                        controller_module.config,
                        self._config_name(source),
                        False,
                    ),
                    patch.object(
                        model_module.model,
                        "_sourceTranscriptionProfile",
                        return_value=_profile(engine, weight_type),
                    ),
                    patch.object(
                        model_module.model,
                        check_name,
                        return_value=False,
                    ) as check,
                    patch.object(self.controller, start_name) as start,
                ):
                    response = self._enable(source)()

                self.assertEqual(response["status"], 400)
                self.assertEqual(
                    response["result"]["error_code"],
                    "TRANSCRIPTION_MODEL_NOT_READY",
                )
                self.assertEqual(response["result"]["data"]["source"], source.value)
                self.assertEqual(response["result"]["data"]["engine"], engine)
                self.assertEqual(
                    response["result"]["data"]["weight_type"],
                    weight_type,
                )
                self.assertIs(response["result"]["data"]["retryable"], True)
                self.assertIs(
                    getattr(controller_module.config, self._config_name(source)[1:]),
                    False,
                )
                check.assert_called_once_with(weight_type)
                start.assert_not_called()

    def test_installed_local_model_allows_activation(self):
        with (
            patch.object(controller_module.config, "_ENABLE_TRANSCRIPTION_SEND", False),
            patch.object(
                model_module.model,
                "_sourceTranscriptionProfile",
                return_value=_profile("Whisper", "tiny"),
            ),
            patch.object(
                model_module.model,
                "checkTranscriptionWhisperModelWeight",
                return_value=True,
            ) as check,
            patch.object(
                self.controller,
                "startTranscriptionSendMessage",
                return_value=True,
            ) as start,
        ):
            response = self.controller.setEnableTranscriptionSend()

        self.assertEqual(response, {"status": 200, "result": True})
        check.assert_called_once_with("tiny")
        start.assert_called_once_with()

    def test_google_activation_skips_local_weight_checks(self):
        with (
            patch.object(controller_module.config, "_ENABLE_TRANSCRIPTION_SEND", False),
            patch.object(
                model_module.model,
                "_sourceTranscriptionProfile",
                return_value=_profile("Google", ""),
            ),
            patch.object(
                model_module.model,
                "checkTranscriptionWhisperModelWeight",
            ) as check,
            patch.object(
                self.controller,
                "startTranscriptionSendMessage",
                return_value=True,
            ) as start,
        ):
            response = self.controller.setEnableTranscriptionSend()

        self.assertEqual(response, {"status": 200, "result": True})
        check.assert_not_called()
        start.assert_called_once_with()

    def test_whisper_cloud_retains_its_existing_activation_path(self):
        with (
            patch.object(controller_module.config, "_ENABLE_TRANSCRIPTION_RECEIVE", False),
            patch.object(
                model_module.model,
                "_sourceTranscriptionProfile",
                return_value=_profile("Whisper Cloud", "whisper-large-v3-turbo"),
            ),
            patch.object(
                model_module.model,
                "checkTranscriptionWhisperModelWeight",
            ) as check,
            patch.object(
                self.controller,
                "startTranscriptionReceiveMessage",
                return_value=True,
            ) as start,
        ):
            response = self.controller.setEnableTranscriptionReceive()

        self.assertEqual(response, {"status": 200, "result": True})
        check.assert_not_called()
        start.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
