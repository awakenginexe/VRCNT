import copy
import os
import sys
import unittest
from threading import Event, RLock
from unittest.mock import Mock, patch


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import controller as controller_module
from controller import Controller


SPEAKING = {
    "1": {"language": "English", "country": "Singapore", "enable": True},
    "2": {"language": "Thai", "country": "Thailand", "enable": True},
    "3": {"language": "Chinese Traditional", "country": "Taiwan", "enable": True},
}

TARGETS = {
    "1": {"language": "Japanese", "country": "Japan", "enable": True},
    "2": {"language": "Korean", "country": "South Korea", "enable": True},
    "3": {"language": "French", "country": "France", "enable": False},
}

PREFERRED = {
    "1": {"language": "Thai", "country": "Thailand", "enable": True},
    "2": {"language": "English", "country": "Singapore", "enable": False},
    "3": {"language": "Japanese", "country": "Japan", "enable": False},
}


class MultilingualProfilePipelineTests(unittest.TestCase):
    def test_swap_exchanges_complete_sets_and_keeps_preferred_language(self):
        controller = object.__new__(Controller)
        controller._transcription_restart_lock = RLock()
        controller._transcription_shutdown_requested = Event()
        controller._transcription_shutdown_state = "running"
        controller.updateTranslationEngineAndEngineList = Mock()
        controller._requestCoordinatedTranscriptionRestart = Mock(return_value=True)

        your_profiles = {"1": copy.deepcopy(SPEAKING)}
        target_profiles = {"1": copy.deepcopy(TARGETS)}
        preferred_profiles = {"1": copy.deepcopy(PREFERRED)}

        with (
            patch.object(controller_module.config, "_SELECTED_TAB_NO", "1"),
            patch.object(controller_module.config, "_SELECTED_YOUR_LANGUAGES", your_profiles),
            patch.object(controller_module.config, "_SELECTED_TARGET_LANGUAGES", target_profiles),
            patch.object(
                controller_module.config,
                "_SELECTED_YOUR_TRANSLATION_LANGUAGES",
                preferred_profiles,
            ),
        ):
            response = controller.swapYourLanguageAndTargetLanguage()

            self.assertEqual(TARGETS, response["result"]["your"]["1"])
            self.assertEqual(SPEAKING, response["result"]["target"]["1"])
            self.assertEqual(PREFERRED, response["result"]["your_translation"]["1"])
            self.assertIsNot(
                controller_module.config.SELECTED_YOUR_LANGUAGES["1"],
                controller_module.config.SELECTED_TARGET_LANGUAGES["1"],
            )
            controller._requestCoordinatedTranscriptionRestart.assert_called_once_with()
            controller.updateTranslationEngineAndEngineList.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
