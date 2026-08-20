import os
import sys
import unittest
from unittest.mock import Mock


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import config as config_module


class OverlaySettingsTests(unittest.TestCase):
    def test_transparent_black_migrates_to_71_percent(self):
        result = config_module.normalize_overlay_settings(
            {"background_mode": "transparent_black"},
            "small",
        )
        self.assertEqual(result["background_opacity"], 71)

    def test_solid_black_migrates_to_100_percent(self):
        result = config_module.normalize_overlay_settings(
            {"background_mode": "solid_black"},
            "large",
        )
        self.assertEqual(result["background_opacity"], 100)

    def test_invalid_numeric_values_are_clamped(self):
        result = config_module.normalize_overlay_settings(
            {
                "background_opacity": -10,
                "text_outline_width": 99,
                "canvas_width": 1,
                "canvas_height": 99999,
            },
            "small",
        )
        self.assertEqual(result["background_opacity"], 0)
        self.assertEqual(result["text_outline_width"], 12)
        self.assertEqual(result["canvas_width"], 640)
        self.assertEqual(result["canvas_height"], 2048)

    def test_large_zero_height_preserves_auto_height(self):
        result = config_module.normalize_overlay_settings(
            {"canvas_height": 0},
            "large",
        )
        self.assertEqual(result["canvas_height"], 0)

    def test_small_zero_height_preserves_auto_height(self):
        result = config_module.normalize_overlay_settings(
            {"canvas_height": 0},
            "small",
        )
        self.assertEqual(result["canvas_height"], 0)

    def test_overlay_validators_normalize_new_style_fields(self):
        instance = object.__new__(config_module.Config)
        instance.init_config()
        instance.saveConfig = Mock()

        instance.OVERLAY_SMALL_LOG_SETTINGS = {
            "background_opacity": 55,
            "border_enabled": False,
            "text_outline_enabled": True,
            "text_outline_width": 3,
            "canvas_width": 1400,
            "canvas_height": 120,
        }

        self.assertEqual(instance.OVERLAY_SMALL_LOG_SETTINGS["background_opacity"], 55)
        self.assertFalse(instance.OVERLAY_SMALL_LOG_SETTINGS["border_enabled"])
        self.assertTrue(instance.OVERLAY_SMALL_LOG_SETTINGS["text_outline_enabled"])
        self.assertEqual(instance.OVERLAY_SMALL_LOG_SETTINGS["text_outline_width"], 3)
        self.assertEqual(instance.OVERLAY_SMALL_LOG_SETTINGS["canvas_width"], 1400)
        self.assertEqual(instance.OVERLAY_SMALL_LOG_SETTINGS["canvas_height"], 120)

    def test_received_only_property_defaults_to_false(self):
        instance = object.__new__(config_module.Config)
        instance.init_config()
        self.assertFalse(instance.OVERLAY_SHOW_ONLY_RECEIVED_MESSAGES)

    def test_default_dimensions_match_existing_rendered_canvases(self):
        instance = object.__new__(config_module.Config)
        instance.init_config()
        self.assertEqual(instance.OVERLAY_SMALL_LOG_SETTINGS["canvas_width"], 3940)
        self.assertEqual(instance.OVERLAY_SMALL_LOG_SETTINGS["canvas_height"], 0)
        self.assertEqual(instance.OVERLAY_LARGE_LOG_SETTINGS["canvas_width"], 1312)
        self.assertEqual(instance.OVERLAY_LARGE_LOG_SETTINGS["canvas_height"], 0)


if __name__ == "__main__":
    unittest.main()
