import os
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


PYTHON_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, os.fspath(PYTHON_ROOT))

import controller as controller_module


class OverlayOutputFilterTests(unittest.TestCase):
    def test_received_only_toggle_has_get_set_routes(self):
        mainloop_source = (PYTHON_ROOT / "mainloop.py").read_text(encoding="utf-8")
        self.assertIn("/get/data/overlay_show_only_received_messages", mainloop_source)
        self.assertIn("/set/enable/overlay_show_only_received_messages", mainloop_source)
        self.assertIn("/set/disable/overlay_show_only_received_messages", mainloop_source)

    def test_received_only_toggle_round_trips_in_controller(self):
        with patch.object(
            controller_module.config,
            "_OVERLAY_SHOW_ONLY_RECEIVED_MESSAGES",
            False,
        ):
            self.assertFalse(
                controller_module.Controller.getOverlayShowOnlyReceivedMessages()["result"]
            )
            self.assertTrue(
                controller_module.Controller.setEnableOverlayShowOnlyReceivedMessages()["result"]
            )
            self.assertFalse(
                controller_module.Controller.setDisableOverlayShowOnlyReceivedMessages()["result"]
            )

    def test_received_only_suppresses_manual_send_overlay(self):
        fake_model = Mock()
        with patch.object(controller_module, "model", fake_model), patch.multiple(
            controller_module.config,
            _OVERLAY_SMALL_LOG=True,
            _OVERLAY_LARGE_LOG=True,
            _OVERLAY_SHOW_ONLY_RECEIVED_MESSAGES=True,
        ):
            result = controller_module.Controller.sendTextOverlay("preview")

        self.assertEqual(result, {"status": 200, "result": "preview"})
        fake_model.createOverlayImageSmallMessage.assert_not_called()
        fake_model.createOverlayImageLargeMessage.assert_not_called()
        fake_model.updateOverlaySmallLog.assert_not_called()
        fake_model.updateOverlayLargeLog.assert_not_called()


if __name__ == "__main__":
    unittest.main()
