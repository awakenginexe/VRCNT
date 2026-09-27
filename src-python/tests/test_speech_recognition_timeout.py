"""Pin the fork's record timeout behavior at the app boundary."""

import os
import sys
import time
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import speech_recognition as sr
from models.transcription.transcription_recorder import BaseEnergyAndAudioRecorder


class BufferedSource(sr.AudioSource):
    CHUNK = 2
    SAMPLE_RATE = 20
    SAMPLE_WIDTH = 2

    def __init__(self):
        self.buffers = iter([b"\xff\x7f"] * 5 + [b"\x00\x00"] * 4 + [b""])
        self.stream = self
        self.pyaudio_stream = self

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        pass

    def get_read_available(self):
        return 1

    def read(self, _size):
        time.sleep(0.002)
        return next(self.buffers, b"")


class SpeechRecognitionTimeoutTests(unittest.TestCase):
    @staticmethod
    def recognizer():
        recognizer = sr.Recognizer()
        recognizer.energy_threshold = 100
        recognizer.dynamic_energy_threshold = False
        recognizer.phrase_threshold = 0.1
        recognizer.pause_threshold = 0.2
        recognizer.non_speaking_duration = 0.1
        return recognizer

    def test_zero_setting_still_captures_phrase(self):
        recorder = BaseEnergyAndAudioRecorder(
            source=object(), energy_threshold=100,
            dynamic_energy_threshold=False, phrase_time_limit=5,
            phrase_timeout=1, record_timeout=0,
        )
        audio = self.recognizer().listen_energy_and_audio(
            BufferedSource(), record_timeout=recorder.record_timeout
        )
        self.assertGreater(len(audio.get_raw_data()), 0)

    def test_positive_record_timeout_raises_after_limit(self):
        with self.assertRaises(sr.WaitTimeoutError):
            self.recognizer().listen_energy_and_audio(
                BufferedSource(), record_timeout=1e-9
            )

    def test_app_normalizes_zero_without_changing_positive_timeout(self):
        unlimited = BaseEnergyAndAudioRecorder(
            source=object(), energy_threshold=100,
            dynamic_energy_threshold=False, phrase_time_limit=5,
            phrase_timeout=1, record_timeout=0,
        )
        limited = BaseEnergyAndAudioRecorder(
            source=object(), energy_threshold=100,
            dynamic_energy_threshold=False, phrase_time_limit=5,
            phrase_timeout=1, record_timeout=5,
        )
        self.assertEqual(unlimited.record_timeout, float("inf"))
        self.assertEqual(limited.record_timeout, 5)

    def test_background_stop_handles_unblocked_native_read(self):
        reading = threading.Event()
        released = threading.Event()
        closed = threading.Event()

        class BlockingReadSource(sr.AudioSource):
            CHUNK = 2
            SAMPLE_RATE = 20
            SAMPLE_WIDTH = 2

            def __init__(self):
                self.stream = self
                self.pyaudio_stream = self

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                closed.set()

            def get_read_available(self):
                return 1

            def read(self, _size):
                reading.set()
                released.wait(1)
                raise OSError("read interrupted by stop")

        errors = []
        source = BlockingReadSource()
        with patch.object(threading, "excepthook", side_effect=errors.append):
            stop, pause, resume = self.recognizer().listen_energy_and_audio_in_background(
                source, lambda *_args: None, record_timeout=5
            )
            self.assertTrue(reading.wait(1))
            pause()
            resume()
            stop(wait_for_stop=False)
            released.set()
            stop(wait_for_stop=True)
            self.assertTrue(closed.wait(1))
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
