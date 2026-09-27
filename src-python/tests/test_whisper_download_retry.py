"""Whisper download retry and atomic replacement regression tests."""

import os
import sys
import tempfile
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import requests

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from models.transcription import transcription_whisper as whisper


class Response:
    headers = {"content-length": "4"}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def raise_for_status(self):
        return None

    def iter_content(self, chunk_size):
        yield b"new!"


class WhisperDownloadRetryTests(unittest.TestCase):
    def test_transient_network_error_retries_then_atomically_replaces_target(self):
        with tempfile.TemporaryDirectory() as directory:
            target = os.path.join(directory, "model.bin")
            with open(target, "wb") as file:
                file.write(b"old!")
            with patch.object(whisper, "requests_get", side_effect=[requests.ConnectionError("reset"), Response()]) as get, patch.object(whisper, "_DOWNLOAD_RETRY_BACKOFF_SECONDS", 0):
                self.assertTrue(whisper.downloadFile("https://example.test/model.bin", target))
            self.assertEqual(get.call_count, 2)
            with open(target, "rb") as file:
                self.assertEqual(file.read(), b"new!")
            self.assertFalse(os.path.exists(target + ".part"))

    def test_404_is_not_retried_and_existing_target_survives(self):
        error = requests.HTTPError("missing", response=SimpleNamespace(status_code=404))
        with tempfile.TemporaryDirectory() as directory:
            target = os.path.join(directory, "model.bin")
            with open(target, "wb") as file:
                file.write(b"old!")
            with patch.object(whisper, "requests_get", side_effect=error) as get:
                self.assertFalse(whisper.downloadFile("https://example.test/model.bin", target))
            self.assertEqual(get.call_count, 1)
            with open(target, "rb") as file:
                self.assertEqual(file.read(), b"old!")

    def test_cancel_during_retry_backoff_stops_before_second_request(self):
        cancel = threading.Event()
        with tempfile.TemporaryDirectory() as directory:
            target = os.path.join(directory, "model.bin")
            with patch.object(whisper, "requests_get", side_effect=requests.ConnectionError("reset")) as get, patch.object(whisper, "_DOWNLOAD_RETRY_BACKOFF_SECONDS", 0.01), patch.object(cancel, "wait", side_effect=lambda delay: cancel.set() or True):
                self.assertFalse(whisper.downloadFile("https://example.test/model.bin", target, cancel_event=cancel))
            self.assertEqual(get.call_count, 1)
            self.assertFalse(os.path.exists(target + ".part"))


if __name__ == "__main__":
    unittest.main()
