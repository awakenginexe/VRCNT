"""Groq-hosted Whisper transcription support.

The cloud adapter deliberately owns only the HTTP request and credential
selection. Phrase buffering remains in ``AudioTranscriber`` so all
transcription engines continue to share the existing capture queue.
"""

from __future__ import annotations

from typing import Any, Callable, Mapping, Optional

import requests


WHISPER_CLOUD_MODELS = (
    "whisper-large-v3",
    "whisper-large-v3-turbo",
)
DEFAULT_WHISPER_CLOUD_MODEL = "whisper-large-v3-turbo"
GROQ_TRANSCRIPTION_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions"


class WhisperCloudRequestError(RuntimeError):
    """A Groq transcription request failed."""

    def __init__(
        self,
        status_code: int,
        message: str = "Groq transcription request failed",
        retry_after: Optional[str] = None,
    ) -> None:
        self.status_code = status_code
        self.retry_after = retry_after
        super().__init__(message)


def resolve_whisper_cloud_api_key(
    auth_keys: Mapping[str, Any],
    use_split_key: bool,
) -> Optional[str]:
    """Resolve the key for Whisper Cloud without silently falling back.

    When split mode is enabled, an empty transcription key is intentionally
    treated as unavailable rather than reusing the translation credential.
    """

    key_name = "Groq_Whisper_API" if use_split_key else "Groq_API"
    value = auth_keys.get(key_name) if isinstance(auth_keys, Mapping) else None
    return value if isinstance(value, str) and value.strip() else None


class WhisperCloudClient:
    """Small OpenAI-compatible Groq audio-transcription client."""

    def __init__(
        self,
        *,
        api_key: str,
        model: str = DEFAULT_WHISPER_CLOUD_MODEL,
        request_post: Optional[Callable[..., Any]] = None,
        timeout: float = 15.0,
    ) -> None:
        if not isinstance(api_key, str) or not api_key.strip():
            raise ValueError("Groq transcription API key is required")
        if model not in WHISPER_CLOUD_MODELS:
            raise ValueError(f"Unsupported Whisper Cloud model: {model}")
        self.api_key = api_key
        self.model = model
        self.request_post = request_post or requests.post
        self.timeout = timeout

    def transcribe(
        self,
        wav_bytes: bytes,
        *,
        language: Optional[str] = None,
    ) -> dict:
        data = {
            "model": self.model,
            "response_format": "verbose_json",
            "temperature": "0",
        }
        if language:
            data["language"] = language

        response = self.request_post(
            GROQ_TRANSCRIPTION_ENDPOINT,
            headers={"Authorization": f"Bearer {self.api_key}"},
            files={"file": ("audio.wav", wav_bytes, "audio/wav")},
            data=data,
            timeout=self.timeout,
        )
        status_code = int(getattr(response, "status_code", 200))
        if status_code >= 400:
            headers = getattr(response, "headers", {}) or {}
            retry_after = headers.get("retry-after") or headers.get("Retry-After")
            raise WhisperCloudRequestError(
                status_code,
                retry_after=retry_after,
            )

        payload = response.json()
        if not isinstance(payload, Mapping):
            raise WhisperCloudRequestError(
                status_code,
                "Groq transcription response was not an object",
            )
        return dict(payload)
