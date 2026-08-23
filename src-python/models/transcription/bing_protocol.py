"""Framing and message parsing for the unofficial Bing consumer STT stream."""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping
from urllib.parse import urlencode


BING_ENDPOINT = "wss://speech.platform.bing.com/speech/recognition/edge/interactive/v1"
BING_TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
BING_SEC_MS_GEC_VERSION = "1-145.0.3800.70"
BING_CHANNELS = 1
BING_BITS_PER_SAMPLE = 16


@dataclass(frozen=True)
class BingServerMessage:
    path: str
    headers: Mapping[str, str]
    body_bytes: bytes

    @property
    def body(self) -> str:
        return self.body_bytes.decode("utf-8", errors="replace")

    @property
    def json(self) -> Any:
        if not self.body_bytes:
            return None
        try:
            return json.loads(self.body)
        except (TypeError, ValueError):
            return None


@dataclass(frozen=True)
class BingRecognitionEvent:
    kind: str
    text: str = ""
    service_tag: str | None = None
    request_id: str | None = None


def _timestamp(value: datetime | None = None) -> str:
    if value is None:
        value = datetime.now(timezone.utc)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )


def generate_sec_ms_gec(now: datetime | float | int | None = None) -> str:
    """Generate the rounded Windows-epoch SHA-256 query value."""

    if isinstance(now, datetime):
        unix_seconds = int(now.timestamp())
    elif now is None:
        unix_seconds = int(time.time())
    else:
        unix_seconds = int(now)

    windows_epoch_seconds = 11_644_473_600
    ticks = (unix_seconds + windows_epoch_seconds) * 10_000_000
    rounded_ticks = ticks - (ticks % 300_000_000)
    digest = hashlib.sha256(
        f"{rounded_ticks}{BING_TRUSTED_CLIENT_TOKEN}".encode("utf-8")
    ).hexdigest()
    return digest.upper()


def build_websocket_url(locale: str, sec_ms_gec: str) -> str:
    query = urlencode(
        {
            "TrustedClientToken": BING_TRUSTED_CLIENT_TOKEN,
            "Sec-MS-GEC": sec_ms_gec,
            "Sec-MS-GEC-Version": BING_SEC_MS_GEC_VERSION,
            "language": locale,
            "profanity": "raw",
        }
    )
    return f"{BING_ENDPOINT}?{query}"


def build_text_message(
    path: str,
    body: Mapping[str, Any],
    *,
    request_id: str | None = None,
    content_type: str | None = None,
    timestamp: str | None = None,
) -> str:
    headers = [
        f"X-Timestamp:{timestamp or _timestamp()}",
        f"Path:{path}",
    ]
    if request_id:
        headers.append(f"X-RequestId:{request_id}")
    if content_type:
        headers.append(f"Content-Type:{content_type}")
    return "\r\n".join(headers) + "\r\n\r\n" + json.dumps(
        body,
        ensure_ascii=False,
        separators=(",", ":"),
    )


def build_binary_message(
    path: str,
    body: bytes,
    *,
    request_id: str,
    stream_id: str | None = None,
    content_type: str | None = None,
    timestamp: str | None = None,
) -> bytes:
    headers = [
        f"X-Timestamp:{timestamp or _timestamp()}",
        f"Path:{path}",
        f"X-RequestId:{request_id}",
    ]
    if content_type:
        headers.append(f"Content-Type:{content_type}")
    if stream_id:
        headers.append(f"X-StreamId:{stream_id}")
    header_bytes = "\r\n".join(headers).encode("utf-8")
    if len(header_bytes) > 0xFFFF:
        raise ValueError("Bing message headers exceed the protocol limit")
    return len(header_bytes).to_bytes(2, "big") + header_bytes + bytes(body)


def create_wav_header(
    sample_rate: int = 16_000,
    channels: int = BING_CHANNELS,
    bits_per_sample: int = BING_BITS_PER_SAMPLE,
) -> bytes:
    """Create the 44-byte streaming WAV header expected by the endpoint."""

    if sample_rate <= 0 or channels <= 0 or bits_per_sample <= 0:
        raise ValueError("WAV format values must be positive")
    byte_rate = sample_rate * channels * (bits_per_sample // 8)
    block_align = channels * (bits_per_sample // 8)
    header = bytearray(44)
    header[0:4] = b"RIFF"
    header[8:12] = b"WAVE"
    header[12:16] = b"fmt "
    header[36:40] = b"data"
    header[16:20] = (16).to_bytes(4, "little")
    header[20:22] = (1).to_bytes(2, "little")
    header[22:24] = channels.to_bytes(2, "little")
    header[24:28] = sample_rate.to_bytes(4, "little")
    header[28:32] = byte_rate.to_bytes(4, "little")
    header[32:34] = block_align.to_bytes(2, "little")
    header[34:36] = bits_per_sample.to_bytes(2, "little")
    return bytes(header)


def _parse_headers(header_bytes: bytes) -> dict[str, str]:
    headers: dict[str, str] = {}
    for line in header_bytes.decode("utf-8", errors="replace").split("\r\n"):
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        headers[key.strip().lower()] = value.strip()
    return headers


def parse_server_message(message: str | bytes | bytearray) -> BingServerMessage:
    if isinstance(message, str):
        header_text, separator, body_text = message.partition("\r\n\r\n")
        if not separator:
            header_text, _, body_text = message.partition("\n\n")
        headers = _parse_headers(header_text.encode("utf-8"))
        body_bytes = body_text.encode("utf-8")
    else:
        raw = bytes(message)
        if len(raw) < 2:
            raise ValueError("Bing binary message is missing its header length")
        header_length = int.from_bytes(raw[:2], "big")
        header_end = 2 + header_length
        if header_end > len(raw):
            raise ValueError("Bing binary message header is truncated")
        headers = _parse_headers(raw[2:header_end])
        body_bytes = raw[header_end:]

    return BingServerMessage(
        path=headers.get("path", "").replace(" ", ""),
        headers=headers,
        body_bytes=body_bytes,
    )


def parse_server_recognition_event(
    message: str | bytes | bytearray | BingServerMessage,
) -> BingRecognitionEvent | None:
    parsed = message if isinstance(message, BingServerMessage) else parse_server_message(message)
    payload = parsed.json if isinstance(parsed.json, Mapping) else {}
    path = parsed.path.lower()
    if path == "turn.start":
        context = payload.get("context") if isinstance(payload, Mapping) else {}
        return BingRecognitionEvent(
            "turn_start",
            service_tag=(context or {}).get("serviceTag") if isinstance(context, Mapping) else None,
            request_id=parsed.headers.get("x-requestid"),
        )
    if path == "turn.end":
        return BingRecognitionEvent("turn_end", request_id=parsed.headers.get("x-requestid"))
    if path == "speech.hypothesis":
        text = payload.get("Text", "")
        return BingRecognitionEvent(
            "hypothesis",
            text=str(text).strip() if text is not None else "",
            request_id=parsed.headers.get("x-requestid"),
        )
    if path == "speech.phrase":
        text = payload.get("DisplayText", "")
        return BingRecognitionEvent(
            "phrase",
            text=str(text).strip() if text is not None else "",
            request_id=parsed.headers.get("x-requestid"),
        )
    return None
