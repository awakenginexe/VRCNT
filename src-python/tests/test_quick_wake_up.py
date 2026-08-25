import os
import sys
import threading
import unittest
from unittest.mock import Mock, patch


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import controller as controller_module
from controller import Controller
from model import Model
from models.pipeline.pipeline_types import PipelineSource


def _controller_for_main_functions():
    controller = object.__new__(Controller)
    controller._translation_activation_lock = threading.RLock()
    controller._transcription_restart_lock = threading.RLock()
    controller._quick_wake_up_lock = threading.RLock()
    controller._transcription_shutdown_requested = threading.Event()
    controller._transcription_shutdown_state = "running"
    controller.run = Mock()
    return controller


class _BarrierQuickWakeConfig:
    """Force concurrent snapshot readers to start from the same saved state."""

    def __init__(self):
        self.ENABLE_QUICK_WAKE_UP = True
        self._state = {
            "translation": False,
            "transcription_send": False,
            "transcription_receive": False,
        }
        self._state_lock = threading.Lock()
        self._read_barrier = threading.Barrier(2)

    @property
    def QUICK_WAKE_UP_STATE(self):
        with self._state_lock:
            snapshot = dict(self._state)
        try:
            self._read_barrier.wait(timeout=0.5)
        except threading.BrokenBarrierError:
            pass
        return snapshot

    @QUICK_WAKE_UP_STATE.setter
    def QUICK_WAKE_UP_STATE(self, value):
        with self._state_lock:
            self._state = dict(value)


class QuickWakeUpTests(unittest.TestCase):
    def setUp(self):
        self.controller = _controller_for_main_functions()

    def test_successful_main_function_changes_are_persisted_immediately(self):
        initial_state = {
            "translation": False,
            "transcription_send": False,
            "transcription_receive": False,
        }
        with (
            patch.object(controller_module.config, "_ENABLE_QUICK_WAKE_UP", True),
            patch.object(
                controller_module.config,
                "_QUICK_WAKE_UP_STATE",
                initial_state,
            ),
            patch.object(controller_module.config, "_ENABLE_TRANSLATION", False),
            patch.object(controller_module.config, "_ENABLE_TRANSCRIPTION_SEND", False),
            patch.object(controller_module.config, "_ENABLE_TRANSCRIPTION_RECEIVE", False),
            patch.object(controller_module.config, "_SELECTED_TAB_NO", "1"),
            patch.object(
                controller_module.config,
                "_SELECTED_TRANSLATION_ENGINES",
                {"1": "Google"},
            ),
            patch.object(controller_module.config, "saveConfig") as save_config,
            patch.object(
                self.controller,
                "startTranscriptionSendMessage",
                return_value=True,
            ),
            patch.object(
                self.controller,
                "startTranscriptionReceiveMessage",
                return_value=True,
            ),
            patch.object(self.controller, "stopThreadingTranscriptionSendMessage"),
            patch.object(self.controller, "stopThreadingTranscriptionReceiveMessage"),
        ):
            self.assertEqual(self.controller.setEnableTranslation()["status"], 200)
            self.assertEqual(self.controller.setEnableTranscriptionSend()["status"], 200)
            self.assertEqual(self.controller.setEnableTranscriptionReceive()["status"], 200)

            self.assertEqual(
                controller_module.config.QUICK_WAKE_UP_STATE,
                {
                    "translation": True,
                    "transcription_send": True,
                    "transcription_receive": True,
                },
            )

            self.assertEqual(self.controller.setDisableTranslation()["status"], 200)
            self.assertEqual(self.controller.setDisableTranscriptionSend()["status"], 200)
            self.assertEqual(self.controller.setDisableTranscriptionReceive()["status"], 200)

        persisted_snapshots = [
            call for call in save_config.call_args_list
            if call.args[0] == "QUICK_WAKE_UP_STATE"
        ]
        self.assertEqual(len(persisted_snapshots), 6)
        self.assertTrue(all(call.kwargs["immediate_save"] is True for call in persisted_snapshots))
        self.assertEqual(
            persisted_snapshots[-1].args[1],
            {
                "translation": False,
                "transcription_send": False,
                "transcription_receive": False,
            },
        )

    def test_enabled_speaking_flag_restarts_when_pipeline_is_not_active(self):
        with (
            patch.object(controller_module.config, "_ENABLE_QUICK_WAKE_UP", True),
            patch.object(
                controller_module.config,
                "_QUICK_WAKE_UP_STATE",
                {
                    "translation": False,
                    "transcription_send": True,
                    "transcription_receive": False,
                },
            ),
            patch.object(controller_module.config, "_ENABLE_TRANSCRIPTION_SEND", True),
            patch.object(
                controller_module.model,
                "isTranscriptionSourceActive",
                return_value=False,
            ),
            patch.object(
                self.controller,
                "_transcriptionLanguageSupportError",
                return_value=None,
            ),
            patch.object(
                self.controller,
                "_transcriptionModelReadinessError",
                return_value=None,
            ),
            patch.object(
                self.controller,
                "startTranscriptionSendMessage",
                return_value=True,
            ) as start_speaking,
            patch.object(controller_module.config, "saveConfig"),
        ):
            response = self.controller.setEnableTranscriptionSend()

        self.assertEqual(response, {"status": 200, "result": True})
        start_speaking.assert_called_once_with()

    def test_capture_readiness_requires_current_generation_heartbeat(self):
        instance = object.__new__(Model)
        instance._inited = True
        instance._ensureTranscriptionLifecycleState()
        generation = 7
        ready_event = threading.Event()
        stop_event = threading.Event()
        instance._source_pipeline_generations = {
            PipelineSource.MIC: generation,
        }
        instance.mic_source_pipeline = object()
        instance._source_transcription_sessions[PipelineSource.MIC] = {
            "generation": generation,
            "stop_event": stop_event,
            "capture_ready_event": ready_event,
        }

        self.assertFalse(
            instance.waitForTranscriptionSourceReady(
                PipelineSource.MIC,
                generation,
                timeout=0.01,
            )
        )
        ready_event.set()
        self.assertTrue(
            instance.waitForTranscriptionSourceReady(
                PipelineSource.MIC,
                generation,
                timeout=0.01,
            )
        )
        self.assertFalse(
            instance.waitForTranscriptionSourceReady(
                PipelineSource.MIC,
                generation + 1,
                timeout=0.01,
            )
        )

    def test_concurrent_quick_wake_updates_do_not_lose_state_bits(self):
        coordinated_config = _BarrierQuickWakeConfig()
        errors = []

        def record_state(key):
            try:
                self.controller._recordQuickWakeUpState(key, True)
            except BaseException as error:
                errors.append(error)

        with patch.object(controller_module, "config", coordinated_config):
            translation_thread = threading.Thread(
                target=record_state,
                args=("translation",),
            )
            speaking_thread = threading.Thread(
                target=record_state,
                args=("transcription_send",),
            )
            translation_thread.start()
            speaking_thread.start()
            translation_thread.join(timeout=2)
            speaking_thread.join(timeout=2)

        self.assertFalse(translation_thread.is_alive())
        self.assertFalse(speaking_thread.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(
            coordinated_config.QUICK_WAKE_UP_STATE,
            {
                "translation": True,
                "transcription_send": True,
                "transcription_receive": False,
            },
        )

    def test_quick_wake_snapshot_waits_for_failed_speaking_activation(self):
        activation_started = threading.Event()
        release_activation = threading.Event()
        quick_call_started = threading.Event()
        quick_call_finished = threading.Event()
        responses = {}

        def fail_activation_after_release():
            activation_started.set()
            release_activation.wait(timeout=2)
            return False

        def enable_speaking():
            responses["speaking"] = self.controller.setEnableTranscriptionSend()

        def enable_quick_wake():
            quick_call_started.set()
            responses["quick_wake"] = self.controller.setEnableQuickWakeUp()
            quick_call_finished.set()

        with (
            patch.object(controller_module.config, "_ENABLE_QUICK_WAKE_UP", False),
            patch.object(
                controller_module.config,
                "_QUICK_WAKE_UP_STATE",
                {
                    "translation": False,
                    "transcription_send": False,
                    "transcription_receive": False,
                },
            ),
            patch.object(controller_module.config, "_ENABLE_TRANSLATION", False),
            patch.object(controller_module.config, "_ENABLE_TRANSCRIPTION_SEND", False),
            patch.object(controller_module.config, "_ENABLE_TRANSCRIPTION_RECEIVE", False),
            patch.object(controller_module.config, "saveConfig"),
            patch.object(
                self.controller,
                "_transcriptionLanguageSupportError",
                return_value=None,
            ),
            patch.object(
                self.controller,
                "_transcriptionModelReadinessError",
                return_value=None,
            ),
            patch.object(
                self.controller,
                "startTranscriptionSendMessage",
                side_effect=fail_activation_after_release,
            ),
            patch.object(self.controller, "stopTranscriptionSendMessage"),
        ):
            speaking_thread = threading.Thread(target=enable_speaking)
            speaking_thread.start()
            self.assertTrue(activation_started.wait(timeout=2))

            quick_thread = threading.Thread(target=enable_quick_wake)
            quick_thread.start()
            self.assertTrue(quick_call_started.wait(timeout=2))
            completed_before_confirmation = quick_call_finished.wait(timeout=0.25)

            release_activation.set()
            speaking_thread.join(timeout=2)
            quick_thread.join(timeout=2)

            self.assertFalse(speaking_thread.is_alive())
            self.assertFalse(quick_thread.is_alive())
            self.assertFalse(completed_before_confirmation)
            self.assertNotEqual(responses["speaking"]["status"], 200)
            self.assertEqual(responses["quick_wake"], {"status": 200, "result": True})
            self.assertEqual(
                controller_module.config.QUICK_WAKE_UP_STATE,
                {
                    "translation": False,
                    "transcription_send": False,
                    "transcription_receive": False,
                },
            )

    def test_enabling_quick_wake_up_captures_confirmed_active_functions(self):
        with (
            patch.object(controller_module.config, "_ENABLE_QUICK_WAKE_UP", False),
            patch.object(
                controller_module.config,
                "_QUICK_WAKE_UP_STATE",
                {
                    "translation": False,
                    "transcription_send": False,
                    "transcription_receive": False,
                },
            ),
            patch.object(controller_module.config, "_ENABLE_TRANSLATION", True),
            patch.object(controller_module.config, "_ENABLE_TRANSCRIPTION_SEND", True),
            patch.object(controller_module.config, "_ENABLE_TRANSCRIPTION_RECEIVE", True),
            patch.object(controller_module.config, "saveConfig") as save_config,
        ):
            response = self.controller.setEnableQuickWakeUp()

            self.assertEqual(response, {"status": 200, "result": True})
            self.assertEqual(
                controller_module.config.QUICK_WAKE_UP_STATE,
                {
                    "translation": True,
                    "transcription_send": True,
                    "transcription_receive": True,
                },
            )

        persisted_snapshots = [
            call for call in save_config.call_args_list
            if call.args[0] == "QUICK_WAKE_UP_STATE"
        ]
        self.assertEqual(len(persisted_snapshots), 1)
        self.assertIs(persisted_snapshots[0].kwargs["immediate_save"], True)

    def test_restore_with_missing_local_model_preserves_saved_intent(self):
        saved_state = {
            "translation": False,
            "transcription_send": True,
            "transcription_receive": False,
        }
        with (
            patch.object(controller_module.config, "_ENABLE_QUICK_WAKE_UP", True),
            patch.object(
                controller_module.config,
                "_QUICK_WAKE_UP_STATE",
                saved_state,
            ),
            patch.object(controller_module.config, "_ENABLE_TRANSCRIPTION_SEND", False),
            patch.object(
                controller_module.model,
                "_sourceTranscriptionProfile",
                return_value={"engine": "Whisper", "models": {"Whisper": "tiny"}},
            ),
            patch.object(
                controller_module.model,
                "checkTranscriptionWhisperModelWeight",
                return_value=False,
            ),
            patch.object(self.controller, "setDisableTranslation", return_value={"status": 200}),
            patch.object(self.controller, "setDisableTranscriptionReceive", return_value={"status": 200}),
            patch.object(self.controller, "startTranscriptionSendMessage") as start_send,
        ):
            response = self.controller.restoreQuickWakeUp()

            self.assertEqual(controller_module.config.QUICK_WAKE_UP_STATE, saved_state)

        self.assertEqual(response["status"], 200)
        self.assertEqual(response["result"]["transcription_send"]["status"], 400)
        self.assertEqual(
            response["result"]["transcription_send"]["result"]["error_code"],
            "TRANSCRIPTION_MODEL_NOT_READY",
        )
        start_send.assert_not_called()
        self.controller.run.assert_any_call(
            400,
            "/set/enable/transcription_send",
            response["result"]["transcription_send"]["result"],
        )


if __name__ == "__main__":
    unittest.main()
