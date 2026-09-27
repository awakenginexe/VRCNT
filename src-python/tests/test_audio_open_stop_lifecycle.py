"""Controlled native-call fakes for audio open and read/stop races."""

import os
import sys
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from models.transcription import transcription_recorder as recorder


class BlockingSource:
    def __init__(self, opened, release):
        self.opened = opened
        self.release = release
        self.stream = None
        self.closed = False
        self.closed_event = threading.Event()

    def __enter__(self):
        self.opened.set()
        self.release.wait(2)
        self.stream = self
        return self

    def __exit__(self, *_args):
        self.closed = True
        self.stream = None
        self.closed_event.set()


class BlockingStream:
    def __init__(self):
        self.reading = threading.Event()
        self.release = threading.Event()
        self.read_finished = threading.Event()
        self.stopped = False
        self.closed = False

    def read(self, *_args, **_kwargs):
        self.reading.set()
        self.release.wait(2)
        self.read_finished.set()
        return b"audio"

    def stop_stream(self):
        self.stopped = True
        self.release.set()

    def close(self):
        if not self.read_finished.is_set():
            raise AssertionError("stream closed during native read")
        self.closed = True

    def is_stopped(self):
        return self.stopped


class AudioOpenStopLifecycleTests(unittest.TestCase):
    def test_open_timeout_returns_and_late_stream_is_closed(self):
        opened = threading.Event()
        release = threading.Event()
        source = BlockingSource(opened, release)
        result = []
        with patch.object(recorder, "Microphone", return_value=source), patch.object(
            recorder, "AUDIO_OPEN_TIMEOUT_SECONDS", 0.1, create=True
        ):
            worker = threading.Thread(
                target=lambda: self._capture_open(result), daemon=True
            )
            worker.start()
            try:
                self.assertTrue(opened.wait(1))
                worker.join(0.5)
                self.assertFalse(worker.is_alive(), "open did not time out")
                self.assertIsInstance(result[0], TimeoutError)
            finally:
                release.set()
                worker.join(1)
        self.assertTrue(source.closed_event.wait(1))

    def test_pending_open_does_not_start_a_second_native_call(self):
        opened = threading.Event()
        release = threading.Event()
        source = BlockingSource(opened, release)
        first_result = []
        created = []

        def make_source(**_kwargs):
            created.append(source)
            return source

        with patch.object(recorder, "Microphone", side_effect=make_source), patch.object(
            recorder, "AUDIO_OPEN_TIMEOUT_SECONDS", 0.1
        ):
            first = threading.Thread(target=lambda: self._capture_open(first_result), daemon=True)
            first.start()
            try:
                self.assertTrue(opened.wait(1))
                self.assertRaises(TimeoutError, recorder._create_microphone, {}, device_index=2)
                self.assertEqual(len(created), 1)
            finally:
                release.set()
                first.join(1)
        self.assertTrue(source.closed_event.wait(1))

    def test_device_switch_after_late_open_uses_new_source(self):
        opened = threading.Event()
        release = threading.Event()
        old_source = BlockingSource(opened, release)
        new_source = BlockingSource(threading.Event(), threading.Event())
        new_source.release.set()
        first_result = []

        def make_source(**kwargs):
            return old_source if kwargs.get("device_index") == 1 else new_source

        with patch.object(recorder, "Microphone", side_effect=make_source), patch.object(
            recorder, "AUDIO_OPEN_TIMEOUT_SECONDS", 0.1
        ):
            first = threading.Thread(target=lambda: self._capture_open(first_result), daemon=True)
            first.start()
            self.assertTrue(opened.wait(1))
            first.join(0.5)
            self.assertIsInstance(first_result[0], TimeoutError)
            release.set()
            self.assertTrue(old_source.closed_event.wait(1))
            selected = recorder._create_microphone({}, device_index=2)
        self.assertIs(selected, new_source)
        self.assertTrue(new_source.closed)

    @staticmethod
    def _capture_open(result):
        try:
            recorder._create_microphone({}, device_index=1)
        except Exception as exc:
            result.append(exc)

    def test_stop_unblocks_read_and_close_waits_for_read_to_finish(self):
        raw = BlockingStream()
        stream = recorder._LockedPortAudioStream(raw)
        reader = threading.Thread(target=lambda: stream.read(1024), daemon=True)
        reader.start()
        self.assertTrue(raw.reading.wait(1))
        stopper = threading.Thread(target=stream.stop_stream, daemon=True)
        stopper.start()
        try:
            stopper.join(0.5)
            self.assertFalse(stopper.is_alive(), "stop waited behind blocked read")
            stream.close()
            self.assertTrue(raw.closed)
        finally:
            raw.release.set()
            reader.join(1)
            stopper.join(1)

    def test_unplugged_read_releases_close_ownership(self):
        class UnpluggedStream(BlockingStream):
            def read(self, *_args, **_kwargs):
                self.read_finished.set()
                raise OSError("device unplugged")

        raw = UnpluggedStream()
        stream = recorder._LockedPortAudioStream(raw)
        with self.assertRaisesRegex(OSError, "unplugged"):
            stream.read(1024)
        stream.close()
        self.assertTrue(raw.closed)

    def test_paused_listener_stop_unblocks_source_before_waiting(self):
        release = threading.Event()

        class Source:
            def request_stop_stream(self):
                release.set()

        class Recognizer:
            def listen_energy_and_audio_in_background(self, **_kwargs):
                def stop(wait_for_stop=True):
                    if wait_for_stop:
                        release.wait(2)

                return stop, lambda: None, lambda: None

        with patch.object(recorder, "Recognizer", Recognizer):
            instance = recorder.BaseEnergyAndAudioRecorder(
                source=Source(), energy_threshold=1,
                dynamic_energy_threshold=False, phrase_time_limit=1,
                phrase_timeout=1, record_timeout=5,
            )
            instance.recordIntoQueue([])
            instance.pause()
            worker = threading.Thread(target=instance.stop, daemon=True)
            worker.start()
            try:
                worker.join(0.5)
                self.assertFalse(worker.is_alive(), "listener stop waited before unblocking stream")
            finally:
                release.set()
                worker.join(1)


if __name__ == "__main__":
    unittest.main()
