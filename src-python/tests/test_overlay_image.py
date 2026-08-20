import os
import sys
import unittest
from unittest.mock import patch

from PIL import ImageDraw


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from models.overlay.overlay_image import OverlayImage


class OverlayImageStyleTests(unittest.TestCase):
    def setUp(self):
        self.renderer = OverlayImage()

    def test_background_opacity_maps_percent_to_alpha(self):
        transparent = OverlayImage.resolveOverlayColors(
            background_opacity=0,
            size="large",
        )
        solid = OverlayImage.resolveOverlayColors(
            background_opacity=100,
            size="large",
        )
        self.assertEqual(transparent["background_color"][3], 0)
        self.assertEqual(solid["background_color"][3], 255)

    def test_small_style_controls_output_canvas(self):
        image = self.renderer.createOverlayImageSmallLog(
            "hello",
            "English",
            overlay_style={
                "background_opacity": 100,
                "border_enabled": False,
                "canvas_width": 640,
                "canvas_height": 92,
            },
        )
        self.assertEqual(image.size, (640, 92))

    def test_large_fixed_height_controls_output_canvas(self):
        image = self.renderer.createOverlayImageLargeLog(
            "receive",
            "hello",
            "English",
            overlay_style={
                "background_opacity": 100,
                "canvas_width": 800,
                "canvas_height": 300,
            },
        )
        self.assertEqual(image.size, (800, 300))

    def test_large_zero_height_keeps_auto_height(self):
        image = self.renderer.createOverlayImageLargeLog(
            "receive",
            "hello",
            "English",
            overlay_style={
                "canvas_width": 800,
                "canvas_height": 0,
            },
        )
        self.assertEqual(image.width, 800)
        self.assertGreater(image.height, 0)

    def test_outline_width_is_forwarded_to_script_text(self):
        with patch.object(
            self.renderer,
            "_draw_script_text",
            wraps=self.renderer._draw_script_text,
        ) as draw_script_text:
            self.renderer.createTextImageLargeLog(
                "receive",
                "large",
                "hello",
                "English",
                overlay_style={
                    "text_outline_enabled": True,
                    "text_outline_width": 4,
                },
            )

        self.assertTrue(any(
            call.kwargs.get("stroke_width") == 4
            for call in draw_script_text.call_args_list
        ))

    def test_border_disabled_omits_background_outline(self):
        with patch.object(
            ImageDraw.ImageDraw,
            "rounded_rectangle",
            autospec=True,
        ) as rounded_rectangle:
            self.renderer.createOverlayImageSmallLog(
                "hello",
                "English",
                overlay_style={
                    "border_enabled": False,
                    "canvas_width": 640,
                    "canvas_height": 92,
                },
            )

        self.assertTrue(any(
            call.kwargs.get("outline") is None
            for call in rounded_rectangle.call_args_list
        ))


if __name__ == "__main__":
    unittest.main()
