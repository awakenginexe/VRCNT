import { isCloudTranscriptionEngine } from "./transcriptionEngineMetadata.js";

export const shouldNotifyCloudLanguageLimit = ({
    previousEngine,
    nextEngine,
    configuredLanguageCount,
}) => (
    Boolean(previousEngine)
    && previousEngine !== nextEngine
    && isCloudTranscriptionEngine(nextEngine)
    && Number(configuredLanguageCount) > 1
);
