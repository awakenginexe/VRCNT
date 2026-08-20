import json
import os
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = ROOT / "src-python"
sys.path.insert(0, os.fspath(PYTHON_ROOT))

from config import Config, _resolve_color_reset_migration_flag


class ColorResetMigrationResolutionTests(unittest.TestCase):
    def test_new_install_is_marked_complete_without_existing_config(self):
        self.assertEqual(
            _resolve_color_reset_migration_flag(False, {}),
            1,
        )

    def test_pre_590_config_without_marker_requires_migration(self):
        self.assertEqual(
            _resolve_color_reset_migration_flag(True, {"TRANSPARENCY": 100}),
            0,
        )

    def test_existing_pending_marker_requires_migration(self):
        self.assertEqual(
            _resolve_color_reset_migration_flag(
                True,
                {"5_9_0_color_reset": 0},
            ),
            0,
        )

    def test_existing_completed_marker_stays_complete(self):
        self.assertEqual(
            _resolve_color_reset_migration_flag(
                True,
                {"5_9_0_color_reset": 1},
            ),
            1,
        )

    def test_load_config_persists_completion_for_a_new_install(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "config.json"
            instance = object.__new__(Config)
            instance.init_config()
            instance._PATH_CONFIG = os.fspath(config_path)

            instance.load_config()

            self.assertEqual(instance.COLOR_RESET_5_9_0, 1)
            saved = json.loads(config_path.read_text(encoding="utf-8"))
            self.assertEqual(saved["5_9_0_color_reset"], 1)

    def test_load_config_keeps_legacy_install_pending(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "config.json"
            config_path.write_text(
                json.dumps({"TRANSPARENCY": 50}),
                encoding="utf-8",
            )
            instance = object.__new__(Config)
            instance.init_config()
            instance._PATH_CONFIG = os.fspath(config_path)

            instance.load_config()

            self.assertEqual(instance.COLOR_RESET_5_9_0, 0)
            saved = json.loads(config_path.read_text(encoding="utf-8"))
            self.assertEqual(saved["5_9_0_color_reset"], 0)


if __name__ == "__main__":
    unittest.main()
