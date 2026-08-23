export const TRANSCRIPTION_ENGINE_METADATA = Object.freeze({
    Google: Object.freeze({ displayName: "Google", type: "cloud", provider: "google", maxLanguages: 1, icon: "google" }),
    Bing: Object.freeze({ displayName: "Bing", type: "cloud", provider: "microsoft-bing", maxLanguages: 1, icon: "bing" }),
    Whisper: Object.freeze({ displayName: "Whisper", type: "local", provider: "openai-whisper", maxLanguages: 3, icon: "openai" }),
    "Whisper Thai": Object.freeze({ displayName: "Whisper Thai", type: "local", provider: "openai-whisper", maxLanguages: 1, icon: "openai" }),
    "Whisper Cloud": Object.freeze({ displayName: "Whisper Cloud", type: "cloud", provider: "groq", maxLanguages: 1, icon: "groq" }),
    Vosk: Object.freeze({ displayName: "Vosk", type: "local", provider: "vosk", maxLanguages: 1, icon: "vosk" }),
    Parakeet: Object.freeze({ displayName: "Parakeet", type: "local", provider: "nvidia-parakeet", maxLanguages: 3, icon: "nvidia" }),
    SenseVoice: Object.freeze({ displayName: "SenseVoice", type: "local", provider: "sensevoice", maxLanguages: 3, icon: "qwen" }),
});

const FALLBACK_METADATA = Object.freeze({
    displayName: "",
    type: "local",
    provider: "unknown",
    maxLanguages: 1,
    icon: "local",
});

export const getTranscriptionEngineMetadata = (engine) => (
    TRANSCRIPTION_ENGINE_METADATA[engine] ?? FALLBACK_METADATA
);

export const isCloudTranscriptionEngine = (engine) => (
    getTranscriptionEngineMetadata(engine).type === "cloud"
);
