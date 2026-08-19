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
from models.transcription import (
    transcription_parakeet,
    transcription_sensevoice,
    transcription_vosk,
    transcription_whisper,
    transcription_whisper_thai,
)


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


class _VoskStreamingResponse:
    def __init__(self, cancel_event):
        self.headers = {"content-length": "4"}
        self._cancel_event = cancel_event

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

    def test_download_file_cancel_before_request_preserves_preexisting_target(self):
        cancel_event = threading.Event()
        cancel_event.set()
        with tempfile.TemporaryDirectory() as temp_dir:
            target = os.path.join(temp_dir, "weights", "whisper", "tiny", "model.bin")
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, "wb") as file:
                file.write(b"completed model")

            with patch.object(transcription_whisper, "requests_get") as requests_get:
                result = transcription_whisper.downloadFile(
                    "https://example.test/model.bin",
                    target,
                    cancel_event=cancel_event,
                )

            self.assertIs(result, False)
            self.assertTrue(os.path.isfile(target))
            with open(target, "rb") as file:
                self.assertEqual(file.read(), b"completed model")
            self.assertFalse(os.path.exists(f"{target}.part"))
            requests_get.assert_not_called()

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

    def test_cancelled_callbacks_emit_cancelled_route_for_all_families(self):
        families = (
            (
                "whisper",
                Controller.DownloadWhisper,
                "checkTranscriptionWhisperModelWeight",
                "SELECTABLE_WHISPER_WEIGHT_TYPE_DICT",
            ),
            (
                "whisper_thai",
                Controller.DownloadWhisperThai,
                "checkTranscriptionWhisperThaiModelWeight",
                "SELECTABLE_WHISPER_THAI_WEIGHT_TYPE_DICT",
            ),
            (
                "vosk",
                Controller.DownloadVosk,
                "checkTranscriptionVoskModelWeight",
                "SELECTABLE_VOSK_WEIGHT_TYPE_DICT",
            ),
            (
                "parakeet",
                Controller.DownloadParakeet,
                "checkTranscriptionParakeetModelWeight",
                "SELECTABLE_PARAKEET_WEIGHT_TYPE_DICT",
            ),
            (
                "sensevoice",
                Controller.DownloadSenseVoice,
                "checkTranscriptionSenseVoiceModelWeight",
                "SELECTABLE_SENSEVOICE_WEIGHT_TYPE_DICT",
            ),
        )

        for family, callback_type, check_name, selectable_name in families:
            with self.subTest(family=family):
                weight_type = f"round1-{family}"
                cancel_event = threading.Event()
                cancel_event.set()
                events = []
                run_mapping = {
                    f"downloaded_{family}_weight": f"/run/downloaded_{family}_weight",
                    f"download_cancelled_{family}_weight": f"/run/download_cancelled_{family}_weight",
                    f"error_{family}_weight": f"/run/error_{family}_weight",
                }
                callback = callback_type(
                    run_mapping,
                    weight_type,
                    lambda status, endpoint, payload: events.append(
                        (status, endpoint, payload)
                    ),
                    cancel_event,
                    cancellation_lock=threading.Lock(),
                )

                with patch.object(
                    controller_module.model,
                    check_name,
                    return_value=True,
                ) as check_weight, patch.dict(
                    getattr(controller_module.config, selectable_name),
                    {weight_type: False},
                    clear=False,
                ):
                    callback.downloaded()
                    installed_value = getattr(controller_module.config, selectable_name)[weight_type]

                check_weight.assert_not_called()
                self.assertEqual(
                    events,
                    [
                        (
                            200,
                            f"/run/download_cancelled_{family}_weight",
                            weight_type,
                        )
                    ],
                )
                self.assertFalse(installed_value)

    def test_downloaded_callback_and_cancel_endpoint_settle_atomically(self):
        controller = object.__new__(Controller)
        controller._download_cancellation_events = {}
        controller._download_cancellation_lock = threading.Lock()
        cancel_event = threading.Event()
        controller._registerDownloadCancellation("Whisper", "tiny", cancel_event)

        route_entered = threading.Event()
        route_release = threading.Event()
        cancel_started = threading.Event()
        cancel_finished = threading.Event()
        cancel_result = []
        cancel_thread = []
        events = []

        def request_cancel():
            cancel_started.set()
            cancel_result.append(controller.cancelWhisperWeight("tiny"))
            cancel_finished.set()

        def run(status, endpoint, payload):
            events.append((status, endpoint, payload))
            if endpoint == "/run/downloaded_whisper_weight":
                route_entered.set()
                thread = threading.Thread(target=request_cancel)
                cancel_thread.append(thread)
                thread.start()
                self.assertTrue(cancel_started.wait(2.0))
                self.assertFalse(cancel_finished.wait(0.2))
                self.assertTrue(route_release.wait(2.0))

        callback = Controller.DownloadWhisper(
            {
                "downloaded_whisper_weight": "/run/downloaded_whisper_weight",
                "download_cancelled_whisper_weight": "/run/download_cancelled_whisper_weight",
                "error_whisper_weight": "/run/error_whisper_weight",
            },
            "tiny",
            run,
            cancel_event,
            cancellation_lock=controller._download_cancellation_lock,
        )

        with patch.dict(
            controller_module.config.SELECTABLE_WHISPER_WEIGHT_TYPE_DICT,
            {"tiny": False},
            clear=False,
        ), patch.object(
            controller_module.model,
            "checkTranscriptionWhisperModelWeight",
            return_value=True,
        ):
            callback_thread = threading.Thread(target=callback.downloaded)
            callback_thread.start()
            self.assertTrue(route_entered.wait(2.0))
            self.assertTrue(cancel_started.wait(2.0))
            self.assertFalse(cancel_finished.is_set())
            route_release.set()
            callback_thread.join(2.0)
            installed_value = controller_module.config.SELECTABLE_WHISPER_WEIGHT_TYPE_DICT["tiny"]

        for thread in cancel_thread:
            thread.join(2.0)
        self.assertFalse(callback_thread.is_alive())
        self.assertFalse(any("cancelled" in endpoint for _, endpoint, _ in events))
        self.assertEqual(events, [(200, "/run/downloaded_whisper_weight", "tiny")])
        self.assertTrue(installed_value)
        self.assertEqual(
            cancel_result,
            [{"status": 200, "result": True}],
        )

    def test_family_cancellation_cleans_only_selected_incomplete_artifacts(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            cases = (
                (
                    "whisper_thai",
                    "thai-thonburian-medium",
                    os.path.join(temp_dir, "weights", "whisper", "thai-thonburian-medium"),
                    os.path.join(temp_dir, "weights", "whisper", "unrelated"),
                ),
                (
                    "vosk",
                    "small-en",
                    os.path.join(temp_dir, "weights", "vosk", "small-en"),
                    os.path.join(temp_dir, "weights", "vosk", "small-ja"),
                ),
                (
                    "parakeet",
                    "parakeet-tdt-0.6b-v3",
                    os.path.join(temp_dir, "weights", "parakeet", "parakeet-tdt-0.6b-v3"),
                    os.path.join(temp_dir, "weights", "parakeet", "unrelated"),
                ),
                (
                    "sensevoice",
                    "sensevoice-small-int8",
                    os.path.join(temp_dir, "weights", "sensevoice", "sensevoice-small-int8"),
                    os.path.join(temp_dir, "weights", "sensevoice", "unrelated"),
                ),
            )

            for family, weight_type, selected_path, sibling_path in cases:
                with self.subTest(family=family):
                    os.makedirs(sibling_path, exist_ok=True)
                    sibling_file = os.path.join(sibling_path, "keep.bin")
                    with open(sibling_file, "wb") as file:
                        file.write(b"unrelated model")
                    cancel_event = threading.Event()

                    if family == "whisper_thai":
                        def fake_download(url, path, func=None, cancel_event=None):
                            del url, func
                            os.makedirs(os.path.dirname(path), exist_ok=True)
                            with open(path, "wb") as file:
                                file.write(b"partial")
                            cancel_event.set()
                            return False

                        with patch.object(
                            transcription_whisper_thai,
                            "list_repo_files",
                            return_value=[
                                "config.json",
                                "model.bin",
                                "preprocessor_config.json",
                                "tokenizer.json",
                                "vocabulary.json",
                            ],
                        ), patch.object(
                            transcription_whisper_thai,
                            "hf_hub_url",
                            return_value="https://example.test/file",
                        ), patch.object(
                            transcription_whisper_thai,
                            "downloadFile",
                            side_effect=fake_download,
                        ):
                            transcription_whisper_thai.downloadWhisperThaiWeight(
                                temp_dir,
                                weight_type,
                                cancel_event=cancel_event,
                            )
                    elif family == "vosk":
                        with patch.object(
                            transcription_vosk,
                            "requests_get",
                            return_value=_VoskStreamingResponse(cancel_event),
                        ):
                            transcription_vosk.downloadVoskWeight(
                                temp_dir,
                                weight_type,
                                cancel_event=cancel_event,
                            )
                    elif family == "parakeet":
                        def fake_parakeet_snapshot(repo_id, local_dir, allow_patterns, local_dir_use_symlinks=False):
                            del repo_id, allow_patterns, local_dir_use_symlinks
                            os.makedirs(local_dir, exist_ok=True)
                            with open(os.path.join(local_dir, "config.json"), "wb") as file:
                                file.write(b"partial")
                            cancel_event.set()

                        with patch.object(transcription_parakeet, "_ONNX_ASR_AVAILABLE", True), patch.object(
                            transcription_parakeet, "_HF_AVAILABLE", True
                        ), patch.object(
                            transcription_parakeet.huggingface_hub,
                            "snapshot_download",
                            side_effect=fake_parakeet_snapshot,
                        ):
                            transcription_parakeet.downloadParakeetWeight(
                                temp_dir,
                                weight_type,
                                cancel_event=cancel_event,
                            )
                    else:
                        def fake_sensevoice_snapshot(repo_id, local_dir, allow_patterns, local_dir_use_symlinks=False):
                            del repo_id, allow_patterns, local_dir_use_symlinks
                            os.makedirs(local_dir, exist_ok=True)
                            with open(os.path.join(local_dir, "model.int8.onnx"), "wb") as file:
                                file.write(b"partial")
                            cancel_event.set()

                        with patch.object(transcription_sensevoice, "_HF_AVAILABLE", True), patch.object(
                            transcription_sensevoice.huggingface_hub,
                            "snapshot_download",
                            side_effect=fake_sensevoice_snapshot,
                        ):
                            transcription_sensevoice.downloadSenseVoiceWeight(
                                temp_dir,
                                weight_type,
                                cancel_event=cancel_event,
                            )

                    self.assertFalse(os.path.exists(selected_path))
                    self.assertFalse(os.path.exists(os.path.join(selected_path, "downloaded.json")))
                    self.assertTrue(os.path.isfile(sibling_file))

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
