import os
import sys
import threading
import time
import unittest
from datetime import datetime, timezone


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from models.transcription.bing_protocol import (  # noqa: E402
    BING_ENDPOINT,
    BING_SEC_MS_GEC_VERSION,
    BING_TRUSTED_CLIENT_TOKEN,
    build_binary_message,
    build_text_message,
    build_websocket_url,
    create_wav_header,
    generate_sec_ms_gec,
    parse_server_message,
    parse_server_recognition_event,
)
from models.transcription import transcription_bing  # noqa: E402
from models.transcription import transcription_recorder  # noqa: E402
from models.transcription.transcription_bing import BingSTTClient  # noqa: E402
from models.transcription.transcription_engine_capabilities import (  # noqa: E402
    get_transcription_engine_capability,
    is_cloud_transcription_engine,
)
from models.transcription.transcription_profile import (  # noqa: E402
    MODEL_ENGINES,
    TRANSCRIPTION_ENGINES,
)
from models.transcription.transcription_language_policy import (  # noqa: E402
    runtime_language_slots,
    transcription_language_capabilities,
)
from models.transcription.transcription_languages import transcription_lang  # noqa: E402


class BingProtocolTests(unittest.TestCase):
    def test_bing_is_cloud_but_not_a_downloadable_model_engine(self):
        self.assertIn("Bing", TRANSCRIPTION_ENGINES)
        self.assertNotIn("Bing", MODEL_ENGINES)
        self.assertTrue(is_cloud_transcription_engine("Bing"))
        self.assertEqual(
            {
                "type": "cloud",
                "provider": "microsoft-bing",
                "max_languages": 1,
                "microphone_max": 1,
                "received_max": 1,
                "parallel_candidates": False,
                "icon": "bing",
            },
            get_transcription_engine_capability("Bing"),
        )

    def test_cloud_and_local_language_limits_are_directional(self):
        slots = {
            "1": {"language": "Thai", "country": "Thailand", "enable": True},
            "2": {"language": "English", "country": "United States", "enable": True},
            "3": {"language": "Japanese", "country": "Japan", "enable": True},
        }

        self.assertEqual((slots["1"],), runtime_language_slots("Google", slots, "microphone"))
        self.assertEqual((slots["1"],), runtime_language_slots("Bing", slots, "received"))
        self.assertEqual(
            (slots["1"], slots["2"], slots["3"]),
            runtime_language_slots("Whisper", slots, "microphone"),
        )
        self.assertEqual(
            (slots["1"], slots["2"], slots["3"]),
            runtime_language_slots("Parakeet", slots, "received"),
        )
        self.assertEqual(3, transcription_language_capabilities()["Parakeet"]["max_languages"])
        self.assertEqual(1, transcription_language_capabilities()["Bing"]["max_languages"])
        self.assertEqual(1, transcription_language_capabilities()["Whisper Cloud"]["max_languages"])

    def test_cloud_switch_preserves_saved_extras_for_local_restore(self):
        saved = {
            "1": {"language": "Thai", "country": "Thailand", "enable": True},
            "2": {"language": "English", "country": "United States", "enable": True},
            "3": {"language": "Japanese", "country": "Japan", "enable": True},
        }

        cloud_active = runtime_language_slots("Bing", saved, "microphone")
        local_restored = runtime_language_slots("Whisper", saved, "microphone")

        self.assertEqual((saved["1"],), cloud_active)
        self.assertEqual(
            (saved["1"], saved["2"], saved["3"]),
            local_restored,
        )
        self.assertEqual(True, saved["2"]["enable"])
        self.assertEqual(True, saved["3"]["enable"])

    def test_speaking_and_listening_bing_limits_are_independent(self):
        speaking_slots = {
            "1": {"language": "Thai", "country": "Thailand", "enable": True},
            "2": {"language": "English", "country": "United States", "enable": True},
            "3": {"language": "Japanese", "country": "Japan", "enable": False},
        }
        listening_slots = {
            "1": {"language": "Japanese", "country": "Japan", "enable": True},
            "2": {"language": "Korean", "country": "South Korea", "enable": True},
            "3": {"language": "Thai", "country": "Thailand", "enable": False},
        }

        self.assertEqual(
            (speaking_slots["1"],),
            runtime_language_slots("Bing", speaking_slots, "microphone"),
        )
        self.assertEqual(
            (listening_slots["1"],),
            runtime_language_slots("Bing", listening_slots, "received"),
        )

    def test_bing_locale_table_uses_microsoft_stt_locales_and_keeps_unsupported_variants_empty(self):
        expected = {
            ("Thai", "Thailand"): "th-TH",
            ("Japanese", "Japan"): "ja-JP",
            ("Hebrew", "Israel"): "he-IL",
            ("Norwegian", "Norway"): "nb-NO",
            ("Chinese Simplified", "China"): "zh-CN",
            ("Chinese Traditional", "Taiwan"): "zh-TW",
            ("Chinese Traditional", "Hong Kong"): "zh-HK",
        }
        for (language, country), locale in expected.items():
            with self.subTest(language=language, country=country):
                self.assertEqual(locale, transcription_lang[language][country]["Bing"])

        unsupported = (
            ("Arabic", "Mauritania"),
            ("Bengali", "Bangladesh"),
            ("Chinese Simplified", "Hong Kong"),
            ("Sundanese", "Indonesia"),
            ("Swahili", "Tanzania"),
            ("Tamil", "malaysia"),
            ("Tamil", "Singapore"),
            ("Tamil", "Sri Lanka"),
            ("Urdu", "Pakistan"),
        )
        for language, country in unsupported:
            with self.subTest(language=language, country=country):
                self.assertEqual("", transcription_lang[language][country]["Bing"])

    def test_protocol_generates_sec_ms_gec_and_safe_locale_url(self):
        now = datetime(2026, 8, 22, 0, 0, 0, tzinfo=timezone.utc)
        gec = generate_sec_ms_gec(now)
        self.assertEqual(64, len(gec))
        self.assertEqual(gec.upper(), gec)

        url = build_websocket_url("th-TH", gec)
        self.assertTrue(url.startswith(BING_ENDPOINT + "?"))
        self.assertIn(f"TrustedClientToken={BING_TRUSTED_CLIENT_TOKEN}", url)
        self.assertIn(f"Sec-MS-GEC-Version={BING_SEC_MS_GEC_VERSION}", url)
        self.assertIn("language=th-TH", url)

    def test_text_and_binary_messages_round_trip_protocol_headers(self):
        text_message = build_text_message(
            "speech.phrase",
            {"DisplayText": "สวัสดี"},
            request_id="request-1",
            content_type="application/json",
            timestamp="2026-08-22T00:00:00Z",
        )
        parsed_text = parse_server_message(text_message)
        self.assertEqual("speech.phrase", parsed_text.path)
        self.assertEqual("request-1", parsed_text.headers["x-requestid"])
        self.assertEqual({"DisplayText": "สวัสดี"}, parsed_text.json)

        binary_message = build_binary_message(
            "audio",
            b"\x01\x02\x03\x04",
            request_id="request-1",
            stream_id="1",
            timestamp="2026-08-22T00:00:00Z",
        )
        parsed_binary = parse_server_message(binary_message)
        self.assertEqual("audio", parsed_binary.path)
        self.assertEqual("1", parsed_binary.headers["x-streamid"])
        self.assertEqual(b"\x01\x02\x03\x04", parsed_binary.body_bytes)

    def test_hypothesis_and_phrase_are_distinct_result_events(self):
        hypothesis = parse_server_recognition_event(
            build_text_message("speech.hypothesis", {"Text": "hel"})
        )
        phrase = parse_server_recognition_event(
            build_text_message("speech.phrase", {"DisplayText": "hello"})
        )
        self.assertEqual(("hypothesis", "hel"), (hypothesis.kind, hypothesis.text))
        self.assertEqual(("phrase", "hello"), (phrase.kind, phrase.text))


class _FakeConnection:
    def __init__(self, opened_event):
        self.opened_event = opened_event
        self.closed = False
        self.sent = []

    def __enter__(self):
        self.opened_event.set()
        return self

    def __exit__(self, *_args):
        self.close()

    def send(self, message):
        self.sent.append(message)

    def recv(self, timeout=None):
        if self.closed:
            raise ConnectionError("closed")
        time.sleep(min(timeout or 0.01, 0.01))
        raise TimeoutError()

    def close(self):
        self.closed = True


class BingClientLifecycleTests(unittest.TestCase):
    def test_audio_is_sent_after_connection_and_turn_end_continues_same_socket(self):
        opened = threading.Event()
        connections = []

        def connect_factory(*_args, **_kwargs):
            connection = _FakeConnection(opened)
            connections.append(connection)
            return connection

        client = BingSTTClient(
            "th-TH",
            connect_factory=connect_factory,
            reconnect_delay=0.01,
            receive_timeout=0.01,
        )
        client.start()
        self.assertTrue(opened.wait(1.0))
        connection = connections[0]
        initial_count = len(connection.sent)
        self.assertTrue(client.send_audio(b"\x01\x00" * 160))

        deadline = time.monotonic() + 1.0
        while len(connection.sent) <= initial_count and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertGreater(len(connection.sent), initial_count)
        self.assertEqual("audio", parse_server_message(connection.sent[-1]).path)

        before_turn_end = len(connection.sent)
        client._handle_message(
            build_text_message("turn.end", {}),
            client._generation,
            connection,
        )
        self.assertEqual(1, len(connections))
        self.assertGreaterEqual(len(connection.sent), before_turn_end + 2)
        client.stop()

    def test_stop_disposes_websocket_and_does_not_leave_worker_or_capture_loop(self):
        opened = threading.Event()
        connections = []

        def connect_factory(*_args, **_kwargs):
            connection = _FakeConnection(opened)
            connections.append(connection)
            return connection

        client = BingSTTClient(
            "th-TH",
            connect_factory=connect_factory,
            reconnect_delay=0.01,
            receive_timeout=0.01,
        )
        client.start()
        self.assertTrue(opened.wait(1.0))
        client.send_audio(b"\x00\x00")
        client.stop()

        self.assertFalse(client.is_running)
        self.assertIsNone(client.worker_thread)
        self.assertTrue(connections[0].closed)
        self.assertEqual(1, len(connections))

    def test_reconnect_reuses_one_worker_without_starting_a_capture_loop(self):
        first_opened = threading.Event()
        reconnected = threading.Event()
        connections = []

        class DroppingConnection(_FakeConnection):
            def recv(self, timeout=None):
                if self.closed:
                    raise ConnectionError("closed")
                time.sleep(min(timeout or 0.01, 0.01))
                raise ConnectionError("dropped")

        def connect_factory(*_args, **_kwargs):
            connection = DroppingConnection(first_opened)
            connections.append(connection)
            if len(connections) >= 2:
                reconnected.set()
            return connection

        client = BingSTTClient(
            "th-TH",
            connect_factory=connect_factory,
            reconnect_delay=0.01,
            receive_timeout=0.01,
        )
        client.start()
        self.assertTrue(first_opened.wait(1.0))
        worker = client.worker_thread
        self.assertIsNotNone(worker)
        self.assertTrue(reconnected.wait(1.0))
        self.assertIs(worker, client.worker_thread)
        self.assertEqual(1, len([thread for thread in threading.enumerate() if thread is worker]))
        client.stop()

        self.assertFalse(client.is_running)
        self.assertTrue(all(connection.closed for connection in connections))


class _ManualCapture:
    def __init__(self):
        self.start_count = 0
        self.stop_count = 0
        self._on_audio = None
        self._on_voice_activity = None
        self._on_heartbeat = None

    def start(
        self,
        on_audio,
        *,
        on_voice_activity=None,
        on_heartbeat=None,
        on_error=None,
    ):
        del on_error
        self.start_count += 1
        self._on_audio = on_audio
        self._on_voice_activity = on_voice_activity
        self._on_heartbeat = on_heartbeat

    def emit_audio(self, payload):
        captured_at = time.perf_counter()
        if self._on_heartbeat is not None:
            self._on_heartbeat(captured_at)
        if self._on_audio is not None:
            self._on_audio(payload, captured_at)

    def emit_voice_activity(self, speaking):
        if self._on_voice_activity is not None:
            self._on_voice_activity(speaking, time.perf_counter())

    def stop(self):
        self.stop_count += 1

    close = stop

    def pause(self):
        pass

    def resume(self):
        pass


class _FakeSessionClient:
    def __init__(self, locale, on_hypothesis, on_phrase, on_error):
        self.locale = locale
        self.on_hypothesis = on_hypothesis
        self.on_phrase = on_phrase
        self.on_error = on_error
        self.is_running = False
        self.start_count = 0
        self.close_count = 0
        self.sent = []

    def start(self):
        self.start_count += 1
        self.is_running = True

    def send_audio(self, payload, *, captured_at_monotonic=None):
        self.sent.append((payload, captured_at_monotonic))
        return self.is_running

    def close(self):
        self.close_count += 1
        self.is_running = False

    def emit_hypothesis(self, text):
        self.on_hypothesis(text)

    def emit_phrase(self, text):
        self.on_phrase(text)


class _FiniteStream:
    def __init__(self, frames):
        self.frames = list(frames)

    def read(self, _size):
        if self.frames:
            return self.frames.pop(0)
        return b""


class _FiniteAudioSource:
    SAMPLE_RATE = 16_000
    SAMPLE_WIDTH = 2
    CHUNK = 160
    channels = 1

    def __init__(self, frames):
        self.frames = frames
        self.stream = None

    def __enter__(self):
        self.stream = _FiniteStream(self.frames)
        return self

    def __exit__(self, *_args):
        self.stream = None


class BingStreamingSessionTests(unittest.TestCase):
    def _make_session(self):
        clients = []

        def client_factory(locale, on_hypothesis, on_phrase, on_error):
            client = _FakeSessionClient(
                locale,
                on_hypothesis,
                on_phrase,
                on_error,
            )
            clients.append(client)
            return client

        capture = _ManualCapture()
        hypotheses = []
        phrases = []
        session_type = getattr(transcription_bing, "BingStreamingSession", None)
        self.assertIsNotNone(session_type)
        session = session_type(
            "th-TH",
            capture,
            client_factory=client_factory,
            on_hypothesis=hypotheses.append,
            on_phrase=phrases.append,
        )
        return session, capture, clients, hypotheses, phrases

    def test_capture_chunks_are_sent_immediately_without_phrase_buffering(self):
        session, capture, clients, _hypotheses, _phrases = self._make_session()

        session.start()
        capture.emit_audio(b"chunk-1")
        capture.emit_audio(b"chunk-2")
        capture.emit_audio(b"chunk-3")

        self.assertEqual(1, len(clients))
        self.assertEqual(
            [b"chunk-1", b"chunk-2", b"chunk-3"],
            [payload for payload, _timestamp in clients[0].sent],
        )
        self.assertEqual(1, capture.start_count)
        session.close()

    def test_hypothesis_and_phrase_callbacks_are_immediate_and_stale_clients_are_ignored(self):
        session, capture, clients, hypotheses, phrases = self._make_session()

        session.start()
        clients[0].emit_hypothesis("สวัส")
        clients[0].emit_phrase("สวัสดี")
        self.assertEqual(["สวัส"], hypotheses)
        self.assertEqual(["สวัสดี"], phrases)

        session.ensure_locale("ja-JP")
        self.assertEqual(2, len(clients))
        clients[0].emit_hypothesis("stale")
        clients[1].emit_hypothesis("こんにちは")
        self.assertEqual(["สวัส", "こんにちは"], hypotheses)
        self.assertEqual(1, capture.start_count)
        self.assertEqual(1, clients[0].close_count)
        session.close()

    def test_stop_disposes_capture_and_socket_without_duplicate_capture_start(self):
        session, capture, clients, _hypotheses, _phrases = self._make_session()

        session.start()
        session.start()
        self.assertEqual(1, capture.start_count)
        session.close()

        self.assertEqual(1, capture.stop_count)
        self.assertEqual(1, clients[0].close_count)

    def test_speaking_and_listening_sessions_have_independent_capture_and_clients(self):
        speaking, speaking_capture, speaking_clients, _, _ = self._make_session()
        listening, listening_capture, listening_clients, _, _ = self._make_session()

        speaking.start()
        listening.start()
        speaking_capture.emit_audio(b"speaking")
        listening_capture.emit_audio(b"listening")

        self.assertIsNot(speaking, listening)
        self.assertIsNot(speaking.client, listening.client)
        self.assertEqual([b"speaking"], [item[0] for item in speaking_clients[0].sent])
        self.assertEqual([b"listening"], [item[0] for item in listening_clients[0].sent])
        self.assertEqual(1, speaking_capture.start_count)
        self.assertEqual(1, listening_capture.start_count)
        speaking.close()
        listening.close()


class BingRealtimeRecorderTests(unittest.TestCase):
    def test_raw_capture_forwards_each_frame_without_waiting_for_phrase_completion(self):
        recorder_type = getattr(
            transcription_recorder,
            "BingRealtimeAudioRecorder",
            None,
        )
        self.assertIsNotNone(recorder_type)
        frames = [b"\x01\x00" * 160, b"\x02\x00" * 160, b"\x03\x00" * 160]
        source = _FiniteAudioSource(frames)
        received = []
        recorder = recorder_type(source)

        recorder.start(lambda payload, _captured_at: received.append(payload))
        worker = recorder.worker_thread
        self.assertIsNotNone(worker)
        worker.join(timeout=1.0)
        recorder.stop()

        self.assertEqual(frames, received)


class BingTranscriberIntegrationTests(unittest.TestCase):
    def test_generic_phrase_transcriber_rejects_bing_runtime(self):
        from models.transcription.transcription_transcriber import AudioTranscriber

        with self.assertRaisesRegex(ValueError, "BingStreamingSession"):
            AudioTranscriber(
                speaker=False,
                source=type(
                    "Source",
                    (),
                    {"SAMPLE_RATE": 16000, "SAMPLE_WIDTH": 2, "channels": 1},
                )(),
                phrase_timeout=3,
                max_phrases=10,
                transcription_engine="Bing",
            )


if __name__ == "__main__":
    unittest.main()
