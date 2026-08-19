import os
import sys
import threading
import unittest
from contextlib import ExitStack
from unittest.mock import Mock, patch


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import controller as controller_module
import config as config_module
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

    def test_active_device_restart_skips_missing_local_model_without_starting_thread(self):
        cases = (
            (
                PipelineSource.MIC,
                "Whisper",
                "tiny",
                "checkTranscriptionWhisperModelWeight",
                "restartAccessMicDevices",
                "startThreadingTranscriptionSendMessage",
                "_ENABLE_TRANSCRIPTION_SEND",
                "_ENABLE_CHECK_ENERGY_SEND",
            ),
            (
                PipelineSource.SPEAKER,
                "Whisper Thai",
                "thai-thonburian-small",
                "checkTranscriptionWhisperThaiModelWeight",
                "restartAccessSpeakerDevices",
                "startThreadingTranscriptionReceiveMessage",
                "_ENABLE_TRANSCRIPTION_RECEIVE",
                "_ENABLE_CHECK_ENERGY_RECEIVE",
            ),
        )

        for (
            source,
            engine,
            weight_type,
            check_name,
            restart_name,
            start_name,
            enable_name,
            energy_name,
        ) in cases:
            with self.subTest(source=source, engine=engine):
                with (
                    patch.object(controller_module.config, enable_name, True),
                    patch.object(controller_module.config, energy_name, False),
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
                    getattr(self.controller, restart_name)()

                check.assert_called_once_with(weight_type)
                start.assert_not_called()

    def test_direct_device_setters_block_missing_active_local_model(self):
        cases = (
            (
                PipelineSource.MIC,
                "Whisper",
                "tiny",
                "checkTranscriptionWhisperModelWeight",
                "setSelectedMicHost",
                "host-a",
                "startThreadingTranscriptionSendMessage",
                "stopThreadingCheckMicEnergy",
                "_ENABLE_TRANSCRIPTION_SEND",
                "_ENABLE_CHECK_ENERGY_SEND",
            ),
            (
                PipelineSource.MIC,
                "Whisper",
                "tiny",
                "checkTranscriptionWhisperModelWeight",
                "setSelectedMicDevice",
                "mic-a",
                "startThreadingTranscriptionSendMessage",
                "stopThreadingCheckMicEnergy",
                "_ENABLE_TRANSCRIPTION_SEND",
                "_ENABLE_CHECK_ENERGY_SEND",
            ),
            (
                PipelineSource.SPEAKER,
                "Whisper Thai",
                "thai-thonburian-small",
                "checkTranscriptionWhisperThaiModelWeight",
                "setSelectedSpeakerDevice",
                "speaker-a",
                "startThreadingTranscriptionReceiveMessage",
                "stopThreadingCheckSpeakerEnergy",
                "_ENABLE_TRANSCRIPTION_RECEIVE",
                "_ENABLE_CHECK_ENERGY_RECEIVE",
            ),
        )

        for (
            source,
            engine,
            weight_type,
            check_name,
            setter_name,
            selected_device,
            start_name,
            stop_name,
            transcription_flag,
            energy_flag,
        ) in cases:
            with self.subTest(setter=setter_name):
                run_mapping = {
                    "selected_mic_device": "selected_mic_device",
                }
                if setter_name == "setSelectedSpeakerDevice":
                    run_mapping = {}
                self.controller.run_mapping = run_mapping
                check = Mock(return_value=False)
                start = Mock()
                stop = Mock()
                patches = [
                    patch.object(controller_module.config, transcription_flag, True),
                    patch.object(controller_module.config, energy_flag, True),
                    patch.object(
                        config_module.device_manager,
                        "getMicDevices",
                        return_value={
                            "old-host": [{"name": "mic-a"}],
                            "host-a": [{"name": "default-mic"}],
                        },
                    ),
                    patch.object(
                        config_module.device_manager,
                        "getSpeakerDevices",
                        return_value=[{"name": "speaker-a"}],
                    ),
                    patch.object(
                        model_module.model,
                        "_sourceTranscriptionProfile",
                        return_value=_profile(engine, weight_type),
                    ),
                    patch.object(
                        model_module.model,
                        check_name,
                        check,
                    ),
                    patch.object(self.controller, start_name, start),
                    patch.object(self.controller, stop_name, stop),
                ]
                if setter_name == "setSelectedMicHost":
                    patches.append(
                        patch.object(
                            model_module.model,
                            "getMicDefaultDevice",
                            return_value="default-mic",
                        )
                    )

                with patch.multiple(
                    controller_module.config,
                    _SELECTED_MIC_HOST="old-host",
                    _SELECTED_MIC_DEVICE="old-mic",
                    _SELECTED_SPEAKER_DEVICE="old-speaker",
                ):
                    with ExitStack() as stack:
                        for test_patch in patches:
                            stack.enter_context(test_patch)
                        response = getattr(self.controller, setter_name)(selected_device)
                        if setter_name == "setSelectedMicHost":
                            self.assertEqual(
                                controller_module.config.SELECTED_MIC_HOST,
                                selected_device,
                            )
                            self.assertEqual(
                                controller_module.config.SELECTED_MIC_DEVICE,
                                "default-mic",
                            )
                        elif setter_name == "setSelectedMicDevice":
                            self.assertEqual(
                                controller_module.config.SELECTED_MIC_DEVICE,
                                selected_device,
                            )
                        else:
                            self.assertEqual(
                                controller_module.config.SELECTED_SPEAKER_DEVICE,
                                selected_device,
                            )

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
                check.assert_called_once_with(weight_type)
                stop.assert_called_once_with()
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
