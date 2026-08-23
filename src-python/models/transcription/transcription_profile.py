from __future__ import annotations

from copy import deepcopy
from typing import Any, Iterable, Mapping


TRANSCRIPTION_ENGINES = (
    "Google",
    "Bing",
    "Whisper",
    "Whisper Thai",
    "Whisper Cloud",
    "Vosk",
    "Parakeet",
    "SenseVoice",
)
MODEL_ENGINES = (
    "Whisper",
    "Whisper Thai",
    "Whisper Cloud",
    "Vosk",
    "Parakeet",
    "SenseVoice",
)
WHISPER_ENGINES = ("Whisper", "Whisper Thai")
RUNTIME_PREFERENCE_ENGINES = ("Whisper", "Parakeet")
WHISPER_DECODING_PROFILES = ("fast", "balanced", "accurate")


def make_transcription_profile(
    *,
    engine: str,
    models: Mapping[str, str],
    device: Mapping[str, Any],
    compute_type: str,
    whisper_decoding_profile: str,
    runtime_preferences: Mapping[str, Any] | None = None,
) -> dict:
    saved_preferences = runtime_preferences if isinstance(runtime_preferences, Mapping) else {}
    normalized_preferences = {}
    for provider in RUNTIME_PREFERENCE_ENGINES:
        saved = saved_preferences.get(provider, {})
        if not isinstance(saved, Mapping):
            saved = {}
        saved_device = saved.get("device", device)
        if not isinstance(saved_device, Mapping):
            saved_device = device
        normalized_preferences[provider] = {
            "device": deepcopy(dict(saved_device)),
            "compute_type": str(saved.get(
                "compute_type",
                compute_type if provider == "Whisper" else "auto",
            )),
        }
    return {
        "engine": str(engine),
        "models": {
            provider: str(models.get(provider, ""))
            for provider in MODEL_ENGINES
        },
        "device": deepcopy(dict(device)),
        "compute_type": str(compute_type),
        "whisper_decoding_profile": str(whisper_decoding_profile).lower(),
        "runtime_preferences": normalized_preferences,
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
    if isinstance(patch.get("runtime_preferences"), Mapping):
        preferences = deepcopy(dict(merged.get("runtime_preferences", {})))
        for provider, preference_patch in patch["runtime_preferences"].items():
            if (
                provider not in RUNTIME_PREFERENCE_ENGINES
                or not isinstance(preference_patch, Mapping)
            ):
                continue
            preference = deepcopy(dict(preferences.get(provider, {})))
            preference.update(deepcopy(dict(preference_patch)))
            preferences[provider] = preference
        merged["runtime_preferences"] = preferences

    target_engine = str(merged.get("engine", "Google"))
    runtime_provider = "Whisper" if target_engine in WHISPER_ENGINES else target_engine
    if runtime_provider in RUNTIME_PREFERENCE_ENGINES and (
        "device" in patch or "compute_type" in patch
    ):
        preferences = deepcopy(dict(merged.get("runtime_preferences", {})))
        preference = deepcopy(dict(preferences.get(runtime_provider, {})))
        if "device" in patch:
            preference["device"] = deepcopy(patch["device"])
        if "compute_type" in patch:
            preference["compute_type"] = str(patch["compute_type"])
        preferences[runtime_provider] = preference
        merged["runtime_preferences"] = preferences
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
        runtime_preferences=fallback.get("runtime_preferences", {}),
    )
    candidate = deepcopy(fallback_profile)
    if isinstance(value, Mapping):
        for key in ("engine", "device", "compute_type", "whisper_decoding_profile"):
            if key in value:
                candidate[key] = deepcopy(value[key])
        if isinstance(value.get("models"), Mapping):
            candidate["models"].update(deepcopy(dict(value["models"])))
        if isinstance(value.get("runtime_preferences"), Mapping):
            for provider, preference in value["runtime_preferences"].items():
                if provider in RUNTIME_PREFERENCE_ENGINES and isinstance(preference, Mapping):
                    candidate["runtime_preferences"][provider] = deepcopy(dict(preference))
        else:
            migrated_engine = str(candidate.get("engine", "Google"))
            runtime_provider = (
                "Whisper" if migrated_engine in WHISPER_ENGINES else migrated_engine
            )
            if runtime_provider in RUNTIME_PREFERENCE_ENGINES:
                candidate["runtime_preferences"][runtime_provider] = {
                    "device": deepcopy(candidate.get("device", {})),
                    "compute_type": str(candidate.get("compute_type", "auto")),
                }
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
    candidate_preferences = candidate.get("runtime_preferences", {})
    fallback_preferences = fallback_profile.get("runtime_preferences", {})
    runtime_preferences = {}
    for provider in RUNTIME_PREFERENCE_ENGINES:
        raw_preference = (
            candidate_preferences.get(provider, {})
            if isinstance(candidate_preferences, Mapping)
            else {}
        )
        fallback_preference = (
            fallback_preferences.get(provider, {})
            if isinstance(fallback_preferences, Mapping)
            else {}
        )
        if not isinstance(raw_preference, Mapping):
            raw_preference = {}
        if not isinstance(fallback_preference, Mapping):
            fallback_preference = {}
        preference_device = _matching_device(devices, raw_preference.get("device"))
        if preference_device is None:
            preference_device = _matching_device(devices, fallback_preference.get("device"))
        if preference_device is None:
            preference_device = _matching_device(devices, candidate.get("device"))
        required_kind = "cuda" if provider == "Parakeet" else None
        if required_kind is not None and (
            not preference_device or preference_device.get("device") != required_kind
        ):
            preference_device = _first_device(devices, required_kind)
        if not preference_device:
            preference_device = deepcopy(fallback_profile["device"])
        allowed_preference_types = list(preference_device.get("compute_types", [])) or ["auto"]
        preference_compute_type = str(raw_preference.get(
            "compute_type",
            fallback_preference.get("compute_type", candidate.get("compute_type", "auto")),
        ))
        if provider == "Parakeet":
            preference_compute_type = "auto"
        elif preference_compute_type not in allowed_preference_types:
            preference_compute_type = (
                "auto" if "auto" in allowed_preference_types else allowed_preference_types[0]
            )
        runtime_preferences[provider] = {
            "device": preference_device,
            "compute_type": preference_compute_type,
        }

    runtime_provider = "Whisper" if engine in WHISPER_ENGINES else engine
    if runtime_provider in RUNTIME_PREFERENCE_ENGINES:
        device = deepcopy(runtime_preferences[runtime_provider]["device"])
        compute_type = runtime_preferences[runtime_provider]["compute_type"]
    else:
        device = _first_device(devices, "cpu") or deepcopy(fallback_profile["device"])
        compute_type = "auto"

    decoding = str(candidate.get("whisper_decoding_profile", "balanced")).lower()
    if decoding not in WHISPER_DECODING_PROFILES:
        decoding = "balanced"

    return make_transcription_profile(
        engine=engine,
        models=models,
        device=device,
        compute_type=compute_type,
        whisper_decoding_profile=decoding,
        runtime_preferences=runtime_preferences,
    )


def effective_transcription_profile(profile: Mapping[str, Any]) -> tuple:
    engine = str(profile.get("engine", "Google"))
    models = profile.get("models", {}) if isinstance(profile.get("models"), Mapping) else {}
    if engine in {"Google", "Bing"}:
        return (engine,)
    if engine in {"Vosk", "SenseVoice"}:
        return (engine, str(models.get(engine, "")))
    device = profile.get("device", {}) if isinstance(profile.get("device"), Mapping) else {}
    device_key = (device.get("device"), device.get("device_index"))
    if engine == "Parakeet":
        return (engine, str(models.get(engine, "")), device_key)
    if engine == "Whisper Cloud":
        return (engine, str(models.get(engine, "")))
    if engine in WHISPER_ENGINES:
        return (
            engine,
            str(models.get(engine, "")),
            device_key,
            str(profile.get("compute_type", "auto")),
            str(profile.get("whisper_decoding_profile", "balanced")),
        )
    return (
        engine,
        str(models.get("Whisper", "")),
        device_key,
        str(profile.get("compute_type", "auto")),
        str(profile.get("whisper_decoding_profile", "balanced")),
    )
