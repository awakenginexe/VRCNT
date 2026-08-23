import assert from "node:assert/strict";
import test from "node:test";

import {
    getTranslationProviderIcon,
    TRANSLATION_PROVIDER_METADATA,
} from "../translationProviderMetadata.js";

test("every configured translator has centralized local icon metadata", () => {
    const providerIds = [
        "CTranslate2", "Google", "Bing", "Papago", "DeepL", "DeepL_API", "Plamo_API",
        "Gemini_API", "OpenAI_API", "DeepSeek_API", "Groq_API", "OpenRouter_API", "LMStudio", "Ollama",
    ];
    for (const id of providerIds) {
        assert.equal(typeof TRANSLATION_PROVIDER_METADATA[id]?.icon, "string", id);
        assert.match(getTranslationProviderIcon(id), /^\S+$/);
    }
});
