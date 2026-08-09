import os
import sys
import unittest


SRC_PYTHON = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if SRC_PYTHON not in sys.path:
    sys.path.insert(0, SRC_PYTHON)

from models.transcription.transcription_whisper_thai import (
    THAI_WHISPER_MODEL_IDS,
    getWhisperThaiModelCatalog,
    getWhisperThaiModelMeta,
)


class WhisperThaiCatalogTests(unittest.TestCase):
    def test_catalog_has_the_six_approved_models_in_order(self):
        self.assertEqual(
            THAI_WHISPER_MODEL_IDS,
            (
                "thai-thonburian-small",
                "thai-thonburian-medium",
                "thai-thonburian-large-v2",
                "thai-thonburian-large-v3-int8",
                "thai-thonburian-distilled-large-v3",
                "thai-mort666-large-v3-fp16",
            ),
        )
        self.assertEqual(
            [model["display_name"] for model in getWhisperThaiModelCatalog()],
            [
                "Thonburian Thai Small (Experimental)",
                "Thonburian Thai Medium",
                "Thonburian Thai Large V2",
                "Thonburian Thai Large V3 INT8",
                "Thonburian Thai Distilled Large V3",
                "mort666 Thai Large V3 FP16",
            ],
        )

    def test_only_thai_small_is_marked_experimental(self):
        catalog = getWhisperThaiModelCatalog()

        self.assertEqual(
            [model["id"] for model in catalog if model["experimental"]],
            ["thai-thonburian-small"],
        )
        self.assertEqual(
            getWhisperThaiModelMeta("thai-mort666-large-v3-fp16")["family"],
            "mort666 Thai Whisper fine-tune",
        )

    def test_catalog_returns_defensive_metadata_copies(self):
        metadata = getWhisperThaiModelMeta("thai-thonburian-small")
        metadata["display_name"] = "changed"

        self.assertEqual(
            getWhisperThaiModelMeta("thai-thonburian-small")["display_name"],
            "Thonburian Thai Small (Experimental)",
        )


if __name__ == "__main__":
    unittest.main()
