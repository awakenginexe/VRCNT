import ctypes
import os
import sys
import threading
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import openvr
from PIL import Image
from models.clipboard import clipboard as clipboard_module
from models.overlay import overlay as overlay_module
from models.overlay.openvr_runtime import OpenVRRuntime
from test_overlay_runtime import settings


class OpenVRRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.runtime = OpenVRRuntime()

    def test_clipboard_first_uses_overlay_application_type_and_keeps_overlay_alive(self):
        overlay_owner = object()
        with patch.object(openvr, "init", return_value=Mock()) as initialize, patch.object(
            openvr, "shutdown"
        ) as shutdown:
            with self.runtime.session():
                system = self.runtime.acquire(overlay_owner)
            initialize.assert_called_once_with(openvr.VRApplication_Overlay)
            shutdown.assert_not_called()
            self.assertIs(self.runtime.acquire(overlay_owner), system)
            self.runtime.release(overlay_owner)
            self.runtime.release(overlay_owner)
        shutdown.assert_called_once()

    def test_concurrent_acquisition_initializes_native_runtime_only_once(self):
        entered = threading.Event()
        release = threading.Event()
        owners = [object(), object()]
        results = []

        def initialize(application_type):
            entered.set()
            if not release.wait(2):
                raise TimeoutError("test did not release initialization")
            return system

        system = Mock()
        def acquire(owner):
            results.append(self.runtime.acquire(owner))

        with patch.object(openvr, "init", side_effect=initialize) as initialize_mock, patch.object(
            openvr, "shutdown"
        ) as shutdown:
            workers = [threading.Thread(target=acquire, args=(owner,)) for owner in owners]
            workers[0].start()
            try:
                self.assertTrue(entered.wait(1))
                workers[1].start()
            finally:
                release.set()
                for worker in workers:
                    if worker.ident is not None:
                        worker.join(2)
            self.assertEqual(results, [system, system])
            initialize_mock.assert_called_once_with(openvr.VRApplication_Overlay)
            self.runtime.release(owners[0])
            shutdown.assert_not_called()
            self.runtime.release(owners[1])
            shutdown.assert_called_once()

    def test_failed_native_initialization_is_cleaned_up_and_can_retry(self):
        owner = object()
        system = Mock()
        with patch.object(openvr, "init", side_effect=[OSError("native initialization"), system]), patch.object(
            openvr, "shutdown"
        ) as shutdown:
            with self.assertRaisesRegex(OSError, "native initialization"):
                self.runtime.acquire(owner)
            shutdown.assert_called_once()
            self.assertIs(self.runtime.acquire(owner), system)
            self.runtime.release(owner)
            self.assertEqual(shutdown.call_count, 2)

    def test_clipboard_discovery_cannot_disconnect_live_single_and_multiline_overlays(self):
        configuration = settings()
        configuration["large"] = dict(configuration["small"])
        overlay = overlay_module.Overlay(configuration)
        native_active = False

        def initialize(application_type):
            nonlocal native_active
            self.assertEqual(application_type, openvr.VRApplication_Overlay)
            native_active = True
            return Mock()

        def shutdown():
            nonlocal native_active
            native_active = False

        def upload(handle, buffer, width, height, bpp):
            self.assertTrue(native_active, "clipboard shut down the overlay connection")
            self.assertGreater(width * height, 0)
            self.assertEqual(bpp, 4)

        native_overlay = Mock()
        native_overlay.createOverlay.side_effect = [1, 2]
        native_overlay.setOverlayRaw.side_effect = upload
        apps = Mock()
        apps.getApplicationCount.return_value = 1
        apps.getApplicationKeyByIndex.return_value = "steam.app.438100"
        apps.getApplicationPropertyString.return_value = "VRChat"
        clipboard = object.__new__(clipboard_module.Clipboard)
        with patch.object(overlay_module, "runtime", self.runtime), patch.object(
            clipboard_module, "runtime", self.runtime
        ), patch.object(openvr, "init", side_effect=initialize) as init_mock, patch.object(
            openvr, "shutdown", side_effect=shutdown
        ) as shutdown_mock, patch.object(openvr, "IVROverlay", return_value=native_overlay), patch.object(
            openvr, "VRApplications", return_value=apps
        ), patch.object(overlay_module, "printLog"):
            try:
                overlay.init()
                self.assertTrue(overlay.initialized)
                clipboard._setup_vr_app_name()
                self.assertEqual(clipboard.app_name, "VRChat")
                shutdown_mock.assert_not_called()
                for size in configuration:
                    overlay.updateImage(Image.new("RGBA", (8, 4), "white"), size)
                    overlay.update(size)
                    self.assertTrue(overlay.positionApplied[size])
                self.assertEqual(native_overlay.setOverlayRaw.call_count, 4)
                init_mock.assert_called_once()
            finally:
                overlay._releaseOpenvrResources()
            shutdown_mock.assert_called_once()

    def test_clipboard_discovery_failure_does_not_leak_a_native_session(self):
        clipboard = object.__new__(clipboard_module.Clipboard)
        with patch.object(clipboard_module, "runtime", self.runtime), patch.object(
            openvr, "init", return_value=Mock()
        ), patch.object(openvr, "shutdown") as shutdown, patch.object(
            openvr, "VRApplications", side_effect=RuntimeError("application discovery")
        ), patch.object(clipboard_module, "printLog"):
            clipboard._setup_vr_app_name()
        self.assertIsNone(clipboard.app_name)
        shutdown.assert_called_once()

    def test_overlay_interface_failure_releases_connection_before_retry(self):
        overlay = overlay_module.Overlay(settings())
        native_overlay = Mock()
        native_overlay.createOverlay.return_value = 1
        with patch.object(overlay_module, "runtime", self.runtime), patch.object(
            openvr, "init", return_value=Mock()
        ) as initialize, patch.object(openvr, "shutdown") as shutdown, patch.object(
            openvr, "IVROverlay", side_effect=[OSError("access violation"), native_overlay]
        ), patch.object(overlay_module, "errorLogging"), patch.object(overlay_module, "printLog"):
            overlay.init()
            self.assertFalse(overlay.initialized)
            shutdown.assert_called_once()
            try:
                overlay.init()
                self.assertTrue(overlay.initialized)
                self.assertEqual(initialize.call_count, 2)
            finally:
                overlay._releaseOpenvrResources()
            self.assertEqual(shutdown.call_count, 2)

    def test_rgba_upload_through_real_pyopenvr_function_table_preserves_pixels(self):
        received = []
        callback_type = dict(openvr.IVROverlay_FnTable._fields_)["setOverlayRaw"]

        def upload(handle, buffer, width, height, bpp):
            received.append((handle, width, height, bpp, ctypes.string_at(buffer, width * height * bpp)))
            return 0

        callback = callback_type(upload)
        api = object.__new__(openvr.IVROverlay)
        api.function_table = openvr.IVROverlay_FnTable()
        api.function_table.setOverlayRaw = callback
        overlay = overlay_module.Overlay(settings())
        overlay.overlay = api
        overlay.handle = {"small": 7}
        image = Image.new("RGBA", (8, 4), (10, 20, 30, 255))
        overlay._setOverlayRaw(image, "small")
        self.assertEqual(received, [(7, 8, 4, 4, image.tobytes())])


if __name__ == "__main__":
    unittest.main()
