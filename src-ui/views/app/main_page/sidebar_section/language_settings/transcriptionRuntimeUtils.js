import { getActiveModel } from "../../engines/transcriptionProfileUi.js";

const DEFAULT_COMPUTE_TYPE_ORDER = [
    "auto",
    "int8",
    "int8_bfloat16",
    "int8_float16",
    "int8_float32",
    "bfloat16",
    "float16",
    "int16",
    "float32",
];

// Relative memory use, measured on GPU: the int8 family is within a few percent
// of each other, float16 needs roughly 1.5-2x as much.
const COMPUTE_TYPE_MEMORY = {
    auto: "auto",
    int8: "lowest",
    int8_bfloat16: "lowest",
    int8_float16: "lowest",
    int8_float32: "lowest",
    bfloat16: "high",
    float16: "high",
    int16: "medium",
    float32: "highest",
};

const ENGINE_DEVICE_RULES = {
    "Google": ["cpu"],
    "Bing": ["cpu"],
    "Whisper": ["cpu", "cuda"],
    "Whisper Thai": ["cpu", "cuda"],
    "Whisper Cloud": ["cpu"],
    "Parakeet": ["cuda"],
    "Vosk": ["cpu"],
    "SenseVoice": ["cpu"],
};

const AUTO_ONLY_ENGINES = new Set(["Google", "Bing", "Whisper Cloud", "Parakeet", "Vosk", "SenseVoice"]);

const LOCAL_TRANSCRIPTION_ENGINES = new Set([
    "Whisper",
    "Whisper Thai",
    "Vosk",
    "Parakeet",
    "SenseVoice",
]);

const loadingReadiness = (engine = "", model = "") => ({
    state: "loading",
    engine,
    model,
    reason: "",
});

const readyReadiness = (engine, model = "") => ({
    state: "ready",
    engine,
    model,
    reason: "",
});

export const getTranscriptionModelReadiness = ({
    profile,
    modelStatusesByEngine,
    cloudConfigured,
} = {}) => {
    const engine = profile?.engine ?? "";
    const model = getActiveModel(profile);

    if (!engine || !profile) return loadingReadiness(engine, model);
    if (engine === "Google" || engine === "Bing") return readyReadiness(engine, model);
    if (engine === "Whisper Cloud") {
        if (cloudConfigured === undefined) return loadingReadiness(engine, model);
        return cloudConfigured === true
            ? readyReadiness(engine, model)
            : {
                state: "not_ready",
                engine,
                model,
                reason: "The Whisper Cloud Groq credential must be configured before transcription can be enabled.",
            };
    }
    if (!LOCAL_TRANSCRIPTION_ENGINES.has(engine) || !model) return loadingReadiness(engine, model);

    const modelStatuses = modelStatusesByEngine?.[engine];
    if (!Array.isArray(modelStatuses) || modelStatuses.length === 0) return loadingReadiness(engine, model);

    if (modelStatuses.some((status) => status?.id === model && status?.is_downloaded === true)) {
        return readyReadiness(engine, model);
    }

    return {
        state: "not_ready",
        engine,
        model,
        reason: `The selected ${engine} model must be downloaded before transcription can be enabled.`,
    };
};

export const getAggregateTranscriptionReadiness = ({
    sendProfile,
    receiveProfile,
    modelStatusesByEngine,
    cloudConfigured,
} = {}) => {
    const sourceReadiness = [
        ["send", sendProfile],
        ["receive", receiveProfile],
    ].map(([source, profile]) => ({
        source,
        ...getTranscriptionModelReadiness({
            profile,
            modelStatusesByEngine,
            cloudConfigured,
        }),
    }));
    const missing = sourceReadiness
        .filter((readiness) => readiness.state === "not_ready")
        .map(({ source, engine, model, reason }) => ({ source, engine, model, reason }));

    return {
        state: missing.length > 0
            ? "not_ready"
            : sourceReadiness.some((readiness) => readiness.state === "loading")
                ? "loading"
                : "ready",
        missing,
    };
};

export const getAllowedTranscriptionDeviceModes = (engine) => {
    return ENGINE_DEVICE_RULES[engine] ?? ["cpu"];
};

export const filterDeviceMapByEngine = (deviceMap = {}, engine) => {
    const allowedModes = new Set(getAllowedTranscriptionDeviceModes(engine));

    return Object.entries(deviceMap).reduce((acc, [key, value]) => {
        if (allowedModes.has(value.device)) {
            acc[key] = value;
        }
        return acc;
    }, {});
};

export const getSelectedDeviceMode = (selectedDevice) => {
    return selectedDevice?.device ?? "cpu";
};

export const findFirstDeviceForMode = (deviceMap = {}, mode) => {
    return Object.values(deviceMap).find((device) => device.device === mode) ?? null;
};

export const sortTranscriptionComputeTypes = (computeTypes = []) => {
    const existingTypes = new Set(computeTypes);
    return DEFAULT_COMPUTE_TYPE_ORDER.filter((id) => existingTypes.has(id));
};

export const getAllowedTranscriptionComputeTypes = ({ engine, device }) => {
    if (AUTO_ONLY_ENGINES.has(engine)) {
        return ["auto"];
    }

    return sortTranscriptionComputeTypes(device?.compute_types ?? ["auto"]);
};

// Every known compute type: the ones this device can run first, the rest
// still listed so the picker can show them greyed out.
export const getTranscriptionComputeTypeChoices = (supportedTypes = []) => {
    const supported = new Set(supportedTypes);
    const choices = DEFAULT_COMPUTE_TYPE_ORDER.map((id) => ({
        id,
        memory: COMPUTE_TYPE_MEMORY[id],
        supported: supported.has(id),
    }));
    return [
        ...choices.filter((choice) => choice.supported),
        ...choices.filter((choice) => !choice.supported),
    ];
};

export const isAutoOnlyTranscriptionEngine = (engine) => {
    return AUTO_ONLY_ENGINES.has(engine);
};

export const getQuickDeviceOptions = (deviceMap = {}, engine) => {
    return getAllowedTranscriptionDeviceModes(engine).map((mode) => ({
        id: mode,
        label: mode === "cuda" ? "GPU" : "CPU",
        device: findFirstDeviceForMode(deviceMap, mode),
        disabled: findFirstDeviceForMode(deviceMap, mode) == null,
    }));
};
