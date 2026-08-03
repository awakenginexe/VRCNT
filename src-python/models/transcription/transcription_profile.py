from __future__ import annotations

from copy import deepcopy
from typing import Any, Iterable, Mapping


TRANSCRIPTION_ENGINES = ("Google", "Whisper", "Vosk", "Parakeet", "SenseVoice")
MODEL_ENGINES = ("Whisper", "Vosk", "Parakeet", "SenseVoice")
WHISPER_DECODING_PROFILES = ("fast", "balanced", "accurate")


def make_transcription_profile(
    *,
    engine: str,
    models: Mapping[str, str],
    device: Mapping[str, Any],
    compute_type: str,
    whisper_decoding_profile: str,
) -> dict:
    return {
        "engine": str(engine),
        "models": {
            provider: str(models.get(provider, ""))
            for provider in MODEL_ENGINES
        },
        "device": deepcopy(dict(device)),
        "compute_type": str(compute_type),
        "whisper_decoding_profile": str(whisper_decoding_profile).lower(),
    }


def merge_transcription_profile(base: Mapping[str, Any], patch: Any) -> dict:
    merged = deepcopy(dict(base))
    if not isinstance(patch, Mapping):
        return merged
    for key in ("engine", "device", "compute_type", "whisper_decoding_profile"):
        if key in patch:
            merged[key] = deepcopy(patch[key])
    if isinstance(patch.get("models"), Mapping):
        models = dict(merged.get("models", {}))
        models.update(patch["models"])
        merged["models"] = models
    return merged


def _matching_device(devices: Iterable[Mapping[str, Any]], candidate: Any):
    if not isinstance(candidate, Mapping):
        return None
    for device in devices:
        if (
            device.get("device") == candidate.get("device")
            and device.get("device_index") == candidate.get("device_index")
        ):
            return deepcopy(dict(device))
    return None


def _first_device(devices: list[Mapping[str, Any]], kind: str | None):
    for device in devices:
        if kind is None or device.get("device") == kind:
            return deepcopy(dict(device))
    return deepcopy(dict(devices[0])) if devices else {}


def normalize_transcription_profile(
    value: Any,
    *,
    fallback: Mapping[str, Any],
    selectable_engines: Iterable[str],
    selectable_models: Mapping[str, Iterable[str]],
    selectable_devices: Iterable[Mapping[str, Any]],
) -> dict:
    fallback_profile = make_transcription_profile(
        engine=fallback.get("engine", "Google"),
        models=fallback.get("models", {}),
        device=fallback.get("device", {}),
        compute_type=fallback.get("compute_type", "auto"),
        whisper_decoding_profile=fallback.get("whisper_decoding_profile", "balanced"),
    )
    candidate = merge_transcription_profile(fallback_profile, value)
    engines = tuple(selectable_engines) or TRANSCRIPTION_ENGINES
    engine = str(candidate.get("engine", fallback_profile["engine"]))
    if engine not in engines:
        engine = fallback_profile["engine"] if fallback_profile["engine"] in engines else engines[0]

    models = {}
    candidate_models = candidate.get("models", {})
    for provider in MODEL_ENGINES:
        options = tuple(selectable_models.get(provider, ()))
        selected = str(candidate_models.get(provider, ""))
        fallback_model = fallback_profile["models"].get(provider, "")
        if options and selected not in options:
            selected = fallback_model if fallback_model in options else options[0]
        models[provider] = selected

    devices = [dict(device) for device in selectable_devices if isinstance(device, Mapping)]
    device = _matching_device(devices, candidate.get("device"))
    if device is None:
        device = _matching_device(devices, fallback_profile.get("device"))
    if device is None:
        device = {}
    required_kind = None
    if engine == "Parakeet":
        required_kind = "cuda"
    elif engine in {"Google", "Vosk", "SenseVoice"}:
        required_kind = "cpu"
    if required_kind is not None and device.get("device") != required_kind:
        device = _first_device(devices, required_kind)
    if not device:
        device = deepcopy(fallback_profile["device"])

    allowed_compute_types = list(device.get("compute_types", [])) or ["auto"]
    if engine in {"Google", "Vosk", "Parakeet", "SenseVoice"}:
        allowed_compute_types = ["auto"]
    compute_type = str(candidate.get("compute_type", "auto"))
    if compute_type not in allowed_compute_types:
        compute_type = "auto" if "auto" in allowed_compute_types else allowed_compute_types[0]

    decoding = str(candidate.get("whisper_decoding_profile", "balanced")).lower()
    if decoding not in WHISPER_DECODING_PROFILES:
        decoding = "balanced"

    return make_transcription_profile(
        engine=engine,
        models=models,
        device=device,
        compute_type=compute_type,
        whisper_decoding_profile=decoding,
    )


def effective_transcription_profile(profile: Mapping[str, Any]) -> tuple:
    engine = str(profile.get("engine", "Google"))
    models = profile.get("models", {}) if isinstance(profile.get("models"), Mapping) else {}
    if engine == "Google":
        return (engine,)
    if engine in {"Vosk", "SenseVoice"}:
        return (engine, str(models.get(engine, "")))
    device = profile.get("device", {}) if isinstance(profile.get("device"), Mapping) else {}
    device_key = (device.get("device"), device.get("device_index"))
    if engine == "Parakeet":
        return (engine, str(models.get(engine, "")), device_key)
    return (
        engine,
        str(models.get("Whisper", "")),
        device_key,
        str(profile.get("compute_type", "auto")),
        str(profile.get("whisper_decoding_profile", "balanced")),
    )
