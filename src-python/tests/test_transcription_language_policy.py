import copy
import importlib
import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from models.transcription.transcription_language_policy import (
    enabled_language_slots,
    enabled_slot_keys,
    normalize_language_profiles,
    normalize_language_slots,
    runtime_language_slots,
    transcription_language_capabilities,
)
import config as config_module
import controller as controller_module
import model as model_module
from controller import Controller


DEFAULT_SLOTS = {
    "1": {"language": "Japanese", "country": "Japan", "enable": True},
    "2": {"language": "English", "country": "United States", "enable": False},
    "3": {"language": "Chinese Simplified", "country": "China", "enable": False},
}

THREE_LANGUAGE_SLOTS = {
    "1": {"language": "English", "country": "Singapore", "enable": True},
    "2": {"language": "Thai", "country": "Thailand", "enable": True},
    "3": {"language": "Chinese Traditional", "country": "Taiwan", "enable": True},
}


class TranscriptionLanguagePolicyTests(unittest.TestCase):
    def test_normalization_keeps_three_unique_enabled_languages_in_slot_order(self):
        normalized = normalize_language_slots(
            THREE_LANGUAGE_SLOTS,
            defaults=DEFAULT_SLOTS,
            minimum_enabled=1,
            maximum_enabled=3,
        )

        self.assertEqual(["1", "2", "3"], enabled_slot_keys(normalized))
        self.assertEqual(
            ["English", "Thai", "Chinese Traditional"],
            [slot["language"] for slot in enabled_language_slots(normalized)],
        )

    def test_duplicate_enabled_pair_is_disabled_without_erasing_its_value(self):
        duplicate_slots = copy.deepcopy(THREE_LANGUAGE_SLOTS)
        duplicate_slots["2"] = {
            "language": "English",
            "country": "Singapore",
            "enable": True,
        }

        normalized = normalize_language_slots(
            duplicate_slots,
            defaults=DEFAULT_SLOTS,
            minimum_enabled=1,
            maximum_enabled=3,
        )

        self.assertTrue(normalized["1"]["enable"])
        self.assertFalse(normalized["2"]["enable"])
        self.assertEqual(
            {"language": "English", "country": "Singapore"},
            {
                "language": normalized["2"]["language"],
                "country": normalized["2"]["country"],
            },
        )

    def test_missing_and_malformed_legacy_slots_are_repaired_from_defaults(self):
        legacy = {
            "1": {"language": "Thai", "country": "Thailand", "enable": False},
            "2": {"language": "Not a language", "country": "Nowhere", "enable": True},
        }

        normalized = normalize_language_slots(
            legacy,
            defaults=DEFAULT_SLOTS,
            minimum_enabled=1,
            maximum_enabled=3,
        )

        self.assertEqual(
            {"language": "Thai", "country": "Thailand", "enable": True},
            normalized["1"],
        )
        self.assertEqual(DEFAULT_SLOTS["2"], normalized["2"])
        self.assertEqual(DEFAULT_SLOTS["3"], normalized["3"])

    def test_single_preferred_language_retains_disabled_slot_values(self):
        normalized = normalize_language_slots(
            THREE_LANGUAGE_SLOTS,
            defaults=DEFAULT_SLOTS,
            minimum_enabled=1,
            maximum_enabled=1,
        )

        self.assertEqual(["1"], enabled_slot_keys(normalized))
        self.assertEqual("Thai", normalized["2"]["language"])
        self.assertEqual("Chinese Traditional", normalized["3"]["language"])

    def test_profile_normalization_repairs_absent_presets_without_discarding_saved_one(self):
        defaults = {"1": DEFAULT_SLOTS, "2": DEFAULT_SLOTS}
        saved = {"1": THREE_LANGUAGE_SLOTS}

        normalized = normalize_language_profiles(saved, defaults, 1, 3)

        self.assertEqual("English", normalized["1"]["1"]["language"])
        self.assertEqual(DEFAULT_SLOTS, normalized["2"])
        self.assertIsNot(normalized["1"], saved["1"])
        self.assertIsNot(normalized["2"], defaults["2"])

    def test_single_language_engines_pause_extras_without_mutating_saved_profile(self):
        for engine in ("Vosk", "Parakeet"):
            with self.subTest(engine=engine):
                saved = copy.deepcopy(THREE_LANGUAGE_SLOTS)

                runtime = runtime_language_slots(engine, saved, direction="microphone")

                self.assertEqual((THREE_LANGUAGE_SLOTS["1"],), runtime)
                self.assertEqual(THREE_LANGUAGE_SLOTS, saved)

    def test_multilingual_engines_activate_up_to_three_saved_languages(self):
        for engine in ("Whisper", "Google", "SenseVoice"):
            for direction in ("microphone", "received"):
                with self.subTest(engine=engine, direction=direction):
                    runtime = runtime_language_slots(
                        engine,
                        THREE_LANGUAGE_SLOTS,
                        direction=direction,
                    )
                    self.assertEqual(
                        (
                            THREE_LANGUAGE_SLOTS["1"],
                            THREE_LANGUAGE_SLOTS["2"],
                            THREE_LANGUAGE_SLOTS["3"],
                        ),
                        runtime,
                    )

    def test_capabilities_explain_parallel_and_single_language_engines(self):
        capabilities = transcription_language_capabilities()

        self.assertEqual(3, capabilities["Google"]["microphone_max"])
        self.assertEqual(3, capabilities["Google"]["received_max"])
        self.assertTrue(capabilities["Google"]["parallel_candidates"])
        self.assertEqual(1, capabilities["Vosk"]["microphone_max"])
        self.assertEqual(1, capabilities["Parakeet"]["received_max"])

        capabilities["Google"]["microphone_max"] = 99
        self.assertEqual(
            3,
            transcription_language_capabilities()["Google"]["microphone_max"],
        )


class LanguageProfileIntegrationTests(unittest.TestCase):
    def test_config_validator_repairs_all_presets_and_disables_duplicates(self):
        defaults = {"1": copy.deepcopy(DEFAULT_SLOTS), "2": copy.deepcopy(DEFAULT_SLOTS)}
        saved = {
            "1": {
                "1": THREE_LANGUAGE_SLOTS["1"],
                "2": THREE_LANGUAGE_SLOTS["1"],
            }
        }
        instance = SimpleNamespace(SELECTED_YOUR_LANGUAGES=defaults)

        normalized = config_module._selected_your_languages_validator(saved, instance)

        self.assertEqual(["1"], enabled_slot_keys(normalized["1"]))
        self.assertEqual("English", normalized["1"]["2"]["language"])
        self.assertEqual(DEFAULT_SLOTS, normalized["2"])

    def test_preferred_language_validator_enables_exactly_one_slot(self):
        defaults = {"1": copy.deepcopy(DEFAULT_SLOTS)}
        instance = SimpleNamespace(SELECTED_YOUR_TRANSLATION_LANGUAGES=defaults)

        normalized = config_module._selected_your_translation_languages_validator(
            {"1": THREE_LANGUAGE_SLOTS},
            instance,
        )

        self.assertEqual(["1"], enabled_slot_keys(normalized["1"]))
        self.assertEqual("Thai", normalized["1"]["2"]["language"])

    def test_engine_normalization_never_mutates_saved_extra_languages(self):
        selected = {"1": copy.deepcopy(THREE_LANGUAGE_SLOTS)}
        controller = object.__new__(Controller)
        controller.run = Mock()
        controller.updateTranslationEngineAndEngineList = Mock()

        with (
            patch.object(controller_module.config, "_SELECTED_TAB_NO", "1"),
            patch.object(controller_module.config, "_SELECTED_TRANSCRIPTION_ENGINE", "Vosk"),
            patch.object(controller_module.config, "_SELECTED_YOUR_LANGUAGES", selected),
        ):
            changed = controller._normalizeSelectedYourLanguageForTranscription()

            self.assertFalse(changed)
            self.assertEqual(THREE_LANGUAGE_SLOTS, controller_module.config.SELECTED_YOUR_LANGUAGES["1"])
            controller.run.assert_not_called()
            controller.updateTranslationEngineAndEngineList.assert_not_called()

    def test_controller_exposes_a_defensive_capability_payload(self):
        first = Controller.getTranscriptionLanguageCapabilities()

        self.assertEqual(200, first["status"])
        self.assertTrue(first["result"]["Google"]["parallel_candidates"])
        first["result"]["Google"]["parallel_candidates"] = False
        self.assertTrue(
            Controller.getTranscriptionLanguageCapabilities()["result"]["Google"]["parallel_candidates"]
        )

    def test_source_vosk_accepts_saved_speaking_extras_when_slot_one_is_supported(self):
        controller = object.__new__(Controller)
        controller.updateTranslationEngineAndEngineList = Mock()
        controller._normalizeSelectedYourLanguageForTranscription = Mock(return_value=False)
        controller._isTranscriptionLanguageSupported = Mock(
            side_effect=lambda slot, engine=None: (
                engine == "Vosk" and slot["language"] == "English"
            )
        )
        old_profiles = {"1": copy.deepcopy(DEFAULT_SLOTS)}
        proposed_profiles = {"1": copy.deepcopy(THREE_LANGUAGE_SLOTS)}

        with (
            patch.object(controller_module.config, "_SELECTED_TAB_NO", "1"),
            patch.object(controller_module.config, "_SELECTED_TRANSCRIPTION_ENGINE", "Google"),
            patch.object(controller_module.config, "_SELECTED_TRANSCRIPTION_ENGINE_SEND", "Vosk"),
            patch.object(controller_module.config, "_SELECTED_YOUR_LANGUAGES", old_profiles),
        ):
            response = controller.setSelectedYourLanguages(proposed_profiles)

            self.assertEqual(THREE_LANGUAGE_SLOTS, response["result"]["1"])

    def test_source_vosk_accepts_saved_target_extras_for_outgoing_translation(self):
        controller = object.__new__(Controller)
        controller.updateTranslationEngineAndEngineList = Mock()
        controller._isTranscriptionLanguageSupported = Mock(
            side_effect=lambda slot, engine=None: (
                engine == "Vosk" and slot["language"] == "English"
            )
        )
        old_profiles = {"1": copy.deepcopy(DEFAULT_SLOTS)}
        proposed_profiles = {"1": copy.deepcopy(THREE_LANGUAGE_SLOTS)}

        with (
            patch.object(controller_module.config, "_SELECTED_TAB_NO", "1"),
            patch.object(controller_module.config, "_SELECTED_TRANSCRIPTION_ENGINE", "Google"),
            patch.object(controller_module.config, "_SELECTED_TRANSCRIPTION_ENGINE_RECEIVE", "Vosk"),
            patch.object(controller_module.config, "_SELECTED_TARGET_LANGUAGES", old_profiles),
            patch.object(controller_module.config, "_ENABLE_TRANSCRIPTION_RECEIVE", True),
        ):
            response = controller.setSelectedTargetLanguages(proposed_profiles)

            self.assertEqual(THREE_LANGUAGE_SLOTS, response["result"]["1"])

    def test_mainloop_registers_the_capability_endpoint(self):
        mainloop = importlib.import_module("mainloop")

        route = mainloop.mapping["/get/data/transcription_language_capabilities"]
        self.assertIs(route["variable"], mainloop.controller.getTranscriptionLanguageCapabilities)
        self.assertFalse(route["status"])

    def test_model_runtime_lists_pause_single_language_engine_extras(self):
        languages, countries = model_module._runtimeTranscriptionLanguageLists(
            "Parakeet",
            THREE_LANGUAGE_SLOTS,
            "microphone",
        )

        self.assertEqual(["English"], languages)
        self.assertEqual(["Singapore"], countries)

    def test_model_runtime_lists_keep_three_received_languages_for_google(self):
        languages, countries = model_module._runtimeTranscriptionLanguageLists(
            "Google",
            THREE_LANGUAGE_SLOTS,
            "received",
        )

        self.assertEqual(["English", "Thai", "Chinese Traditional"], languages)
        self.assertEqual(["Singapore", "Thailand", "Taiwan"], countries)


if __name__ == "__main__":
    unittest.main()
