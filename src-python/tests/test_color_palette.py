import os
import sys
import unittest
from unittest.mock import Mock


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import config as config_module
from models.overlay.overlay_image import OverlayImage


class ColorPaletteTests(unittest.TestCase):
    def test_normalizes_hex_and_fills_missing_app_roles(self):
        normalized = config_module._normalize_color_palette(
            {"primary": "#abc"},
            config_module.APP_COLOR_PALETTE_DEFAULTS,
        )

        self.assertEqual(normalized["primary"], "#AABBCC")
        self.assertEqual(
            normalized["canvas"],
            config_module.APP_COLOR_PALETTE_DEFAULTS["canvas"],
        )

    def test_invalid_values_use_the_role_default(self):
        normalized = config_module._normalize_color_palette(
            {"primary": "not-a-color"},
            config_module.APP_COLOR_PALETTE_DEFAULTS,
        )

        self.assertEqual(
            normalized["primary"],
            config_module.APP_COLOR_PALETTE_DEFAULTS["primary"],
        )

    def test_config_properties_are_persisted_and_normalized(self):
        instance = object.__new__(config_module.Config)
        instance.init_config()
        instance.saveConfig = Mock()

        instance.APP_COLOR_PALETTE = {"primary": "#123456"}
        instance.OVERLAY_COLOR_PALETTE = {"sent": "#fedcba"}

        self.assertEqual(instance.APP_COLOR_PALETTE["primary"], "#123456")
        self.assertEqual(
            instance.APP_COLOR_PALETTE["canvas"],
            config_module.APP_COLOR_PALETTE_DEFAULTS["canvas"],
        )
        self.assertEqual(instance.OVERLAY_COLOR_PALETTE["sent"], "#FEDCBA")
        self.assertGreaterEqual(instance.saveConfig.call_count, 2)

    def test_overlay_renderer_accepts_custom_palette(self):
        colors = OverlayImage.resolveOverlayColors(
            size="large",
            color_palette={
                "primary": "#123456",
                "background": "#101010",
                "text": "#EEEEEE",
                "sent": "#ABCDEF",
                "received": "#FEDCBA",
            },
        )

        self.assertEqual(colors["background_outline_color"][:3], (18, 52, 86))
        self.assertEqual(colors["text_color_send"][:3], (171, 205, 239))

    def test_legacy_accent_still_resolves_when_palette_is_missing(self):
        colors = OverlayImage.resolveOverlayColors("theme-emerald-green", size="large")
        self.assertEqual(colors["text_color_send"][:3], (16, 185, 129))


if __name__ == "__main__":
    unittest.main()
