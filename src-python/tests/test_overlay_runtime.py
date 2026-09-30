import os
import sys
import threading
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from PIL import Image
from psutil import AccessDenied
from models.overlay import overlay as overlay_module
from models.overlay.overlay import Overlay
from models.overlay.openvr_runtime import OpenVRRuntime


def settings():
    return {"small": dict(x_pos=0.0, y_pos=0.0, z_pos=0.0,
                          x_rotation=0.0, y_rotation=0.0, z_rotation=0.0,
                          display_duration=5, fadeout_duration=2,
                          opacity=1.0, ui_scaling=1.0, tracker="HMD")}


class OverlayRuntimeTests(unittest.TestCase):
    def setUp(self):
        runtime_patch = patch.object(overlay_module, "runtime", OpenVRRuntime())
        runtime_patch.start()
        self.addCleanup(runtime_patch.stop)

    def test_restart_during_slow_initialization_waits_for_old_worker(self):
        overlay = Overlay(settings())
        entered = threading.Event()
        release = threading.Event()
        restarted = threading.Event()
        calls = []

        def initialize():
            calls.append(threading.current_thread())
            if len(calls) == 1:
                entered.set()
                release.wait(5.0)
            else:
                restarted.set()
            overlay.initialized = False

        with patch.object(overlay, "checkSteamvrRunning", return_value=True), patch.object(
            overlay, "init", side_effect=initialize
        ), patch.object(overlay, "_releaseOpenvrResources"), patch.object(
            threading.Thread, "join", autospec=True
        ):
            overlay.startOverlay()
            self.assertTrue(entered.wait(1.0))
            old_worker = overlay.thread_overlay
            overlay.shutdownOverlay()
            overlay.updateImage(Image.new("RGBA", (8, 4), "white"), "small")
            try:
                self.assertIs(overlay.thread_overlay, old_worker)
                self.assertEqual(len(calls), 1)
                release.set()
                self.assertTrue(restarted.wait(1.0))
            finally:
                release.set()
                overlay.shutdownOverlay()
        old_worker.join(1.0)

    def test_image_submission_never_waits_for_steamvr_initialization(self):
        overlay = Overlay(settings())
        image = Image.new("RGBA", (8, 4), "white")
        with patch.object(overlay, "startOverlay") as start, patch.object(
            overlay, "_waitUntilInitialized", return_value=False
        ) as wait:
            overlay.updateImage(image, "small")
        start.assert_called_once()
        wait.assert_not_called()
        self.assertEqual(overlay.lastImage["small"].tobytes(), image.tobytes())

    def test_latest_image_upload_runs_on_overlay_update_and_restores_opacity(self):
        overlay = Overlay(settings())
        overlay.initialized = True
        overlay.overlay = Mock()
        overlay.handle = {"small": 1}
        overlay.positionApplied["small"] = True
        overlay.fadeRatio["small"] = 0.0
        first = Image.new("RGBA", (8, 4), "red")
        latest = Image.new("RGBA", (8, 4), "white")
        with patch.object(overlay, "_setOverlayRaw") as upload:
            overlay.updateImage(first, "small")
            overlay.updateImage(latest, "small")
            upload.assert_not_called()
            overlay.update("small")
        upload.assert_called_once()
        self.assertEqual(upload.call_args.args[0].tobytes(), latest.tobytes())
        overlay.overlay.setOverlayAlpha.assert_called_with(1, 1.0)

    def test_unreadable_process_does_not_hide_running_steamvr(self):
        protected = Mock()
        protected.name.side_effect = AccessDenied(42)
        steamvr = Mock()
        steamvr.name.return_value = "vrmonitor.exe" if os.name == "nt" else "vrmonitor"
        with patch.object(overlay_module, "process_iter", return_value=[protected, steamvr]):
            self.assertTrue(Overlay.checkSteamvrRunning())

    def test_steamvr_server_without_monitor_allows_overlay_startup(self):
        server = Mock()
        server.name.return_value = "VRSERVER.EXE" if os.name == "nt" else "vrserver"
        with patch.object(overlay_module, "process_iter", return_value=[server]):
            self.assertTrue(Overlay.checkSteamvrRunning())

    def test_clear_before_initialization_replaces_cached_image_without_starting_vr(self):
        overlay = Overlay(settings())
        with patch.object(overlay, "startOverlay") as start:
            overlay.clearImage("small")
        start.assert_not_called()
        self.assertEqual(overlay.lastImage["small"].getpixel((0, 0)), (0, 0, 0, 0))

    def test_image_upload_failure_is_replayed_after_openvr_reinitialization(self):
        overlay = Overlay(settings())
        overlay.initialized = True
        overlay.overlay = Mock()
        overlay.handle = {"small": 1}
        overlay.positionApplied["small"] = True
        image = Image.new("RGBA", (8, 4), "white")
        overlay.updateImage(image, "small")
        with patch.object(overlay, "_setOverlayRaw", side_effect=RuntimeError("lost overlay")):
            with self.assertRaisesRegex(RuntimeError, "lost overlay"):
                overlay.update("small")
        fake_overlay = Mock()
        fake_overlay.createOverlay.return_value = 2
        with patch.object(overlay_module.openvr, "init"), patch.object(
            overlay_module.openvr, "IVROverlay", return_value=fake_overlay
        ), patch.object(overlay_module.openvr, "IVRSystem"), patch.object(
            overlay, "_setOverlayRaw"
        ) as upload, patch.object(overlay_module, "printLog"):
            overlay.init()
        self.assertTrue(overlay.initialized)
        self.assertEqual(upload.call_args.args[0].tobytes(), image.tobytes())


if __name__ == "__main__":
    unittest.main()
