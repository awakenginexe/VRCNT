import os
import sys
import unittest


sys.path.insert(
    0,
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..")),
)

from config import _main_window_geometry_validator


class _ConfigStub:
    MAIN_WINDOW_GEOMETRY = {
        "x_pos": 0,
        "y_pos": 0,
        "width": 870,
        "height": 654,
        "maximized": False,
    }


class MainWindowGeometryTests(unittest.TestCase):
    def test_legacy_geometry_without_maximized_migrates_to_normal_window_state(self):
        self.assertEqual(
            _main_window_geometry_validator(
                {
                    "x_pos": 445,
                    "y_pos": 45,
                    "width": 1474,
                    "height": 701,
                },
                _ConfigStub(),
            ),
            {
                "x_pos": 445,
                "y_pos": 45,
                "width": 1474,
                "height": 701,
                "maximized": False,
            },
        )

    def test_geometry_persists_a_real_maximized_state(self):
        self.assertEqual(
            _main_window_geometry_validator(
                {
                    "x_pos": 0,
                    "y_pos": 0,
                    "width": 1920,
                    "height": 1020,
                    "maximized": True,
                },
                _ConfigStub(),
            ),
            {
                "x_pos": 0,
                "y_pos": 0,
                "width": 1920,
                "height": 1020,
                "maximized": True,
            },
        )

    def test_invalid_maximized_value_falls_back_to_normal_window_state(self):
        self.assertEqual(
            _main_window_geometry_validator(
                {
                    "x_pos": 0,
                    "y_pos": 0,
                    "width": 1920,
                    "height": 1020,
                    "maximized": "yes",
                },
                _ConfigStub(),
            )["maximized"],
            False,
        )


if __name__ == "__main__":
    unittest.main()
