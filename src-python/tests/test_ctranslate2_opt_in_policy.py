import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import controller
from errors import ERROR_METADATA, ErrorCode
from models.translation import translation_utils


class CTranslate2OptInPolicyTests(unittest.TestCase):
    def test_initialization_does_not_auto_download_ctranslate2(self):
        source = Path(controller.__file__).read_text(encoding="utf-8")
        init_start = source.index("    def init(")
        self.assertNotIn("downloadCtranslate2Weight", source[init_start:])

    def test_translation_limit_does_not_advertise_automatic_local_fallback(self):
        metadata = ERROR_METADATA[ErrorCode.TRANSLATION_ENGINE_LIMIT]

        self.assertIs(metadata["auto_fallback"], False)

    def test_controller_has_no_legacy_forced_ctranslate2_fallback(self):
        self.assertFalse(hasattr(controller.Controller, "changeToCTranslate2Process"))

    def test_nllb_weight_does_not_require_m2m_tokenizer_files(self):
        weight_type = "nllb-200-distilled-1.3B-ct2-int8"
        directory_name = translation_utils.ctranslate2_weights[weight_type]["directory_name"]

        with tempfile.TemporaryDirectory() as root:
            weight_path = Path(root, "weights", "ctranslate2", directory_name)
            weight_path.mkdir(parents=True)
            for filename in ("config.json", "model.bin", "shared_vocabulary.json"):
                (weight_path / filename).write_text("{}", encoding="utf-8")

            runtime = SimpleNamespace(Translator=lambda *args, **kwargs: object())
            with patch.object(translation_utils, "_getCtrTranslate2", return_value=runtime):
                self.assertTrue(translation_utils.checkCTranslate2Weight(root, weight_type))

            self.assertFalse((weight_path / "sentencepiece.bpe.model").exists())
            self.assertFalse((weight_path / "vocab.json").exists())

    def test_ctranslate2_weight_requires_the_model_file(self):
        weight_type = "nllb-200-distilled-1.3B-ct2-int8"
        directory_name = translation_utils.ctranslate2_weights[weight_type]["directory_name"]

        with tempfile.TemporaryDirectory() as root:
            weight_path = Path(root, "weights", "ctranslate2", directory_name)
            weight_path.mkdir(parents=True)
            for filename in ("config.json", "shared_vocabulary.json"):
                (weight_path / filename).write_text("{}", encoding="utf-8")

            self.assertFalse(translation_utils.checkCTranslate2Weight(root, weight_type))


if __name__ == "__main__":
    unittest.main()
