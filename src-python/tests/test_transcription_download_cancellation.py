import importlib
import os
import sys
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import controller as controller_module
from controller import Controller
from models.transcription import transcription_whisper


class _StreamingResponse:
    def __init__(self, cancel_event):
        self.headers = {"content-length": "4"}
        self._cancel_event = cancel_event

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def raise_for_status(self):
        return None

    def iter_content(self, chunk_size):
        del chunk_size
        yield b"ab"
        self._cancel_event.set()
        yield b"cd"


class TranscriptionDownloadCancellationTests(unittest.TestCase):
    def test_download_file_cancellation_removes_exact_target_and_partial_file(self):
        cancel_event = threading.Event()
        with tempfile.TemporaryDirectory() as temp_dir:
            target = os.path.join(temp_dir, "weights", "whisper", "tiny", "model.bin")
            sibling = os.path.join(temp_dir, "weights", "whisper", "base", "model.bin")
            os.makedirs(os.path.dirname(sibling), exist_ok=True)
            with open(sibling, "wb") as file:
                file.write(b"unrelated model")

            with patch.object(
                transcription_whisper,
                "requests_get",
                return_value=_StreamingResponse(cancel_event),
            ):
                result = transcription_whisper.downloadFile(
                    "https://example.test/model.bin",
                    target,
                    cancel_event=cancel_event,
                )

            self.assertIs(result, False)
            self.assertFalse(os.path.exists(target))
            self.assertFalse(os.path.exists(f"{target}.part"))
            self.assertTrue(os.path.isfile(sibling))

    def test_cancel_endpoint_sets_registered_event_and_unknown_weight_returns_false(self):
        controller = object.__new__(Controller)
        controller._download_cancellation_events = {}
        controller._download_cancellation_lock = threading.Lock()
        cancel_event = threading.Event()

        controller._registerDownloadCancellation("Whisper", "tiny", cancel_event)

        self.assertEqual(
            controller.cancelWhisperWeight("tiny"),
            {"status": 200, "result": True},
        )
        self.assertTrue(cancel_event.is_set())
        self.assertEqual(
            controller.cancelWhisperWeight("unknown"),
            {"status": 200, "result": False},
        )

    def test_cancelled_download_worker_is_removed_from_registry(self):
        controller = object.__new__(Controller)
        controller.run_mapping = {
            "download_progress_whisper_weight": "/run/download_progress_whisper_weight",
            "downloaded_whisper_weight": "/run/downloaded_whisper_weight",
            "download_cancelled_whisper_weight": "/run/download_cancelled_whisper_weight",
            "error_whisper_weight": "/run/error_whisper_weight",
        }
        controller.run = Mock()
        controller._download_cancellation_events = {}
        controller._download_cancellation_lock = threading.Lock()
        worker_started = threading.Event()
        worker_release = threading.Event()
        worker_finished = threading.Event()

        def blocked_download(weight_type, callback, end_callback, cancel_event=None):
            self.assertEqual(weight_type, "tiny")
            self.assertIsNotNone(cancel_event)
            worker_started.set()
            self.assertTrue(worker_release.wait(2.0))
            self.assertTrue(cancel_event.is_set())
            del callback, end_callback
            worker_finished.set()
            return False

        with patch.object(
            controller_module.model,
            "downloadWhisperModelWeight",
            side_effect=blocked_download,
        ):
            response = controller.downloadWhisperWeight("tiny", asynchronous=True)
            self.assertEqual(response, {"status": 200, "result": True})
            self.assertTrue(worker_started.wait(2.0))
            self.assertEqual(
                controller.cancelWhisperWeight("tiny"),
                {"status": 200, "result": True},
            )
            worker_release.set()
            self.assertTrue(worker_finished.wait(2.0))

        self.assertEqual(
            controller.cancelWhisperWeight("tiny"),
            {"status": 200, "result": False},
        )

    def test_cancelled_whisper_callback_emits_cancelled_route_without_installing(self):
        events = []
        cancel_event = threading.Event()
        cancel_event.set()
        callback = Controller.DownloadWhisper(
            {
                "downloaded_whisper_weight": "/run/downloaded_whisper_weight",
                "download_cancelled_whisper_weight": "/run/download_cancelled_whisper_weight",
                "error_whisper_weight": "/run/error_whisper_weight",
            },
            "tiny",
            lambda status, endpoint, payload: events.append((status, endpoint, payload)),
            cancel_event,
        )

        with patch.object(
            controller_module.model,
            "checkTranscriptionWhisperModelWeight",
            return_value=True,
        ) as check_weight:
            callback.downloaded()

        check_weight.assert_not_called()
        self.assertEqual(
            events,
            [(200, "/run/download_cancelled_whisper_weight", "tiny")],
        )

    def test_mainloop_exposes_cancel_and_cancelled_routes_for_all_transcription_families(self):
        mainloop = importlib.import_module("mainloop")
        families = (
            "whisper",
            "whisper_thai",
            "vosk",
            "parakeet",
            "sensevoice",
        )

        for family in families:
            with self.subTest(family=family):
                cancel_endpoint = f"/run/cancel_{family}_weight"
                cancelled_key = f"download_cancelled_{family}_weight"
                self.assertIn(cancel_endpoint, mainloop.mapping)
                self.assertTrue(mainloop.mapping[cancel_endpoint]["status"])
                self.assertEqual(
                    mainloop.run_mapping[cancelled_key],
                    f"/run/{cancelled_key}",
                )


if __name__ == "__main__":
    unittest.main()
