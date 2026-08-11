import { getPresetTranslationModels } from "../../../../logics/common/translationModelCatalog.js";

const toArray = (value) => (
    Array.isArray(value) ? value : Object.values(value ?? {})
);

const optionTitle = (item) => (
    item?.title ?? item?.label ?? item?.display_name ?? item?.id
);

export const getSetupEngineOptions = (engineList) => (
    toArray(engineList)
        .map((item) => {
            if (typeof item === "string") return { id: item, title: item };
            if (!item || typeof item !== "object" || typeof item.id !== "string") return null;
            return { id: item.id, title: optionTitle(item) };
        })
        .filter(Boolean)
);

export const getSetupTranslationProviderOptions = (engineList) => (
    toArray(engineList)
        .filter((item) => item?.is_available === true && typeof item.id === "string")
        .map((item) => ({ id: item.id, title: optionTitle(item) }))
);

export const getOfflinePresetOptions = (statuses, translate) => (
    getPresetTranslationModels(statuses).map(({ preset, model }) => ({
        id: preset,
        title: translate(`main_page.preset.${preset}`),
        modelId: model.id,
    }))
);

export const applyDefaultTranscriptionEngine = (
    engine,
    setSendProfile,
    setReceiveProfile,
) => {
    const patch = { engine };
    setSendProfile(patch);
    setReceiveProfile(patch);
};
