"""Local decoding profile and family-specific token contract."""

import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from models.translation.translation_translator import Translator, local_translation_beam_size
import controller as controller_module
import mainloop


class Tokenizer:
    def __init__(self):
        self.src_lang = None
        self.encoded = []
        self.lang_code_to_token = {"ja": "__ja__"}

    def encode(self, text, **kwargs):
        self.encoded.append((text, kwargs))
        return [1, 2]

    def convert_ids_to_tokens(self, ids):
        return [str(value) for value in ids]

    def convert_tokens_to_ids(self, tokens):
        return list(tokens)

    def decode(self, tokens):
        return " ".join(tokens)


class Native:
    def __init__(self, output):
        self.output = output
        self.calls = []

    def translate_batch(self, source, **kwargs):
        self.calls.append((source, kwargs))
        return [SimpleNamespace(hypotheses=[self.output])]


class LocalDecodingProfileTests(unittest.TestCase):
    def test_profile_preserves_balanced_default_and_custom_beam(self):
        self.assertEqual(local_translation_beam_size("balanced", 0), 2)
        self.assertEqual(local_translation_beam_size("economy", 0), 1)
        self.assertEqual(local_translation_beam_size("economy", 5), 5)

    def test_controller_validates_and_persists_local_options_without_model_switch(self):
        settings = SimpleNamespace(CTRANSLATE2_DECODING_PROFILE="balanced", CTRANSLATE2_CUSTOM_BEAM_SIZE=0)
        translator = Mock()
        controller = object.__new__(controller_module.Controller)
        with patch.object(controller_module, "config", settings), patch.object(controller_module.model, "translator", translator, create=True):
            self.assertEqual(controller.setCtranslate2DecodingOptions({"profile": "economy", "custom_beam_size": 5})["status"], 200)
            self.assertEqual((settings.CTRANSLATE2_DECODING_PROFILE, settings.CTRANSLATE2_CUSTOM_BEAM_SIZE), ("economy", 5))
            translator.setLocalDecodingOptions.assert_called_once_with("economy", 5)
            self.assertEqual(controller.setCtranslate2DecodingOptions({"custom_beam_size": -1})["status"], 400)
            self.assertEqual(settings.CTRANSLATE2_CUSTOM_BEAM_SIZE, 5)
        self.assertIn("/set/data/ctranslate2_decoding_options", mainloop.mapping)

    def test_each_family_keeps_prefix_and_special_token_behavior_with_economy(self):
        cases = (
            ("m2m100_418M-ct2-int8", "en", "ja", ["__ja__", "hello"], [["__ja__"]], "hello"),
            ("nllb-200-distilled-600M-ct2-int8", "eng_Latn", "jpn_Jpan", ["jpn_Jpan", "hello", "</s>"], [["jpn_Jpan"]], "hello"),
            ("madlad400-3b-mt-ct2-int8", "en", "ja", ["hello", "</s>"], None, "hello </s>"),
        )
        for weight, source, target, output, prefix, expected in cases:
            with self.subTest(weight=weight):
                translator = Translator()
                tokenizer = Tokenizer()
                native = Native(output)
                translator.ctranslate2_tokenizer = tokenizer
                translator.ctranslate2_translator = native
                translator.is_loaded_ctranslate2_model = True
                translator.setLocalDecodingOptions("economy", 0)
                result = translator.translateCTranslate2("text", source, target, weight)
                self.assertEqual(result, expected)
                self.assertEqual(native.calls[0][1].get("beam_size"), 1)
                self.assertEqual(native.calls[0][1].get("target_prefix"), prefix)
                if weight.startswith("nllb"):
                    self.assertEqual(native.calls[0][0], [["1", "2", "</s>", "eng_Latn"]])
                if weight.startswith("madlad"):
                    self.assertEqual(tokenizer.encoded[0][0], "<2ja> text")


if __name__ == "__main__":
    unittest.main()
