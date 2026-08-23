import os
import sys
import threading
import unittest
from unittest.mock import Mock, patch


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import controller as controller_module
from controller import Controller


def _controller_for_main_functions():
    controller = object.__new__(Controller)
    controller._translation_activation_lock = threading.RLock()
    controller._transcription_restart_lock = threading.RLock()
    controller._transcription_shutdown_requested = threading.Event()
    controller._transcription_shutdown_state = "running"
    controller.run = Mock()
    return controller


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
