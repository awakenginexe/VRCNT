import os
import tempfile
import unittest

from models.overlay.font_registry import ManagedOverlayFontRegistry
from models.overlay.overlay_image import OverlayImage


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
