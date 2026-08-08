"""Tests for MADLAD-400 translation adapter behavior."""
import unittest
from models.translation.translation_utils import ctranslate2_weights
from models.translation.translation_translator import Translator


class _MadladTokenizer:
    def __init__(self):
        self.encoded_text = None

    def encode(self, text):
        self.encoded_text = text
        return [1, 2]

    def convert_ids_to_tokens(self, ids):
        return [f"token-{item}" for item in ids]

    def convert_tokens_to_ids(self, tokens):
        return [7 for _ in tokens]

    def decode(self, ids):
        return "translated"


class _MadladTranslator:
    def __init__(self):
        self.calls = []

    def translate_batch(self, source_tokens, **kwargs):
        self.calls.append((source_tokens, kwargs))
        return [type("Result", (), {"hypotheses": [["translated-token"]]})()]

class TestMADLADAdapter(unittest.TestCase):
    """Test MADLAD-400 translation adapter functionality."""

    def test_madlad_family_detection(self):
        """Test that MADLAD family is correctly detected."""
        translator = Translator()
        self.assertEqual(
            translator.get_ctranslate2_model_family("madlad400-3b-mt-ct2-int8"),
            "madlad400"
        )

    def test_m2m100_family_detection(self):
        """Test that M2M100 family is correctly detected."""
        translator = Translator()
        self.assertEqual(
            translator.get_ctranslate2_model_family("m2m100_418M-ct2-int8"),
            "m2m100"
        )

    def test_nllb_family_detection(self):
        """Test that NLLB family is correctly detected."""
        translator = Translator()
        self.assertEqual(
            translator.get_ctranslate2_model_family("nllb-200-distilled-1.3B-ct2-int8"),
            "nllb"
        )

    def test_unknown_model_returns_none(self):
        """Test that unknown model returns None."""
        translator = Translator()
        self.assertIsNone(translator.get_ctranslate2_model_family("unknown_model"))

    def test_translate_ctranslate2_method_exists(self):
        """Test that translateCTranslate2 method exists."""
        translator = Translator()
        self.assertTrue(hasattr(translator, "translateCTranslate2"))

    def test_madlad_uses_target_instruction_without_prefix_or_output_slice(self):
        translator = Translator()
        tokenizer = _MadladTokenizer()
        native_translator = _MadladTranslator()
        translator.ctranslate2_tokenizer = tokenizer
        translator.ctranslate2_translator = native_translator
        translator.is_loaded_ctranslate2_model = True

        result = translator.translateCTranslate2(
            "hello",
            "en",
            "ja",
            "madlad400-3b-mt-ct2-int8",
        )

        self.assertEqual(result, "translated")
        self.assertEqual(tokenizer.encoded_text, "<2ja> hello")
        self.assertEqual(native_translator.calls[0][1], {})
        self.assertEqual(native_translator.calls[0][0], [["token-1", "token-2"]])

if __name__ == "__main__":
    unittest.main()
