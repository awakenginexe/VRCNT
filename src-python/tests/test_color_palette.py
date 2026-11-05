import json
import os
import re
import sys
import tempfile
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

    def test_new_text_defaults_match_frontend(self):
        defaults = config_module.APP_COLOR_PALETTE_DEFAULTS
        self.assertEqual(defaults["textMuted"], "#B8C4D6")
        self.assertEqual(defaults["textSubtle"], "#93A1B8")

    def test_upgrades_untouched_legacy_text_colors(self):
        out = config_module._upgrade_legacy_text_colors(
            {"textMuted": "#94a3b8", "textSubtle": "#64748B"}
        )
        self.assertEqual(out["textMuted"], "#B8C4D6")
        self.assertEqual(out["textSubtle"], "#93A1B8")

    def test_keeps_custom_text_colors(self):
        src = {"textMuted": "#FF0000", "textSubtle": "#123456", "primary": "#64748B"}
        self.assertEqual(config_module._upgrade_legacy_text_colors(src), src)

    def test_load_config_upgrades_saved_legacy_palette(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = os.path.join(temp_dir, "config.json")
            legacy = dict(config_module.APP_COLOR_PALETTE_DEFAULTS)
            legacy.update(textMuted="#94A3B8", textSubtle="#64748B")
            with open(path, "w", encoding="utf-8") as fp:
                json.dump({"APP_COLOR_PALETTE": legacy}, fp)
            instance = object.__new__(config_module.Config)
            instance.init_config()
            instance._PATH_CONFIG = path
            instance.load_config()
            self.assertEqual(instance._APP_COLOR_PALETTE["textMuted"], "#B8C4D6")
            self.assertEqual(instance._APP_COLOR_PALETTE["textSubtle"], "#93A1B8")

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

    def test_app_palette_defaults_match_the_ui(self):
        js_path = os.path.join(os.path.dirname(__file__), "..", "..", "src-ui", "logics", "common", "colorPalette.js")
        with open(js_path, encoding="utf-8") as f:
            source = f.read()
        body = re.search(r"APP_COLOR_PALETTE_DEFAULTS\s*=\s*Object\.freeze\(\{(.*?)\}\)", source, re.S).group(1)
        js_defaults = dict(re.findall(r"(\w+):\s*\"(#[0-9A-Fa-f]{3,8})\"", body))

        self.assertGreater(len(js_defaults), 0, "parsed 0 roles from colorPalette.js")
        self.assertEqual(config_module.APP_COLOR_PALETTE_DEFAULTS, js_defaults)


if __name__ == "__main__":
    unittest.main()
