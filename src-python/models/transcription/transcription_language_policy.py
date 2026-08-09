"""Saved-profile normalization and runtime transcription language policy."""

from __future__ import annotations

import copy
from typing import Mapping

from models.transcription.transcription_languages import transcription_lang


LANGUAGE_SLOT_KEYS = ("1", "2", "3")

TRANSCRIPTION_LANGUAGE_CAPABILITIES = {
    "Whisper": {
        "microphone_max": 3,
        "received_max": 3,
        "parallel_candidates": False,
    },
    "Whisper Thai": {
        "microphone_max": 1,
        "received_max": 1,
        "parallel_candidates": False,
        "fixed_language": {
            "language": "Thai",
            "country": "Thailand",
            "code": "th",
        },
    },
    "Google": {
        "microphone_max": 3,
        "received_max": 3,
        "parallel_candidates": True,
    },
    "SenseVoice": {
        "microphone_max": 3,
        "received_max": 3,
        "parallel_candidates": False,
    },
    "Vosk": {
        "microphone_max": 1,
        "received_max": 1,
        "parallel_candidates": False,
    },
    "Parakeet": {
        "microphone_max": 1,
        "received_max": 1,
        "parallel_candidates": False,
    },
}


def _valid_language_slot(value: object) -> bool:
    if not isinstance(value, Mapping):
        return False
    language = value.get("language")
    country = value.get("country")
    return (
        isinstance(language, str)
        and isinstance(country, str)
        and isinstance(value.get("enable"), bool)
        and country in transcription_lang.get(language, {})
    )


def _copy_slot(value: Mapping) -> dict:
    return {
        "language": value["language"],
        "country": value["country"],
        "enable": value["enable"] is True,
    }


def normalize_language_slots(
    slots: object,
    defaults: Mapping,
    minimum_enabled: int = 1,
    maximum_enabled: int = 3,
) -> dict:
    """Normalize one preset's fixed slots while retaining valid saved values."""

    source = slots if isinstance(slots, Mapping) else {}
    normalized = {}
    for key in LANGUAGE_SLOT_KEYS:
        candidate = source.get(key)
        fallback = defaults.get(key)
        if _valid_language_slot(candidate):
            normalized[key] = _copy_slot(candidate)
        elif _valid_language_slot(fallback):
            normalized[key] = _copy_slot(fallback)
        else:
            raise ValueError(f"Language slot {key} has no valid default")

    minimum_enabled = max(1, min(int(minimum_enabled), len(LANGUAGE_SLOT_KEYS)))
    maximum_enabled = max(
        minimum_enabled,
        min(int(maximum_enabled), len(LANGUAGE_SLOT_KEYS)),
    )

    normalized["1"]["enable"] = True
    seen_pairs = set()
    enabled_count = 0
    for key in LANGUAGE_SLOT_KEYS:
        slot = normalized[key]
        if slot["enable"] is not True:
            continue
        pair = (slot["language"], slot["country"])
        if pair in seen_pairs or enabled_count >= maximum_enabled:
            slot["enable"] = False
            continue
        seen_pairs.add(pair)
        enabled_count += 1

    if enabled_count < minimum_enabled:
        for key in LANGUAGE_SLOT_KEYS:
            slot = normalized[key]
            pair = (slot["language"], slot["country"])
            if slot["enable"] is True or pair in seen_pairs:
                continue
            slot["enable"] = True
            seen_pairs.add(pair)
            enabled_count += 1
            if enabled_count >= minimum_enabled:
                break

    return normalized


def normalize_language_profiles(
    profiles: object,
    defaults: Mapping,
    minimum_enabled: int = 1,
    maximum_enabled: int = 3,
) -> dict:
    """Normalize every configured preset and repair presets missing from saved data."""

    source = profiles if isinstance(profiles, Mapping) else {}
    normalized = {}
    for preset_key, default_slots in defaults.items():
        normalized[str(preset_key)] = normalize_language_slots(
            source.get(str(preset_key)),
            default_slots,
            minimum_enabled,
            maximum_enabled,
        )
    return normalized


def enabled_slot_keys(slots: Mapping) -> list[str]:
    return [
        key
        for key in LANGUAGE_SLOT_KEYS
        if isinstance(slots.get(key), Mapping)
        and slots[key].get("enable") is True
    ]


def enabled_language_slots(slots: Mapping, maximum_enabled: int = 3) -> tuple[dict, ...]:
    maximum_enabled = max(0, min(int(maximum_enabled), len(LANGUAGE_SLOT_KEYS)))
    return tuple(
        copy.deepcopy(slots[key])
        for key in enabled_slot_keys(slots)[:maximum_enabled]
    )


def runtime_language_slots(engine: str, slots: Mapping, direction: str) -> tuple[dict, ...]:
    """Return active language hints without changing the saved profile."""

    if str(engine) == "Whisper Thai":
        return (
            {
                "language": "Thai",
                "country": "Thailand",
                "enable": True,
            },
        )

    capability = TRANSCRIPTION_LANGUAGE_CAPABILITIES.get(
        str(engine),
        {"microphone_max": 1, "received_max": 1},
    )
    maximum_key = "received_max" if direction == "received" else "microphone_max"
    return enabled_language_slots(slots, capability[maximum_key])


def transcription_language_capabilities() -> dict:
    return copy.deepcopy(TRANSCRIPTION_LANGUAGE_CAPABILITIES)
