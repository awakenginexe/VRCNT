import os
import sys
import unittest


SRC_PYTHON = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if SRC_PYTHON not in sys.path:
    sys.path.insert(0, SRC_PYTHON)

from models.transcription.transcription_parakeet import (
    getParakeetModelMeta,
    listParakeetModelKeys,
)


class ParakeetCatalogTests(unittest.TestCase):
    def test_catalog_contains_only_models_executable_by_the_bundled_runtime(self):
        self.assertEqual(listParakeetModelKeys(), ["parakeet-tdt-0.6b-v3"])
        self.assertTrue(getParakeetModelMeta("parakeet-tdt-0.6b-v3")["downloadable"])


if __name__ == "__main__":
    unittest.main()
