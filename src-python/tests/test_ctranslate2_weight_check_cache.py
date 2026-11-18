"""A passed CTranslate2 weight check is remembered until the files or runtime change."""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import models.translation.translation_utils as translation_utils

WEIGHT_TYPE = "m2m100_418M-ct2-int8"


class CTranslate2WeightCheckCacheTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = temporary.name
        directory_name = translation_utils.ctranslate2_weights[WEIGHT_TYPE]["directory_name"]
        self.weight_path = Path(self.root, "weights", "ctranslate2", directory_name)
        self.weight_path.mkdir(parents=True)
        for filename in ("config.json", "model.bin", "shared_vocabulary.json"):
            (self.weight_path / filename).write_text("{}", encoding="utf-8")
        self.runtime = SimpleNamespace(__version__="4.8.1", Translator=Mock())

    def check(self):
        with patch.object(translation_utils, "_getCtrTranslate2", return_value=self.runtime):
            return translation_utils.checkCTranslate2Weight(self.root, WEIGHT_TYPE)

    def test_second_check_skips_the_model_load(self):
        self.assertTrue(self.check())
        self.assertTrue(self.check())
        self.runtime.Translator.assert_called_once()

    def test_changed_model_file_is_checked_again(self):
        self.assertTrue(self.check())
        (self.weight_path / "model.bin").write_text("{\"changed\": true}", encoding="utf-8")
        self.runtime.Translator.side_effect = RuntimeError("corrupt")
        with patch.object(translation_utils, "errorLogging"):
            self.assertFalse(self.check())
        self.assertEqual(self.runtime.Translator.call_count, 2)

    def test_new_ctranslate2_version_checks_again(self):
        self.assertTrue(self.check())
        self.runtime.__version__ = "4.9.0"
        self.assertTrue(self.check())
        self.assertEqual(self.runtime.Translator.call_count, 2)

    def test_failed_check_is_not_remembered(self):
        self.runtime.Translator.side_effect = RuntimeError("corrupt")
        with patch.object(translation_utils, "errorLogging"):
            self.assertFalse(self.check())
            self.assertFalse(self.check())
        self.assertEqual(self.runtime.Translator.call_count, 2)


if __name__ == "__main__":
    unittest.main()
