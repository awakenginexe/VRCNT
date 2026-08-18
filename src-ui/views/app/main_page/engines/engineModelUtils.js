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

export const MODEL_FILTER_CATEGORIES = [
    { id: "all", labelKey: "main_page.models_hub.filter_all", fallback: "All Models" },
    { id: "cpu", labelKey: "main_page.models_hub.filter_cpu", fallback: "⚡ CPU Friendly" },
    { id: "gpu", labelKey: "main_page.models_hub.filter_gpu", fallback: "🚀 GPU Accelerated" },
    { id: "cloud", labelKey: "main_page.models_hub.filter_cloud", fallback: "☁️ Cloud Zero-Load" },
    { id: "thai", labelKey: "main_page.models_hub.filter_thai", fallback: "🇹🇭 Thai Specialist" },
];

export const getModelSuitability = (engine, modelId = "") => {
    const id = (modelId || "").toLowerCase();
    const eng = (engine || "").toLowerCase();

    if (eng.includes("cloud") || id.includes("cloud")) {
        return {
            speed: 3,
            quality: 3,
            tier: "cloud",
            badge: "☁️ Zero PC Load",
            summary: "Groq-hosted Cloud AI · 0% CPU/VRAM usage",
        };
    }

    if (eng.includes("thai") || id.includes("thai")) {
        return {
            speed: 2,
            quality: 3,
            tier: "thai",
            badge: "🇹🇭 Thai Specialist",
            summary: "BioDataLab Thonburian fine-tuned for Thai",
        };
    }

    if (id.includes("tiny") || id.includes("base") || id.includes("small-") || id === "sensevoice-small-int8") {
        return {
            speed: 3,
            quality: 2,
            tier: "cpu",
            badge: "⚡ CPU Friendly",
            summary: "Ultra-fast response · Lightweight memory footprint",
        };
    }

    if (id.includes("small") || id.includes("600m")) {
        return {
            speed: 2,
            quality: 2,
            tier: "cpu",
            badge: "⚖️ CPU / GPU Balanced",
            summary: "Great balance of accuracy and speech speed",
        };
    }

    return {
        speed: 2,
        quality: 3,
        tier: "gpu",
        badge: "🚀 GPU Recommended",
        summary: "High precision · Best on NVIDIA CUDA GPU",
    };
};
