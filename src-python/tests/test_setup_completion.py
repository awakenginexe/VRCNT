import os
import sys
import types
import unittest
from unittest.mock import patch


sys.path.insert(
    0,
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..")),
)

if "requests" not in sys.modules:
    requests_stub = types.ModuleType("requests")
    requests_stub.post = lambda *args, **kwargs: None
    sys.modules["requests"] = requests_stub


def _resolve_setup_completion(*args, **kwargs):
    from config import _resolveSetupCompletion

    return _resolveSetupCompletion(*args, **kwargs)


import controller as controller_module
from controller import Controller


class SetupCompletionTests(unittest.TestCase):
    def test_new_install_starts_incomplete(self):
        self.assertIs(_resolve_setup_completion(False), False)

    def test_existing_config_without_state_migrates_to_complete(self):
        self.assertIs(
            _resolve_setup_completion(True, config_data={"FONT_FAMILY": "VRCNT Noto"}),
            True,
        )

    def test_installer_language_only_config_starts_incomplete(self):
        self.assertIs(
            _resolve_setup_completion(True, config_data={"UI_LANGUAGE": "en"}),
            False,
        )

    def test_explicit_false_survives_resume(self):
        self.assertIs(_resolve_setup_completion(True, False), False)

    def test_explicit_true_stays_complete(self):
        self.assertIs(_resolve_setup_completion(False, True), True)

    def test_acknowledged_setup_completion_is_saved_immediately(self):
        with (
            patch.object(controller_module.config, "_SETUP_COMPLETED", False),
            patch.object(controller_module.config, "saveConfig") as save_config,
        ):
            response = Controller.setSetupCompleted(True)

        self.assertEqual(response, {"status": 200, "result": True})
        save_config.assert_called_once_with(
            "SETUP_COMPLETED",
            True,
            immediate_save=True,
        )

    def test_controller_exposes_setup_completion_methods(self):
        controller_path = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "controller.py")
        )
        with open(controller_path, encoding="utf-8") as controller_file:
            controller_source = controller_file.read()

        self.assertIn("def getSetupCompleted", controller_source)
        self.assertIn("def setSetupCompleted", controller_source)

    def test_mainloop_registers_setup_completion_endpoints(self):
        mainloop_path = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "mainloop.py")
        )
        with open(mainloop_path, encoding="utf-8") as mainloop_file:
            mainloop_source = mainloop_file.read()

        self.assertIn("/get/data/setup_completed", mainloop_source)
        self.assertIn("/set/data/setup_completed", mainloop_source)


if __name__ == "__main__":
    unittest.main()
