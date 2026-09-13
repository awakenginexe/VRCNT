"""Audio-boundary regressions; no microphone or cloud account required."""

import os
import sys
import threading
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from speech_recognition import AudioData
from models.transcription.transcription_transcriber import AudioTranscriber
from models.transcription.transcription_bing import BingSTTClient
from models.transcription.bing_protocol import build_text_message, parse_server_message


class GoogleAudioBoundaryTests(unittest.TestCase):
    def test_google_requests_preserve_pcm_with_silent_context_without_accumulation(self):
        for rate, width in ((16000, 2), (48000, 2), (16000, 1)):
            with self.subTest(rate=rate, width=width):
                transcriber = AudioTranscriber(
                    False, SimpleNamespace(SAMPLE_RATE=rate, SAMPLE_WIDTH=width, channels=1),
                    1, 10, "Google",
                )
                original = b"\x12\x34" * 160
                audio = AudioData(original, rate, width)
                requests = []

                def recognize(sent_audio, **kwargs):
                    requests.append(sent_audio)
                    return "recognized", 0.9

                transcriber.audio_recognizer = SimpleNamespace(recognize_google=recognize)
                for _ in range(2):
                    transcriber._recognizeGoogleCandidates(audio, ["Thai"], ["Thailand"])
                expected = bytes(rate * 300 // 1000 * width) + original + bytes(rate * 500 // 1000 * width)
                self.assertEqual([expected, expected], [item.frame_data for item in requests])
                self.assertEqual(original, audio.frame_data)
                self.assertTrue(all(item.sample_rate == rate and item.sample_width == width for item in requests))


class Connection:
    def __init__(self):
        self.sent = []
        self.delivered = threading.Event()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        pass

    def close(self):
        pass

    def send(self, message):
        self.sent.append(message)
        if isinstance(message, bytes) and not parse_server_message(message).body_bytes.startswith(b"RIFF"):
            self.delivered.set()

    def recv(self, timeout=None):
        self.delivered.wait(min(timeout or 0.01, 0.01))
        raise TimeoutError()


class BingAudioBoundaryTests(unittest.TestCase):
    def test_continuations_keep_audio_on_the_declared_stream(self):
        client = BingSTTClient("th-TH")
        client._running = True
        connection = Connection()
        client._send_initial_messages(connection)
        for _ in range(3):
            client.send_audio(b"\x01\x00" * 160)
            client._drain_audio(connection, client._generation)
            client._handle_message(build_text_message("turn.end", {}), client._generation, connection)
        contexts = [parse_server_message(item).json for item in connection.sent if isinstance(item, str) and parse_server_message(item).path == "speech.context"]
        audio_messages = [parse_server_message(item) for item in connection.sent if isinstance(item, bytes)]
        self.assertTrue(all(item.headers["x-streamid"] in contexts[-1]["audio"]["streams"] for item in audio_messages))
        self.assertEqual("300000", contexts[-1]["continuation"]["audio"]["streams"]["1"]["offset"])

    def test_failed_connection_keeps_audio_captured_during_handshake(self):
        connection = Connection()
        attempts = []
        onset = b"\x11\x22" * 160

        def connect(*args, **kwargs):
            attempts.append(1)
            if len(attempts) == 1:
                client.send_audio(onset)
                raise ConnectionError("handshake failed")
            return connection

        client = BingSTTClient("th-TH", connect_factory=connect, reconnect_delay=0.01)
        client.start()
        try:
            self.assertTrue(connection.delivered.wait(1), "queued onset was discarded on reconnect")
            payloads = [parse_server_message(item).body_bytes for item in connection.sent if isinstance(item, bytes)]
            self.assertIn(onset, payloads)
        finally:
            client.stop()

    def test_failed_send_retries_onset_before_later_queued_audio(self):
        client = BingSTTClient("th-TH")
        client._running = True
        onset, rest = b"\x11\x22" * 160, b"\x33\x44" * 160
        client.send_audio(onset)
        client.send_audio(rest)

        class FailedSend(Connection):
            def send(self, message):
                raise ConnectionError("send failed")

        with self.assertRaises(ConnectionError):
            client._drain_audio(FailedSend(), client._generation)
        connection = Connection()
        client._send_initial_messages(connection)
        client._drain_audio(connection, client._generation)
        payloads = [parse_server_message(item).body_bytes for item in connection.sent if isinstance(item, bytes)][1:]
        self.assertEqual([onset, rest], payloads)

    def test_stop_releases_failed_send_audio(self):
        client = BingSTTClient("th-TH")
        client._pending_audio = (b"speech", None)
        client.stop()
        self.assertIsNone(client._pending_audio)
        self.assertTrue(client._audio_queue.empty())

    def test_pending_send_and_full_queue_share_the_retention_limit(self):
        client = BingSTTClient("th-TH")
        client._running = True
        client._pending_audio = (b"onset", None)
        for _ in range(100):
            client.send_audio(b"later")
        self.assertLessEqual(client._audio_queue.qsize() + 1, 64)

    def test_worker_reconnects_and_retries_failed_pcm_before_later_audio(self):
        recovered = Connection()
        attempts = []
        onset, rest = b"\x11\x22" * 160, b"\x33\x44" * 160
        all_sent = threading.Event()

        class FailingConnection(Connection):
            def send(self, message):
                if isinstance(message, bytes) and parse_server_message(message).body_bytes == onset:
                    raise ConnectionError("first PCM send failed")
                super().send(message)

        def connect(*args, **kwargs):
            attempts.append(1)
            if len(attempts) == 1:
                client.send_audio(onset)
                client.send_audio(rest)
                return FailingConnection()
            return recovered

        def timing(kind, at, details):
            if kind == "audio_sent" and client._bytes_sent == 640:
                all_sent.set()

        client = BingSTTClient("th-TH", connect_factory=connect, on_timing=timing, reconnect_delay=0.01)
        client.start()
        try:
            self.assertTrue(all_sent.wait(1), "worker did not replay both PCM chunks")
            payloads = [parse_server_message(item).body_bytes for item in recovered.sent if isinstance(item, bytes)][1:]
            self.assertEqual([onset, rest], payloads)
        finally:
            client.stop()


if __name__ == "__main__":
    unittest.main()
