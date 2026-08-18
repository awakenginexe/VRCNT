import os
import sys
import unittest
from unittest.mock import patch
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = ROOT / "src-python"
sys.path.insert(0, os.fspath(PYTHON_ROOT))

from config import config, json_serializable_vars
from controller import Controller


class ColorResetMigrationTests(unittest.TestCase):
    def setUp(self):
        self.original_flag = config._COLOR_RESET_5_9_0

    def tearDown(self):
        config._COLOR_RESET_5_9_0 = self.original_flag

    def test_serializer_uses_the_stable_appdata_key(self):
        config._COLOR_RESET_5_9_0 = 0
        serializer = json_serializable_vars["5_9_0_color_reset"]
        self.assertEqual(serializer(config), 0)

        config._COLOR_RESET_5_9_0 = 1
        self.assertEqual(serializer(config), 1)

    def test_controller_persists_the_completed_migration(self):
        with patch.object(config, "saveConfigToFile") as save_config:
            response = Controller.setColorReset590(True)

        self.assertEqual(response, {"status": 200, "result": 1})
        save_config.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
