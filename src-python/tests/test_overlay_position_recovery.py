import sys
import types
import unittest
from pathlib import Path


SRC_PYTHON = Path(__file__).resolve().parents[1]
if str(SRC_PYTHON) not in sys.path:
    sys.path.insert(0, str(SRC_PYTHON))


def install_fake_openvr():
    fake_openvr = types.ModuleType("openvr")
    fake_openvr.k_unTrackedDeviceIndex_Hmd = 0
    fake_openvr.TrackedControllerRole_LeftHand = 1
    fake_openvr.TrackedControllerRole_RightHand = 2

    class HmdMatrix34_t:
        def __init__(self):
            self.rows = [[0.0 for _ in range(4)] for _ in range(3)]

        def __getitem__(self, index):
            return self.rows[index]

    fake_openvr.HmdMatrix34_t = HmdMatrix34_t
    sys.modules["openvr"] = fake_openvr
    return fake_openvr


install_fake_openvr()
from models.overlay.overlay import Overlay  # noqa: E402


def overlay_settings(tracker="HMD"):
    return {
        "large": {
            "x_pos": 0.0,
            "y_pos": 0.0,
            "z_pos": 0.0,
            "x_rotation": 0.0,
            "y_rotation": 0.0,
            "z_rotation": 0.0,
            "display_duration": 5,
            "fadeout_duration": 0,
            "opacity": 1.0,
            "ui_scaling": 1.0,
            "tracker": tracker,
        }
    }


class FakeVROverlay:
    def __init__(self):
        self.transforms = []
        self.alpha_updates = []

    def setOverlayTransformTrackedDeviceRelative(self, handle, tracker_index, transform):
        self.transforms.append((handle, tracker_index, transform))

    def setOverlayAlpha(self, handle, alpha):
        self.alpha_updates.append((handle, alpha))


class FakeVRSystem:
    def __init__(self):
        self.connected = False

    def getTrackedDeviceIndexForControllerRole(self, role):
        return 7

    def isTrackedDeviceConnected(self, tracker_index):
        return self.connected


class OverlayPositionRecoveryTest(unittest.TestCase):
    def test_update_retries_position_when_tracker_reconnects(self):
        for tracker, expected_tracker_index in (("HMD", 0), ("LeftHand", 7)):
            with self.subTest(tracker=tracker):
                overlay = Overlay(overlay_settings(tracker))
                fake_overlay = FakeVROverlay()
                fake_system = FakeVRSystem()
                overlay.overlay = fake_overlay
                overlay.overlay_system = fake_system
                overlay.handle = {"large": 123}
                overlay.initialized = True

                overlay.updatePosition(
                    0.0,
                    0.0,
                    0.0,
                    0.0,
                    0.0,
                    0.0,
                    tracker,
                    "large",
                )

                self.assertEqual([], fake_overlay.transforms)

                fake_system.connected = True
                overlay.update("large")

                self.assertEqual(1, len(fake_overlay.transforms))
                self.assertEqual((123, expected_tracker_index), fake_overlay.transforms[0][:2])


if __name__ == "__main__":
    unittest.main()
