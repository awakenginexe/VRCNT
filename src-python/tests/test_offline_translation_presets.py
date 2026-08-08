"""Tests for offline translation preset mapping and model registry.

These tests verify:
1. Preset to weight mapping is correct
2. Backward compatibility is maintained
3. Model family detection works properly
4. Model metadata is properly defined
"""
import unittest
from models.translation.translation_utils import (
    ctranslate2_weights,
    OFFLINE_PRESETS,
    get_weight_preset,
    is_preset_weight
)

class TestOfflinePresets(unittest.TestCase):
    """Test preset mapping functionality."""

    def test_preset_mapping_exists(self):
        """Test that all expected presets exist."""
        expected_presets = ["fast", "balanced", "good", "precise"]
        for preset in expected_presets:
            self.assertIn(preset, OFFLINE_PRESETS, f"Missing preset: {preset}")

    def test_preset_to_weight_mapping(self):
        """Test that presets map to correct weight types."""
        expected_mapping = {
            "fast": "m2m100_418M-ct2-int8",
            "balanced": "nllb-200-distilled-600M-ct2-int8",
            "good": "nllb-200-distilled-1.3B-ct2-int8",
            "precise": "madlad400-3b-mt-ct2-int8"
        }
        self.assertEqual(OFFLINE_PRESETS, expected_mapping)

    def test_get_weight_preset_returns_correct_preset(self):
        """Test that get_weight_preset returns the correct preset for each weight."""
        test_cases = [
            ("m2m100_418M-ct2-int8", "fast"),
            ("nllb-200-distilled-600M-ct2-int8", "balanced"),
            ("nllb-200-distilled-1.3B-ct2-int8", "good"),
            ("madlad400-3b-mt-ct2-int8", "precise"),
        ]
        for weight_type, expected_preset in test_cases:
            self.assertEqual(get_weight_preset(weight_type), expected_preset)

    def test_get_weight_preset_returns_none_for_non_presets(self):
        """Test that non-preset weights return None."""
        # Advanced/custom models should return None
        self.assertIsNone(get_weight_preset("custom_model"))
        self.assertIsNone(get_weight_preset("unknown_model"))

    def test_is_preset_weight(self):
        """Test that is_preset_weight identifies presets correctly."""
        self.assertTrue(is_preset_weight("m2m100_418M-ct2-int8"))
        self.assertTrue(is_preset_weight("nllb-200-distilled-600M-ct2-int8"))
        self.assertFalse(is_preset_weight("custom_model"))

class TestModelRegistryMetadata(unittest.TestCase):
    """Test that model registry has correct metadata."""

    def test_all_models_have_required_metadata(self):
        """Test all models have required metadata fields."""
        required_fields = ["display_name", "family", "size_mb", "quantization", "license", "language_coverage"]
        for weight_type, model_data in ctranslate2_weights.items():
            for field in required_fields:
                self.assertIn(field, model_data, f"{weight_type} missing {field}")

    def test_new_models_exist_in_registry(self):
        """Test that new models (NLLB 600M and MADLAD) exist in registry."""
        self.assertIn("nllb-200-distilled-600M-ct2-int8", ctranslate2_weights)
        self.assertIn("madlad400-3b-mt-ct2-int8", ctranslate2_weights)

    def test_model_families_are_correct(self):
        """Test that model families are correctly assigned."""
        # M2M100 models
        self.assertEqual(ctranslate2_weights["m2m100_418M-ct2-int8"]["family"], "m2m100")
        self.assertEqual(ctranslate2_weights["m2m100_1.2B-ct2-int8"]["family"], "m2m100")

        # NLLB models
        self.assertEqual(ctranslate2_weights["nllb-200-distilled-600M-ct2-int8"]["family"], "nllb")
        self.assertEqual(ctranslate2_weights["nllb-200-distilled-1.3B-ct2-int8"]["family"], "nllb")
        self.assertEqual(ctranslate2_weights["nllb-200-3.3B-ct2-int8"]["family"], "nllb")

        # MADLAD model
        self.assertEqual(ctranslate2_weights["madlad400-3b-mt-ct2-int8"]["family"], "madlad400")

    def test_nllb_600m_has_correct_properties(self):
        """Test NLLB 600M has correct properties."""
        model_data = ctranslate2_weights["nllb-200-distilled-600M-ct2-int8"]
        self.assertEqual(model_data["hf_repo"], "osa911/nllb-200-distilled-600M-ct2-int8")
        self.assertEqual(model_data["display_name"], "NLLB-200 Distilled 600M")
        self.assertEqual(model_data["quantization"], "INT8")

    def test_madlad_has_correct_properties(self):
        """Test MADLAD has correct properties."""
        model_data = ctranslate2_weights["madlad400-3b-mt-ct2-int8"]
        self.assertEqual(model_data["hf_repo"], "Nextcloud-AI/madlad400-3b-mt-ct2-int8")
        self.assertEqual(model_data["display_name"], "MADLAD-400 3B MT")
        self.assertEqual(model_data["license"], "Apache-2.0")
        self.assertEqual(model_data["quantization"], "INT8")

if __name__ == "__main__":
    unittest.main()
