"""Realtime Microsoft Bing consumer speech-to-text client.

The endpoint is an unofficial consumer protocol.  The client owns the
persistent WebSocket transport while BingStreamingSession connects it to
one direction's direct PCM capture lifecycle.
"""

from __future__ import annotations

import logging
import time
import uuid
from collections import deque
from queue import Empty, Full, Queue
from threading import Event, RLock, Thread, current_thread
from typing import Any, Callable, Optional

try:
    from websockets.sync.client import connect as _websocket_connect
except Exception:  # pragma: no cover - exercised only in incomplete installs
    _websocket_connect = None

from .bing_protocol import (
    BING_BITS_PER_SAMPLE,
    BING_CHANNELS,
    build_binary_message,
    build_text_message,
    build_websocket_url,
    create_wav_header,
    generate_sec_ms_gec,
    parse_server_recognition_event,
)


logger = logging.getLogger(__name__)


class BingSTTClient:
    """One lifecycle-owned Bing WebSocket stream.

    ``send_audio`` is intentionally synchronous and non-blocking so it can be
    called by VRCNT's transcription worker without creating another capture
    loop.  The client worker owns the socket and reconnects it when needed.
    """

    MAX_PENDING_AUDIO_CHUNKS = 64
    MAX_TURN_COUNT = 20

    def __init__(
        self,
        locale: str,
        *,
        sample_rate: int = 16_000,
        channels: int = BING_CHANNELS,
        bits_per_sample: int = BING_BITS_PER_SAMPLE,
        on_hypothesis: Optional[Callable[[str], None]] = None,
        on_phrase: Optional[Callable[[str], None]] = None,
        on_error: Optional[Callable[[str], None]] = None,
        on_timing: Optional[Callable[[str, float, dict], None]] = None,
        connect_factory: Optional[Callable[..., Any]] = None,
        reconnect_delay: float = 0.5,
        receive_timeout: float = 0.1,
    ) -> None:
        if not locale:
            raise ValueError("Bing STT requires a non-empty locale")
        self.locale = str(locale)
        self.sample_rate = int(sample_rate)
        self.channels = int(channels)
        self.bits_per_sample = int(bits_per_sample)
        self.on_hypothesis = on_hypothesis
        self.on_phrase = on_phrase
        self.on_error = on_error
        self.on_timing = on_timing
        self.connect_factory = connect_factory or _websocket_connect
        self.reconnect_delay = max(0.01, float(reconnect_delay))
        self.receive_timeout = max(0.01, float(receive_timeout))

        self._lock = RLock()
        self._stop_event = Event()
        self._worker_thread: Optional[Thread] = None
        self._connection: Any = None
        self._running = False
        self._generation = 0
        self._audio_queue: Queue[tuple[bytes, Optional[float]]] = Queue(
            self.MAX_PENDING_AUDIO_CHUNKS
        )
        self._request_id = ""
        self._stream_id = 1
        self._service_tag: Optional[str] = None
        self._bytes_sent = 0
        self._turn_count = 0
        self._finalized_keys: deque[tuple[str, str]] = deque(maxlen=64)
        self._error_keys: set[tuple[int, str]] = set()

    @property
    def is_running(self) -> bool:
        with self._lock:
            return self._running

    @property
    def worker_thread(self) -> Optional[Thread]:
        with self._lock:
            return self._worker_thread

    def start(self, locale: Optional[str] = None) -> None:
        if locale:
            self.locale = str(locale)
        self.stop()
        with self._lock:
            self._generation += 1
            generation = self._generation
            self._stop_event = Event()
            self._clear_audio_queue_locked()
            self._running = True
            worker = Thread(
                target=self._run,
                args=(generation, self.locale),
                name=f"bing-stt-{self.locale}",
                daemon=True,
            )
            self._worker_thread = worker
        worker.start()

    def ensure_locale(self, locale: str) -> None:
        locale = str(locale or "")
        if not locale:
            return
        if locale != self.locale:
            self.start(locale)
        elif not self.is_running:
            self.start()

    def send_audio(
        self,
        pcm_bytes: bytes,
        *,
        captured_at_monotonic: Optional[float] = None,
    ) -> bool:
        if not pcm_bytes or not self.is_running:
            return False
        payload = bytes(pcm_bytes)
        queued = (payload, captured_at_monotonic)
        try:
            self._audio_queue.put_nowait(queued)
            self._emit_timing(
                "audio_queued",
                captured_at_monotonic,
                queued_bytes=len(payload),
            )
            return True
        except Full:
            try:
                self._audio_queue.get_nowait()
            except Empty:
                pass
            try:
                self._audio_queue.put_nowait(queued)
                self._emit_timing(
                    "audio_queued",
                    captured_at_monotonic,
                    queued_bytes=len(payload),
                    queue_replaced=True,
                )
                return True
            except Full:
                return False

    def stop(self) -> None:
        with self._lock:
            worker = self._worker_thread
            self._generation += 1
            self._running = False
            self._stop_event.set()
            connection = self._connection
            self._connection = None
            self._clear_audio_queue_locked()
        if connection is not None:
            try:
                connection.close()
            except Exception:
                logger.debug("Bing STT connection close failed", exc_info=True)
        if worker is not None and worker is not current_thread():
            worker.join(timeout=2.0)
            if worker.is_alive() and connection is not None:
                try:
                    connection.close()
                except Exception:
                    pass
            # A connection attempt can still be in progress when
            # ``_connection`` is None.  Wait for that generation to exit
            # before allowing ``start`` to create another worker.
            if worker.is_alive():
                worker.join()
        with self._lock:
            if self._worker_thread is worker and worker is not None and not worker.is_alive():
                self._worker_thread = None

    def close(self) -> None:
        self.stop()

    def _is_current(self, generation: int) -> bool:
        with self._lock:
            return self._running and generation == self._generation

    def _clear_audio_queue_locked(self) -> None:
        while True:
            try:
                self._audio_queue.get_nowait()
            except Empty:
                return

    def _clear_audio_queue(self) -> None:
        with self._lock:
            self._clear_audio_queue_locked()

    def _run(self, generation: int, locale: str) -> None:
        connected_once = False
        while self._is_current(generation):
            connection = None
            try:
                if self.connect_factory is None:
                    raise RuntimeError("websockets is not installed")
                sec_ms_gec = generate_sec_ms_gec()
                url = build_websocket_url(locale, sec_ms_gec)
                logger.info("Bing STT connecting with locale %s", locale)
                connection = self.connect_factory(
                    url,
                    origin="https://www.bing.com",
                    open_timeout=10,
                    ping_interval=20,
                    ping_timeout=20,
                )
                with connection:
                    if not self._is_current(generation):
                        return
                    with self._lock:
                        self._connection = connection
                    self._send_initial_messages(connection)
                    connected_once = True
                    while self._is_current(generation):
                        self._drain_audio(connection, generation)
                        try:
                            incoming = connection.recv(timeout=self.receive_timeout)
                        except TimeoutError:
                            continue
                        self._handle_message(incoming, generation, connection)
            except Exception as error:
                if not self._is_current(generation):
                    return
                self._notify_error(
                    generation,
                    "bing_connection_closed" if connected_once else "bing_connection_failed",
                )
                self._clear_audio_queue()
                if self._stop_event.wait(self.reconnect_delay):
                    return
            finally:
                with self._lock:
                    if self._connection is connection:
                        self._connection = None
                if connection is not None:
                    try:
                        connection.close()
                    except Exception:
                        pass

    def _send_initial_messages(self, connection: Any) -> None:
        self._request_id = uuid.uuid4().hex
        self._stream_id = 1
        self._service_tag = None
        self._bytes_sent = 0
        self._turn_count = 0
        self._finalized_keys.clear()
        connection.send(
            build_text_message(
                "speech.config",
                {
                    "context": {
                        "audio": {
                            "source": {
                                "bitspersample": str(self.bits_per_sample),
                                "channelcount": str(self.channels),
                                "model": "",
                                "samplerate": str(self.sample_rate),
                                "type": "Stream",
                            },
                        },
                        "os": {"name": "Client", "platform": "Windows", "version": "10"},
                        "system": {"build": "Windows-x64", "name": "SpeechSDK", "version": "1.15.0"},
                    },
                },
                content_type="application/json",
            )
        )
        connection.send(
            build_text_message(
                "speech.context",
                {"audio": {"streams": {"1": None}}},
                request_id=self._request_id,
            )
        )
        self._send_wav_header(connection)

    def _send_wav_header(self, connection: Any) -> None:
        connection.send(
            build_binary_message(
                "audio",
                create_wav_header(
                    self.sample_rate,
                    self.channels,
                    self.bits_per_sample,
                ),
                request_id=self._request_id,
                stream_id=str(self._stream_id),
                content_type="audio/x-wav",
            )
        )

    def _drain_audio(self, connection: Any, generation: int) -> None:
        for _ in range(16):
            if not self._is_current(generation):
                return
            try:
                queued = self._audio_queue.get_nowait()
            except Empty:
                return
            if isinstance(queued, tuple):
                payload, captured_at_monotonic = queued
            else:  # pragma: no cover - compatibility with an older queue entry
                payload, captured_at_monotonic = queued, None
            sent_at = time.perf_counter()
            connection.send(
                build_binary_message(
                    "audio",
                    payload,
                    request_id=self._request_id,
                    stream_id=str(self._stream_id),
                )
            )
            self._bytes_sent += len(payload)
            details = {"sent_bytes": len(payload)}
            if captured_at_monotonic is not None:
                details["capture_to_socket_ms"] = max(
                    0,
                    round((sent_at - captured_at_monotonic) * 1000),
                )
            self._emit_timing("audio_sent", sent_at, **details)

    def _handle_message(self, incoming: Any, generation: int, connection: Any) -> None:
        if not self._is_current(generation):
            return
        event = parse_server_recognition_event(incoming)
        if event is None:
            return
        self._emit_timing(
            f"{event.kind}_received",
            time.perf_counter(),
            request_id=event.request_id or self._request_id,
        )
        if event.kind == "turn_start":
            self._service_tag = event.service_tag
            return
        if event.kind == "hypothesis":
            if event.text:
                self._invoke_callback(self.on_hypothesis, event.text)
            return
        if event.kind == "phrase":
            if not event.text:
                return
            key = (event.request_id or self._request_id, event.text)
            if key in self._finalized_keys:
                return
            self._finalized_keys.append(key)
            self._invoke_callback(self.on_phrase, event.text)
            return
        if event.kind == "turn_end":
            self._turn_count += 1
            if self._turn_count >= self.MAX_TURN_COUNT:
                # Closing lets the outer loop reinitialize with fresh IDs.
                connection.close()
                return
            self._send_continuation(connection)

    def _send_continuation(self, connection: Any) -> None:
        self._stream_id += 1
        self._request_id = uuid.uuid4().hex
        bytes_per_second = self.sample_rate * self.channels * (self.bits_per_sample / 8)
        offset_100ns = int((self._bytes_sent / bytes_per_second) * 10_000_000)
        connection.send(
            build_text_message(
                "speech.context",
                {
                    "audio": {"streams": {"1": None}},
                    "continuation": {
                        "audio": {"streams": {"1": {"offset": str(offset_100ns)}}},
                        "previousServiceTag": self._service_tag,
                    },
                },
                request_id=self._request_id,
                content_type="application/json",
            )
        )
        self._send_wav_header(connection)

    def _notify_error(self, generation: int, error_code: str) -> None:
        key = (generation, error_code)
        if key in self._error_keys:
            return
        self._error_keys.add(key)
        self._emit_timing("error", time.perf_counter(), error_code=error_code)
        self._invoke_callback(self.on_error, error_code)

    def _emit_timing(
        self,
        stage: str,
        observed_at: Optional[float] = None,
        **details: Any,
    ) -> None:
        timestamp = time.perf_counter() if observed_at is None else observed_at
        callback = self.on_timing
        if not callable(callback):
            return
        try:
            callback(str(stage), timestamp, details)
        except Exception:
            logger.debug("Bing STT timing callback failed", exc_info=True)

    @staticmethod
    def _invoke_callback(callback: Optional[Callable], *args: Any) -> None:
        if not callable(callback):
            return
        try:
            callback(*args)
        except Exception:
            logger.exception("Bing STT callback failed")


class BingStreamingSession:
    """Own one direction's realtime Bing socket and direct audio capture."""

    def __init__(
        self,
        locale: str,
        recorder: Any,
        *,
        on_hypothesis: Optional[Callable[[str], None]] = None,
        on_phrase: Optional[Callable[[str], None]] = None,
        on_error: Optional[Callable[[str], None]] = None,
        on_voice_activity: Optional[Callable[[bool, float], None]] = None,
        on_heartbeat: Optional[Callable[[float], None]] = None,
        on_timing: Optional[Callable[[str, float, dict], None]] = None,
        client_factory: Optional[Callable[..., Any]] = None,
    ) -> None:
        self.locale = str(locale or "")
        self.recorder = recorder
        self.on_hypothesis = on_hypothesis
        self.on_phrase = on_phrase
        self.on_error = on_error
        self.on_voice_activity = on_voice_activity
        self.on_heartbeat = on_heartbeat
        self.on_timing = on_timing
        self._client_factory = client_factory or self._default_client_factory
        self._lock = RLock()
        self._running = False
        self._capture_started = False
        self._client: Optional[Any] = None
        self._client_token: Optional[object] = None

    @property
    def is_running(self) -> bool:
        with self._lock:
            return self._running

    @property
    def client(self) -> Optional[Any]:
        with self._lock:
            return self._client

    def start(self, locale: Optional[str] = None) -> None:
        with self._lock:
            if self._running:
                return
            self._running = True
            if locale is not None:
                self.locale = str(locale or "")
            active_locale = self.locale
            recorder = self.recorder

        try:
            if active_locale:
                self._install_client(active_locale)
            recorder.start(
                self._send_audio,
                on_voice_activity=self._forward_voice_activity,
                on_heartbeat=self._forward_heartbeat,
                on_error=self._handle_capture_error,
            )
            with self._lock:
                capture_is_current = self._running and self.recorder is recorder
                if capture_is_current:
                    self._capture_started = True
            if not capture_is_current:
                self._close_resource(recorder)
        except Exception:
            self.close()
            raise

    def ensure_locale(self, locale: str) -> None:
        next_locale = str(locale or "")
        with self._lock:
            self.locale = next_locale
            if not self._running:
                return
            current_client = self._client
            current_locale = getattr(current_client, "locale", self.locale)
            if current_client is not None and current_locale == next_locale:
                if getattr(current_client, "is_running", True):
                    return
            old_client = self._client
            self._client = None
            self._client_token = None
        if old_client is not None:
            self._close_resource(old_client)
        if next_locale:
            self._install_client(next_locale)

    def replace_recorder(self, recorder: Any) -> None:
        with self._lock:
            old_recorder = self.recorder
            self.recorder = recorder
            capture_started = self._capture_started
            running = self._running
            self._capture_started = False
        if capture_started:
            self._close_resource(old_recorder)
        if running:
            try:
                recorder.start(
                    self._send_audio,
                    on_voice_activity=self._forward_voice_activity,
                    on_heartbeat=self._forward_heartbeat,
                    on_error=self._handle_capture_error,
                )
                with self._lock:
                    capture_is_current = self._running and self.recorder is recorder
                    if capture_is_current:
                        self._capture_started = True
                if not capture_is_current:
                    self._close_resource(recorder)
            except Exception:
                self._close_resource(recorder)
                raise

    def pause(self) -> None:
        pause = getattr(self.recorder, "pause", None)
        if callable(pause):
            pause()

    def resume(self) -> None:
        resume = getattr(self.recorder, "resume", None)
        if callable(resume):
            resume()

    def close(self) -> None:
        with self._lock:
            self._running = False
            recorder = self.recorder if self._capture_started else None
            client = self._client
            self._capture_started = False
            self._client = None
            self._client_token = None
        if recorder is not None:
            self._close_resource(recorder)
        if client is not None:
            self._close_resource(client)

    def _default_client_factory(
        self,
        locale: str,
        on_hypothesis: Callable[[str], None],
        on_phrase: Callable[[str], None],
        on_error: Callable[[str], None],
    ) -> BingSTTClient:
        return BingSTTClient(
            locale,
            on_hypothesis=on_hypothesis,
            on_phrase=on_phrase,
            on_error=on_error,
            on_timing=self._emit_timing,
        )

    def _install_client(self, locale: str) -> None:
        token = object()
        client = self._client_factory(
            locale,
            lambda text: self._handle_client_event(token, "hypothesis", text),
            lambda text: self._handle_client_event(token, "phrase", text),
            lambda error_code: self._handle_client_event(token, "error", error_code),
        )
        with self._lock:
            if not self._running:
                stale = True
            else:
                stale = False
                self._client = client
                self._client_token = token
                self.locale = locale
        if stale:
            self._close_resource(client)
            return
        try:
            client.start()
        except Exception:
            with self._lock:
                if self._client is client:
                    self._client = None
                    self._client_token = None
            self._close_resource(client)
            raise
        with self._lock:
            client_is_current = self._running and self._client is client
        if not client_is_current:
            self._close_resource(client)
            return
        self._emit_timing("connection_start", time.perf_counter(), locale=locale)

    def _send_audio(self, payload: bytes, captured_at_monotonic: float) -> bool:
        with self._lock:
            if not self._running:
                return False
            client = self._client
        if client is None:
            return False
        try:
            accepted = client.send_audio(
                payload,
                captured_at_monotonic=captured_at_monotonic,
            )
        except TypeError:
            accepted = client.send_audio(payload)
        self._emit_timing(
            "transcriber_audio_callback",
            time.perf_counter(),
            accepted=bool(accepted),
        )
        return bool(accepted)

    def _handle_client_event(self, token: object, kind: str, value: str) -> None:
        with self._lock:
            if not self._running or token is not self._client_token:
                return
        if kind == "hypothesis":
            self._emit_timing("hypothesis_dispatched", time.perf_counter())
            self._invoke_callback(self.on_hypothesis, value)
        elif kind == "phrase":
            self._emit_timing("phrase_dispatched", time.perf_counter())
            self._invoke_callback(self.on_phrase, value)
        else:
            self._invoke_callback(self.on_error, value)

    def _handle_capture_error(self, error_code: str) -> None:
        if self.is_running:
            self._invoke_callback(self.on_error, error_code)

    def _forward_voice_activity(self, speaking: bool, captured_at: float) -> None:
        if self.is_running:
            self._invoke_callback(self.on_voice_activity, speaking, captured_at)

    def _forward_heartbeat(self, captured_at: float) -> None:
        if self.is_running:
            self._invoke_callback(self.on_heartbeat, captured_at)

    def _emit_timing(
        self,
        stage: str,
        observed_at: Optional[float] = None,
        **details: Any,
    ) -> None:
        callback = self.on_timing
        if not callable(callback):
            return
        try:
            callback(
                str(stage),
                time.perf_counter() if observed_at is None else observed_at,
                details,
            )
        except Exception:
            logger.debug("Bing streaming timing callback failed", exc_info=True)

    @staticmethod
    def _close_resource(resource: Any) -> None:
        close = getattr(resource, "close", None)
        if callable(close):
            try:
                close()
            except Exception:
                logger.debug("Bing streaming resource close failed", exc_info=True)

    @staticmethod
    def _invoke_callback(callback: Optional[Callable], *args: Any) -> None:
        if not callable(callback):
            return
        try:
            callback(*args)
        except Exception:
            logger.exception("Bing streaming callback failed")
