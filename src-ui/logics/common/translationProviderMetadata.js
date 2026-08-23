export const TRANSLATION_PROVIDER_METADATA = Object.freeze({
    CTranslate2: Object.freeze({ icon: "ctranslate2" }),
    Google: Object.freeze({ icon: "google" }),
    Bing: Object.freeze({ icon: "bing" }),
    Papago: Object.freeze({ icon: "papago" }),
    DeepL: Object.freeze({ icon: "deepl" }),
    DeepL_API: Object.freeze({ icon: "deepl" }),
    Plamo_API: Object.freeze({ icon: "plamo" }),
    Gemini_API: Object.freeze({ icon: "gemini" }),
    OpenAI_API: Object.freeze({ icon: "openai" }),
    DeepSeek_API: Object.freeze({ icon: "deepseek" }),
    Groq_API: Object.freeze({ icon: "groq" }),
    OpenRouter_API: Object.freeze({ icon: "openrouter" }),
    LMStudio: Object.freeze({ icon: "lmstudio" }),
    Ollama: Object.freeze({ icon: "ollama" }),
});

export const getTranslationProviderMetadata = (provider) => (
    TRANSLATION_PROVIDER_METADATA[provider] ?? { icon: "local" }
);

export const getTranslationProviderIcon = (provider) => (
    getTranslationProviderMetadata(provider).icon
);
