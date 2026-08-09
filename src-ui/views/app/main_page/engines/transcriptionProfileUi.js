const MODEL_PROVIDERS = new Set(["Whisper", "Whisper Thai", "Vosk", "Parakeet", "SenseVoice"]);

export const getProfileControlVisibility = (engine) => ({
    model: MODEL_PROVIDERS.has(engine),
    device: engine === "Whisper" || engine === "Whisper Thai" || engine === "Parakeet",
    computeType: engine === "Whisper" || engine === "Whisper Thai",
    whisperDecoding: engine === "Whisper" || engine === "Whisper Thai",
});

export const getActiveModel = (profile) => (
    MODEL_PROVIDERS.has(profile?.engine)
        ? profile?.models?.[profile.engine] ?? ""
        : ""
);

export const getActiveModelAvailability = (profile, statusesByProvider) => {
    if (profile?.engine === "Google") return "cloud";
    const selected = getActiveModel(profile);
    const status = (statusesByProvider?.[profile?.engine] ?? [])
        .find((item) => item?.id === selected);
    if (status?.is_downloaded === true) return "installed";
    if (status?.is_pending === true) return "downloading";
    if (status?.downloadable === false) return "unavailable";
    return "download_required";
};

const canonicalProfile = (profile) => ({
    engine: profile?.engine ?? "",
    models: {
        Whisper: profile?.models?.Whisper ?? "",
        "Whisper Thai": profile?.models?.["Whisper Thai"] ?? "",
        Vosk: profile?.models?.Vosk ?? "",
        Parakeet: profile?.models?.Parakeet ?? "",
        SenseVoice: profile?.models?.SenseVoice ?? "",
    },
    device: {
        device: profile?.device?.device ?? "",
        device_index: profile?.device?.device_index ?? 0,
    },
    compute_type: profile?.compute_type ?? "auto",
    whisper_decoding_profile: profile?.whisper_decoding_profile ?? "balanced",
    runtime_preferences: {
        Whisper: {
            device: profile?.runtime_preferences?.Whisper?.device?.device ?? "",
            device_index: profile?.runtime_preferences?.Whisper?.device?.device_index ?? 0,
            compute_type: profile?.runtime_preferences?.Whisper?.compute_type ?? "auto",
        },
        Parakeet: {
            device: profile?.runtime_preferences?.Parakeet?.device?.device ?? "",
            device_index: profile?.runtime_preferences?.Parakeet?.device?.device_index ?? 0,
            compute_type: profile?.runtime_preferences?.Parakeet?.compute_type ?? "auto",
        },
    },
});

export const transcriptionProfilesMatch = (outgoing, incoming) => (
    JSON.stringify(canonicalProfile(outgoing)) === JSON.stringify(canonicalProfile(incoming))
);

export const shouldWarnLegacyOverwrite = (outgoing, incoming) => (
    !transcriptionProfilesMatch(outgoing, incoming)
);

export const requestLegacyApplyToBoth = ({
    outgoing,
    incoming,
    action,
    requestConfirmation,
}) => {
    if (shouldWarnLegacyOverwrite(outgoing, incoming)) {
        requestConfirmation(action);
        return "confirmation_required";
    }
    action();
    return "applied";
};

export const resolveProfileBackedState = (legacyState = {}, profileValue) => ({
    ...legacyState,
    data: profileValue ?? legacyState?.data ?? {},
});
