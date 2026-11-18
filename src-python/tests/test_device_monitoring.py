"""Device-change monitoring must not pause capture unless a listed device changed."""

import os
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import device_manager as device_manager_module
from device_manager import DeviceManager


def _manager():
    manager = object.__new__(DeviceManager)
    manager._initialized = False
    with patch.object(device_manager_module, "PyAudio", None):
        manager.init()
    manager.before_mic = Mock()
    manager.after_mic = Mock()
    manager.before_speaker = Mock()
    manager.after_speaker = Mock()
    manager.setCallbackProcessBeforeUpdateMicDevices(manager.before_mic)
    manager.setCallbackProcessAfterUpdateMicDevices(manager.after_mic)
    manager.setCallbackProcessBeforeUpdateSpeakerDevices(manager.before_speaker)
    manager.setCallbackProcessAfterUpdateSpeakerDevices(manager.after_speaker)
    return manager


def _run_monitoring(manager, sleeps_before_stop):
    sleeps = []

    def fake_sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) >= sleeps_before_stop:
            manager.monitoring_flag = False

    with patch.object(device_manager_module, "comtypes", None), patch.object(
        device_manager_module, "sleep", fake_sleep
    ):
        manager.monitoring_flag = True
        manager.monitoring()
    return sleeps


class DeviceMonitoringTests(unittest.TestCase):
    def test_unchanged_devices_keep_capture_running(self):
        manager = _manager()
        manager.update = Mock()

        _run_monitoring(manager, sleeps_before_stop=25)

        self.assertGreater(manager.update.call_count, 10)
        manager.before_mic.assert_not_called()
        manager.before_speaker.assert_not_called()
        manager.after_mic.assert_not_called()
        manager.after_speaker.assert_not_called()

    def test_changed_default_speaker_restarts_capture_once_and_reports_it(self):
        manager = _manager()
        new_speaker = {"device": {"index": 7, "name": "Headset [Loopback]"}}

        def update():
            manager.default_speaker_device = new_speaker

        manager.update = Mock(side_effect=update)
        selected = Mock()
        manager.setCallbackDefaultSpeakerDevice(selected)

        _run_monitoring(manager, sleeps_before_stop=3)

        manager.before_speaker.assert_called_once()
        manager.after_speaker.assert_called_once()
        manager.before_mic.assert_called_once()
        manager.after_mic.assert_called_once()
        selected.assert_called_once_with("Headset [Loopback]")

    def test_stop_exits_without_touching_capture(self):
        manager = _manager()
        manager.update = Mock()

        _run_monitoring(manager, sleeps_before_stop=1)

        manager.update.assert_not_called()
        manager.before_speaker.assert_not_called()


if __name__ == "__main__":
    unittest.main()
