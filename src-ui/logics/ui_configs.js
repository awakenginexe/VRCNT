export const ui_configs = {
    mic_threshold_min: 0,
    mic_threshold_max: 2000,
    speaker_threshold_min: 0,
    speaker_threshold_max: 4000,
    // Shared overlay config (used by both small and large log)
    _overlay_log_config: {
        x_pos: { step: 0.05, min: -0.5, max: 0.5 },
        y_pos: { step: 0.05, min: -0.8, max: 0.8 },
        z_pos: { step: 0.05, min: -0.5, max: 1.5 },
        x_rotation: { min: -180, max: 180, step: 5 },
        y_rotation: { min: -180, max: 180, step: 5 },
        z_rotation: { min: -180, max: 180, step: 5 },
        ui_scaling: { step: 10, min: 40, max: 200 },
    },
    get overlay_small_log() { return this._overlay_log_config; },
    get overlay_large_log() { return this._overlay_log_config; },

    // Shared overlay default settings base
    _overlay_log_default_settings_base: {
        x_pos: 0.0,
        y_pos: 0.0,
        z_pos: 0.0,
        x_rotation: 0.0,
        y_rotation: 0.0,
        z_rotation: 0.0,
        display_duration: 5,
        fadeout_duration: 2,
        opacity: 1.0,
        ui_scaling: 1.0,
        accent_color: "theme-neon-cyan",
        background_mode: "transparent_black",
    },
    get overlay_small_log_default_settings() {
        return { ...this._overlay_log_default_settings_base, tracker: "HMD" };
    },
    get overlay_large_log_default_settings() {
        return { ...this._overlay_log_default_settings_base, tracker: "LeftHand", log_order: "oldest_first" };
    },

    // Shared message format parts base
    _default_message_format_parts: {
        message: {
            prefix: "",
            suffix: ""
        },
        separator: "\n",
        translation: {
            prefix: "",
            separator: "\n",
            suffix: ""
        },
        translation_first: false,
    },
    get send_message_format_parts() { return { ...this._default_message_format_parts }; },
    get received_message_format_parts() { return { ...this._default_message_format_parts }; },

    selectable_ui_languages: [
        {id: "en", label: "English"},
        {id: "ja", label: "日本語"},
        {id: "ko", label: "한국어"},
        {id: "th", label: "ไทย"},
        {id: "zh-Hant", label: "繁體中文"},
        {id: "zh-Hans", label: "简体中文"},
    ]
};

export const translator_status = [
    { id: "CTranslate2", label: `Offline\nTranslation`, is_available: false, is_default: true },
    { id: "Google", label: "Google", is_available: false },
    { id: "Bing", label: "Bing", is_available: false },
    { id: "Papago", label: "Papago", is_available: false },
    { id: "DeepL", label: "DeepL", is_available: false },
    { id: "DeepL_API", label: `DeepL API`, is_available: false },
    { id: "Plamo_API", label: `Plamo API`, is_available: false },
    { id: "Gemini_API", label: `Gemini API`, is_available: false },
    { id: "OpenAI_API", label: `OpenAI API`, is_available: false },
    { id: "DeepSeek_API", label: `DeepSeek API`, is_available: false },
    { id: "Groq_API", label: `Groq API`, is_available: false },
    { id: "OpenRouter_API", label: `OpenRouter API`, is_available: false },
    { id: "LMStudio", label: `LMStudio`, is_available: false },
    { id: "Ollama", label: `Ollama`, is_available: false },
];

export const ctranslate2_weight_type_status = [
    {
        id: "m2m100_418M-ct2-int8",
        display_name: "M2M100 418M",
        family: "m2m100",
        capacity: "418MB",
        size_mb: 450,
        license: "MIT",
        quantization: "INT8",
        language_coverage: "75+ languages",
        is_preset: true,
        preset: "fast"
    },
    {
        id: "m2m100_1.2B-ct2-int8",
        display_name: "M2M100 1.2B",
        family: "m2m100",
        capacity: "1.2GB",
        size_mb: 1300,
        license: "MIT",
        quantization: "INT8",
        language_coverage: "75+ languages",
        is_preset: false,
        preset: null
    },
    {
        id: "nllb-200-distilled-600M-ct2-int8",
        display_name: "NLLB-200 Distilled 600M",
        family: "nllb",
        capacity: "600MB",
        size_mb: 630,
        license: "CC-BY-NC-4.0",
        quantization: "INT8",
        language_coverage: "200+ languages",
        is_preset: true,
        preset: "balanced"
    },
    {
        id: "nllb-200-distilled-1.3B-ct2-int8",
        display_name: "NLLB-200 Distilled 1.3B",
        family: "nllb",
        capacity: "1.3GB",
        size_mb: 1400,
        license: "CC-BY-NC-4.0",
        quantization: "INT8",
        language_coverage: "200+ languages",
        is_preset: true,
        preset: "good"
    },
    {
        id: "nllb-200-3.3B-ct2-int8",
        display_name: "NLLB-200 3.3B",
        family: "nllb",
        capacity: "3.3GB",
        size_mb: 3500,
        license: "CC-BY-NC-4.0",
        quantization: "INT8",
        language_coverage: "200+ languages",
        is_preset: false,
        preset: null
    },
    {
        id: "madlad400-3b-mt-ct2-int8",
        display_name: "MADLAD-400 3B MT",
        family: "madlad400",
        capacity: "3.2GB",
        size_mb: 3200,
        license: "Apache-2.0",
        quantization: "INT8",
        language_coverage: "190+ languages",
        is_preset: true,
        preset: "precise"
    },
].map(item => ({
    ...item,
    is_downloaded: false,
    tokenizer_valid: false,
    is_pending: false,
    download_failed: false,
    progress: null,
}));

export const whisper_weight_type_status = [
    { id: "tiny", capacity: "74.5MB"},
    { id: "base", capacity: "141MB"},
    { id: "small", capacity: "463MB"},
    { id: "medium", capacity: "1.42GB"},
    { id: "large-v1", capacity: "2.87GB"},
    { id: "large-v2", capacity: "2.87GB"},
    { id: "large-v3", capacity: "2.87GB"},
    { id: "large-v3-turbo-int8", capacity: "794MB"},
    { id: "large-v3-turbo", capacity: "1.58GB"},
].map(item => ({ ...item, is_downloaded: false, progress: null }));

/**
 * Get preset name for a CTranslate2 weight type.
 * Returns the preset name (fast, balanced, good, precise) or null if not a preset.
 */
export const getPresetForWeightType = (weight_type) => {
    const model = ctranslate2_weight_type_status.find(m => m.id === weight_type);
    if (model && model.is_preset) {
        return model.preset;
    }
    return null;
};

/**
 * Get display name for a CTranslate2 weight type.
 * Returns the friendly display name or the original ID if not found.
 */
export const getWeightDisplayName = (weight_type) => {
    const model = ctranslate2_weight_type_status.find(m => m.id === weight_type);
    return model ? model.display_name : weight_type;
};

/**
 * Get preset metadata for UI display.
 * Returns object with preset info including description and size.
 */
export const getPresetMetadata = (preset_name) => {
    const model = ctranslate2_weight_type_status.find(m => m.is_preset && m.preset === preset_name);
    if (!model) return null;

    const descriptions = {
        fast: "Smallest and fastest. Recommended for most users.",
        balanced: "Balanced speed and translation quality.",
        good: "Higher translation quality with increased resource usage.",
        precise: "Highest quality offline option. Requires significantly more memory and storage."
    };

    return {
        ...model,
        description: descriptions[preset_name] || "Custom model configuration."
    };
};

export const vosk_weight_type_status = [
    { id: "small-en", capacity: "40 MB / ~300 MB RAM" },
    { id: "large-en", capacity: "1.8 GB / ~16 GB RAM" },
    { id: "small-ja", capacity: "48 MB / ~300 MB RAM" },
    { id: "small-zh", capacity: "42 MB / ~300 MB RAM" },
    { id: "small-ko", capacity: "82 MB / ~300 MB RAM" },
    { id: "small-fr", capacity: "41 MB / ~300 MB RAM" },
    { id: "small-en-in", capacity: "36 MB / ~300 MB RAM" },
    { id: "small-de", capacity: "45 MB / ~300 MB RAM" },
    { id: "small-es", capacity: "39 MB / ~300 MB RAM" },
    { id: "small-pt", capacity: "31 MB / ~300 MB RAM" },
    { id: "small-ru", capacity: "45 MB / ~300 MB RAM" },
    { id: "small-tr", capacity: "35 MB / ~300 MB RAM" },
    { id: "small-vn", capacity: "32 MB / ~300 MB RAM" },
    { id: "small-it", capacity: "48 MB / ~300 MB RAM" },
    { id: "small-nl", capacity: "39 MB / ~300 MB RAM" },
    { id: "small-ca", capacity: "42 MB / ~300 MB RAM" },
    { id: "ar-mgb2", capacity: "318 MB / ~800 MB RAM" },
    { id: "el-gr", capacity: "1.1 GB / ~2 GB RAM" },
    { id: "small-fa", capacity: "53 MB / ~300 MB RAM" },
    { id: "tl-ph-generic", capacity: "320 MB / ~800 MB RAM" },
    { id: "small-uk", capacity: "133 MB / ~500 MB RAM" },
    { id: "small-kz", capacity: "58 MB / ~300 MB RAM" },
    { id: "small-sv", capacity: "289 MB / ~700 MB RAM" },
    { id: "small-eo", capacity: "42 MB / ~300 MB RAM" },
    { id: "small-hi", capacity: "42 MB / ~300 MB RAM" },
    { id: "small-cs", capacity: "44 MB / ~300 MB RAM" },
    { id: "small-pl", capacity: "50 MB / ~300 MB RAM" },
    { id: "small-uz", capacity: "49 MB / ~300 MB RAM" },
    { id: "br", capacity: "70 MB / ~300 MB RAM" },
    { id: "small-gu", capacity: "100 MB / ~300 MB RAM" },
    { id: "small-tg", capacity: "50 MB / ~300 MB RAM" },
    { id: "small-te", capacity: "58 MB / ~300 MB RAM" },
    { id: "small-ky", capacity: "49 MB / ~300 MB RAM" },
    { id: "small-ka", capacity: "45 MB / ~300 MB RAM" },
].map(item => ({ ...item, is_downloaded: false, progress: null }));

export const parakeet_weight_type_status = [
    {
        id: "parakeet-tdt-0.6b-v3",
        capacity: "ONNX / ~3 GB VRAM",
        downloadable: true,
        unavailable_reason: "",
    },
].map(item => ({
    ...item,
    is_downloaded: false,
    downloadable: item.downloadable ?? false,
    unavailable_reason: item.unavailable_reason ?? "NVIDIA ships this model as .nemo/safetensors, but this VRCNT backend only supports ONNX Parakeet exports.",
    progress: null,
}));

export const sensevoice_weight_type_status = [
    {
        id: "sensevoice-small-int8",
        capacity: "~230 MB / ~0.5 GB VRAM",
        downloadable: true,
        unavailable_reason: "",
    },
    {
        id: "sensevoice-small-fp32",
        capacity: "~938 MB / ~1 GB VRAM",
        downloadable: true,
        unavailable_reason: "",
    },
].map(item => ({
    ...item,
    is_downloaded: false,
    progress: null,
}));

export const deepl_auth_key_url = "https://www.deepl.com/ja/your-account/keys";
export const plamo_auth_key_url = "https://plamo.preferredai.jp/api";
export const gemini_auth_key_url = "https://aistudio.google.com/api-keys";
export const openai_auth_key_url = "https://platform.openai.com/api-keys";
export const deepseek_auth_key_url = "https://platform.deepseek.com/api_keys";
export const groq_auth_key_url = "https://console.groq.com/keys";
export const openrouter_auth_key_url = "https://openrouter.ai/keys";



export const vrct_document_home_url = "https://misyaguziya.github.io/VRCT-Docs";
export const vrct_document_url_chunk_faq = "docs/faq";
export const vrct_document_url_chunk_ui_guide = "docs/ui-guide";

export const generateLocalizedDocumentUrl = (lang_code = "en") => {
    const supported_languages = ["en", "ja"];

    if (supported_languages.includes(lang_code) === false) {
        lang_code = "en";
    }

    const lang_path = (lang_code === "en") ? "" : `/${lang_code}`;

    return {
        vrct_document_home_url: `${vrct_document_home_url}`,
        vrct_document_faq_url: `${vrct_document_home_url}${lang_path}/${vrct_document_url_chunk_faq}`,
        vrct_document_ui_guide_url: `${vrct_document_home_url}${lang_path}/${vrct_document_url_chunk_ui_guide}`,
    };
};


export const supporters_data_url = "https://shiinasakamoto.github.io/vrct_supporters/assets/supporters/data.json";
export const supporters_images_url = "https://ShiinaSakamoto.github.io/vrct_supporters/assets/supporters";
