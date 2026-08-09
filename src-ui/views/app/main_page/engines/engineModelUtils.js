export const TRANSCRIPTION_ENGINE_OPTIONS = [
    "Whisper",
    "Whisper Thai",
    "Whisper Cloud",
    "Google",
    "Vosk",
    "Parakeet",
    "SenseVoice",
];

export const WHISPER_CLOUD_MODELS = [
    "whisper-large-v3",
    "whisper-large-v3-turbo",
];

export const WHISPER_PRESETS = [
    {
        id: "fast",
        candidates: ["tiny", "base"],
        decodingProfile: "fast",
    },
    {
        id: "balanced",
        candidates: ["small", "medium"],
        decodingProfile: "balanced",
    },
    {
        id: "best_accuracy",
        candidates: ["large-v3-turbo", "large-v3", "large-v2", "large-v1"],
        decodingProfile: "accurate",
    },
];

const installedModelIds = (statuses) => new Set(
    (Array.isArray(statuses) ? statuses : [])
        .filter((status) => status?.is_downloaded === true)
        .map((status) => status.id),
);

export const findPresetCandidate = ({ presetId, statuses, installedOnly = false }) => {
    const preset = WHISPER_PRESETS.find((item) => item.id === presetId);
    if (!preset) return null;

    const statusById = new Map(
        (Array.isArray(statuses) ? statuses : []).map((status) => [status.id, status]),
    );
    const installed = installedModelIds(statuses);
    const candidate = preset.candidates.find((id) => (
        statusById.has(id) && (!installedOnly || installed.has(id))
    ));
    return candidate ? statusById.get(candidate) : null;
};

export const resolveWhisperRecommendation = ({ statuses, selectedDevice }) => {
    const installed = installedModelIds(statuses);
    const isCuda = selectedDevice?.device === "cuda";
    // Do not automatically switch a CPU-only session to a large model just
    // because it happens to be installed. It remains available under
    // Advanced models for an explicit user choice.
    const priority = isCuda
        ? ["best_accuracy", "balanced", "fast"]
        : ["balanced", "fast"];

    for (const presetId of priority) {
        const preset = WHISPER_PRESETS.find((item) => item.id === presetId);
        const modelId = preset?.candidates.find((id) => installed.has(id));
        if (modelId) {
            return {
                presetId,
                modelId,
                reason: isCuda ? "cuda" : "cpu",
            };
        }
    }

    return { presetId: null, modelId: null, reason: "no_installed_model" };
};

export const getPresetForModel = (modelId) => (
    WHISPER_PRESETS.find((preset) => preset.candidates.includes(modelId))?.id ?? null
);
