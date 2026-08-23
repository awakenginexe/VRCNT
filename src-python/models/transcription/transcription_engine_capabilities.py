"""Central capabilities shared by transcription profiles and runtime policy."""

from __future__ import annotations

import copy
from typing import Any


# ``microphone_max`` and ``received_max`` are runtime limits for the two
# independent transcription directions. ``max_languages`` is the public
# profile capability used by UI and validation code.
TRANSCRIPTION_ENGINE_CAPABILITIES: dict[str, dict[str, Any]] = {
    "Google": {
        "type": "cloud",
        "provider": "google",
        "max_languages": 1,
        "microphone_max": 1,
        "received_max": 1,
        "parallel_candidates": False,
        "icon": "google",
    },
    "Bing": {
        "type": "cloud",
        "provider": "microsoft-bing",
        "max_languages": 1,
        "microphone_max": 1,
        "received_max": 1,
        "parallel_candidates": False,
        "icon": "bing",
    },
    "Whisper": {
        "type": "local",
        "provider": "openai-whisper",
        "max_languages": 3,
        "microphone_max": 3,
        "received_max": 3,
        "parallel_candidates": False,
        "icon": "openai",
    },
    "Whisper Thai": {
        "type": "local",
        "provider": "openai-whisper",
        "max_languages": 1,
        "microphone_max": 1,
        "received_max": 1,
        "parallel_candidates": False,
        "icon": "openai",
    },
    "Whisper Cloud": {
        "type": "cloud",
        "provider": "groq",
        "max_languages": 1,
        "microphone_max": 1,
        "received_max": 1,
        "parallel_candidates": False,
        "icon": "groq",
    },
    "Vosk": {
        "type": "local",
        "provider": "vosk",
        "max_languages": 1,
        "microphone_max": 1,
        "received_max": 1,
        "parallel_candidates": False,
        "icon": "vosk",
    },
    "Parakeet": {
        "type": "local",
        "provider": "nvidia-parakeet",
        "max_languages": 3,
        "microphone_max": 3,
        "received_max": 3,
        "parallel_candidates": False,
        "icon": "nvidia",
    },
    "SenseVoice": {
        "type": "local",
        "provider": "sensevoice",
        "max_languages": 3,
        "microphone_max": 3,
        "received_max": 3,
        "parallel_candidates": False,
        "icon": "qwen",
    },
}


def get_transcription_engine_capability(engine: str) -> dict[str, Any]:
    """Return a defensive capability copy for one engine."""

    capability = TRANSCRIPTION_ENGINE_CAPABILITIES.get(str(engine))
    if capability is None:
        return {
            "type": "local",
            "provider": "unknown",
            "max_languages": 1,
            "microphone_max": 1,
            "received_max": 1,
            "parallel_candidates": False,
            "icon": "local",
        }
    return copy.deepcopy(capability)


def is_cloud_transcription_engine(engine: str) -> bool:
    return get_transcription_engine_capability(engine).get("type") == "cloud"


def transcription_engine_capabilities() -> dict[str, dict[str, Any]]:
    return copy.deepcopy(TRANSCRIPTION_ENGINE_CAPABILITIES)
