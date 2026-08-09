import os
import sys
import unittest
from unittest.mock import Mock


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import config as config_module
from models.translation.translation_languages import loadTranslationLanguages


Config = config_module.Config


class DeepSeekConfigTests(unittest.TestCase):
    def _new_config_with_defaults(self):
        instance = object.__new__(Config)
        instance.init_config()
        return instance

    def test_auth_key_validator_migrates_legacy_config_by_adding_deepseek_only(self):
        validator = getattr(config_module, "_auth_keys_validator", None)
        self.assertIsNotNone(validator)
        instance = self._new_config_with_defaults()
        legacy_auth_keys = {
            key: value
            for key, value in instance.AUTH_KEYS.items()
            if key != "DeepSeek_API"
        }
        legacy_auth_keys["OpenAI_API"] = "existing-openai-key"

        normalized = validator(legacy_auth_keys, instance)

        self.assertEqual(
            normalized,
            {
                "DeepL_API": None,
                "Plamo_API": None,
                "Gemini_API": None,
                "OpenAI_API": "existing-openai-key",
                "Groq_API": None,
                "Groq_Whisper_API": None,
                "OpenRouter_API": None,
                "DeepSeek_API": None,
            },
        )

    def test_auth_key_validator_allows_explicit_none_to_clear_a_saved_key(self):
        instance = self._new_config_with_defaults()
        instance.saveConfig = Mock()

        instance.AUTH_KEYS = {
            **instance.AUTH_KEYS,
            "DeepSeek_API": "existing-not-a-real-secret",
        }
        instance.AUTH_KEYS = {
            **instance.AUTH_KEYS,
            "DeepSeek_API": None,
        }

        self.assertIsNone(instance.AUTH_KEYS["DeepSeek_API"])
        instance.saveConfig.assert_called_with(
            "AUTH_KEYS",
            instance.AUTH_KEYS,
            immediate_save=False,
        )

    def test_auth_key_validator_rejects_unknown_or_unrelated_missing_keys(self):
        validator = getattr(config_module, "_auth_keys_validator", None)
        self.assertIsNotNone(validator)
        instance = self._new_config_with_defaults()
        current = instance.AUTH_KEYS

        unknown = dict(current, Unexpected_API=None)
        missing_openai = {
            key: value for key, value in current.items() if key != "OpenAI_API"
        }

        self.assertIsNone(validator(unknown, instance))
        self.assertIsNone(validator(missing_openai, instance))

    def test_deepseek_model_defaults_to_flash_and_rejects_unapproved_models(self):
        instance = self._new_config_with_defaults()

        selectable_models = getattr(instance, "SELECTABLE_DEEPSEEK_MODEL_LIST", None)
        selected_model = getattr(instance, "SELECTED_DEEPSEEK_MODEL", None)
        self.assertEqual(
            selectable_models,
            ["deepseek-v4-flash", "deepseek-v4-pro"],
        )
        self.assertEqual(selected_model, "deepseek-v4-flash")

        instance.SELECTED_DEEPSEEK_MODEL = "unapproved-model"

        self.assertEqual(instance.SELECTED_DEEPSEEK_MODEL, "deepseek-v4-flash")

    def test_deepseek_language_mapping_matches_openai(self):
        mappings = loadTranslationLanguages(path=".", force=True)

        self.assertIn("DeepSeek_API", mappings)
        self.assertEqual(mappings["DeepSeek_API"], mappings["OpenAI_API"])


if __name__ == "__main__":
    unittest.main()
