import googleIconSource from "../../views/assets/transcription/google.svg";
import bingIconSource from "../../views/assets/transcription/bing.svg";
import openaiIconSource from "../../views/assets/transcription/openai.svg";
import groqIconSource from "../../views/assets/transcription/groq.svg";
import ctranslate2IconSource from "../../views/assets/translation/ctranslate2.svg";
import papagoIconSource from "../../views/assets/translation/papago.png";
import deeplIconSource from "../../views/assets/translation/deepl.png";
import plamoIconSource from "../../views/assets/translation/plamo.png";
import geminiIconSource from "../../views/assets/translation/gemini.svg";
import deepseekIconSource from "../../views/assets/translation/deepseek.svg";
import openrouterIconSource from "../../views/assets/translation/openrouter.svg";
import lmstudioIconSource from "../../views/assets/translation/lmstudio.svg";
import ollamaIconSource from "../../views/assets/translation/ollama.svg";
import localIconSource from "../../views/assets/transcription/local.svg";

export const TRANSLATION_PROVIDER_ICON_SOURCES = Object.freeze({
    ctranslate2: ctranslate2IconSource,
    google: googleIconSource,
    bing: bingIconSource,
    papago: papagoIconSource,
    deepl: deeplIconSource,
    plamo: plamoIconSource,
    gemini: geminiIconSource,
    openai: openaiIconSource,
    deepseek: deepseekIconSource,
    groq: groqIconSource,
    openrouter: openrouterIconSource,
    lmstudio: lmstudioIconSource,
    ollama: ollamaIconSource,
    local: localIconSource,
});

export const getTranslationProviderIconSource = (provider) => (
    TRANSLATION_PROVIDER_ICON_SOURCES[provider] ?? localIconSource
);
