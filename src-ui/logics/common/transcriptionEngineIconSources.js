import googleIconSource from "../../views/assets/transcription/google.svg";
import bingIconSource from "../../views/assets/transcription/bing.svg";
import groqIconSource from "../../views/assets/transcription/groq.svg";
import openaiIconSource from "../../views/assets/transcription/openai.svg";
import nvidiaIconSource from "../../views/assets/transcription/nvidia.svg";
import qwenIconSource from "../../views/assets/transcription/qwen.svg";
import voskIconSource from "../../views/assets/transcription/vosk.png";
import localIconSource from "../../views/assets/transcription/local.svg";

export const TRANSCRIPTION_ENGINE_ICON_SOURCES = Object.freeze({
    google: googleIconSource,
    bing: bingIconSource,
    groq: groqIconSource,
    openai: openaiIconSource,
    nvidia: nvidiaIconSource,
    qwen: qwenIconSource,
    vosk: voskIconSource,
    local: localIconSource,
});

export const getTranscriptionEngineIconSource = (engine) => (
    TRANSCRIPTION_ENGINE_ICON_SOURCES[engine] ?? localIconSource
);
