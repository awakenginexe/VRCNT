import os
import tempfile
import unittest
from unittest.mock import patch

import config as config_module
from models.overlay.font_registry import ManagedOverlayFontRegistry
from models.overlay.overlay_image import OverlayImage, normalize_message_text_scale


class ManagedOverlayFontRegistryTests(unittest.TestCase):
    def setUp(self):
        self.cache = tempfile.TemporaryDirectory()
        self.addCleanup(self.cache.cleanup)
        self.font_root = os.path.join(
            os.path.dirname(__file__), "..", "models", "overlay", "fonts"
        )
        self.registry = ManagedOverlayFontRegistry(self.font_root, cache_root=self.cache.name)

    def test_mixed_script_runs_use_the_manifest_managed_packs(self):
        cases = {
            "Hello ไทย": ["latin-greek-cyrillic", "thai"],
            "Hello 日本語": ["latin-greek-cyrillic", "japanese"],
            "ไทย 日本語": ["thai", "japanese"],
            "中文 English": ["cjk-simplified", "latin-greek-cyrillic"],
            "繁體 English": ["cjk-traditional", "latin-greek-cyrillic"],
            "한국어 English": ["korean", "latin-greek-cyrillic"],
            "العربية English": ["arabic", "latin-greek-cyrillic"],
            "हिन्दी English": ["devanagari", "latin-greek-cyrillic"],
        }
        for text, expected in cases.items():
            self.assertEqual([run.pack_id for run in self.registry.resolve_runs(text)], expected)

    def test_overlay_config_defaults_and_legacy_values_use_safe_message_scale(self):
        # Build defaults without loading the user's persisted configuration.
        # The application singleton may legitimately contain a user-selected
        # message scale, so using Config() here makes this regression test
        # depend on the machine that runs it.
        with tempfile.TemporaryDirectory() as user_data_root:
            with patch.object(
                config_module,
                "_getUserDataPath",
                side_effect=lambda name: os.path.join(user_data_root, name),
            ):
                config = object.__new__(config_module.Config)
                config.init_config()

        self.assertEqual(config.OVERLAY_SMALL_LOG_SETTINGS["message_text_scale"], 1.0)
        self.assertEqual(config.OVERLAY_LARGE_LOG_SETTINGS["message_text_scale"], 1.0)
        self.assertEqual(
            config_module._overlay_small_validator(
                {"message_text_scale": 3.0}, config
            )["message_text_scale"],
            2.0,
        )
        legacy = config_module._overlay_large_validator({"ui_scaling": 1.0}, config)
        self.assertEqual(legacy["message_text_scale"], 1.0)

    def test_missing_optional_pack_returns_system_fallback_without_blocking(self):
        runs = self.registry.resolve_runs("አማርኛ English")
        self.assertTrue(runs[0].uses_system_fallback)
        self.assertFalse(runs[1].uses_system_fallback)

    def test_message_language_disambiguates_shared_cjk_characters(self):
        self.assertEqual(
            self.registry.resolve_runs("日本", language="Japanese")[0].pack_id,
            "japanese",
        )
        self.assertEqual(
            self.registry.resolve_runs("國語", language="Chinese Traditional")[0].pack_id,
            "cjk-traditional",
        )

    def test_vr_overlay_draws_mixed_script_runs_without_a_download(self):
        overlay = OverlayImage()
        image = overlay.createTextImageLargeLog(
            "receive", "large", "English ไทย 日本語 العربية हिन्दी", "English"
        )
        self.assertGreater(image.width, 0)
        self.assertGreater(image.height, 0)

    def test_vr_overlay_draws_wrapped_mixed_script_text(self):
        overlay = OverlayImage()
        image = overlay.createTextboxSmallLog(
            "English ไทย 日本語\nالعربية हिन्दी", "Japanese", (255, 255, 255, 255), 640, 80, 36
        )
        self.assertGreater(image.height, 80)

    def test_small_overlay_message_text_scale_recalculates_layout(self):
        overlay = OverlayImage()
        message = "English ไทย 日本語 " * 180
        base = overlay.createOverlayImageSmallLog(
            message,
            "English",
            message_text_scale=1.0,
        )
        enlarged = overlay.createOverlayImageSmallLog(
            message,
            "English",
            message_text_scale=1.5,
        )
        self.assertGreater(enlarged.height, base.height)

    def test_small_overlay_translation_message_text_scale_recalculates_layout(self):
        overlay = OverlayImage()
        translation = ["Japanese 日本語 " * 180]
        base = overlay.createOverlayImageSmallLog(
            "English " * 180,
            "English",
            translation,
            ["Japanese"],
            transliteration_translation=[[]],
            message_text_scale=1.0,
        )
        enlarged = overlay.createOverlayImageSmallLog(
            "English " * 180,
            "English",
            translation,
            ["Japanese"],
            transliteration_translation=[[]],
            message_text_scale=1.5,
        )
        self.assertGreater(enlarged.height, base.height)

    def test_large_overlay_message_text_scale_recalculates_wrapping_and_ruby_layout(self):
        overlay = OverlayImage()
        transliteration = [
            {"orig": "日本", "hira": "にほん", "hepburn": "nihon"},
        ] * 60
        message = "日本 " * 60
        base = overlay.createOverlayImageLargeLog(
            "receive",
            message,
            "Japanese",
            [],
            transliteration_message=transliteration,
            message_text_scale=1.0,
        )
        enlarged = overlay.createOverlayImageLargeLog(
            "receive",
            message,
            "Japanese",
            [],
            transliteration_message=transliteration,
            message_text_scale=1.5,
        )
        self.assertGreater(enlarged.height, base.height)

    def test_missing_message_text_scale_matches_the_default_rendering(self):
        overlay = OverlayImage()
        default_image = overlay.createTextImageLargeLog(
            "receive", "large", "Hello world", "English"
        )
        explicit_default_image = overlay.createTextImageLargeLog(
            "receive", "large", "Hello world", "English", message_text_scale=1.0
        )
        self.assertEqual(default_image.size, explicit_default_image.size)
        self.assertEqual(normalize_message_text_scale(None), 1.0)
        self.assertEqual(normalize_message_text_scale(float("nan")), 1.0)
        self.assertEqual(normalize_message_text_scale(0.1), 0.4)
        self.assertEqual(normalize_message_text_scale(3.0), 2.0)

    def test_large_overlay_translation_message_text_scale_recalculates_layout(self):
        overlay = OverlayImage()
        base = overlay.createTextboxLargeLog(
            "receive",
            "Original",
            "English",
            ["Translated message " * 80],
            ["English"],
            date_time="12:00",
            transliteration_translation=[[]],
            message_text_scale=1.0,
        )
        enlarged = overlay.createTextboxLargeLog(
            "receive",
            "Original",
            "English",
            ["Translated message " * 80],
            ["English"],
            date_time="12:00",
            transliteration_translation=[[]],
            message_text_scale=1.5,
        )
        self.assertGreater(enlarged.height, base.height)

    def test_large_overlay_message_type_header_does_not_use_message_text_scale(self):
        class HeaderSpyOverlay(OverlayImage):
            def __init__(self):
                super().__init__()
                self.header_sizes = []

            def createTextImageMessageType(self, *args, **kwargs):
                image = super().createTextImageMessageType(*args, **kwargs)
                self.header_sizes.append(image.size)
                return image

        overlay = HeaderSpyOverlay()
        overlay.createTextboxLargeLog(
            "receive",
            "Hello world",
            "English",
            date_time="12:00",
            message_text_scale=1.0,
        )
        base_header_size = overlay.header_sizes[-1]
        overlay.header_sizes.clear()
        overlay.createTextboxLargeLog(
            "receive",
            "Hello world",
            "English",
            date_time="12:00",
            message_text_scale=1.5,
        )
        self.assertEqual(overlay.header_sizes[-1], base_header_size)
