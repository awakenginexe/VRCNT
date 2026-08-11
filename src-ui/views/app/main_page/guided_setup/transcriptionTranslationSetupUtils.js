import { getPresetTranslationModels } from "../../../../logics/common/translationModelCatalog.js";
import { getActiveModel } from "../engines/transcriptionProfileUi.js";

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

export const isWhisperTinyProfile = (profile) => (
    profile?.engine === "Whisper" && profile?.models?.Whisper === "tiny"
);

export const getActiveProfileModelOptions = (profile, statusesByEngine) => {
    const engine = profile?.engine;
    const activeModel = getActiveModel(profile);
    return toArray(statusesByEngine?.[engine])
        .filter((item) => item?.id && (
            item.id === activeModel
            || item.is_downloaded === true
            || item.is_available === true
        ))
        .map((item) => ({
            id: item.id,
            title: optionTitle(item),
        }));
};

export const normalizeSetupTranslationSelection = (selection) => {
    if (Array.isArray(selection)) return selection.filter(Boolean);
    return selection ? [selection] : [];
};

export const getSetupTranslationSelection = (selection, index, providerId) => {
    const selected = normalizeSetupTranslationSelection(selection);
    const next = [...selected];
    if (providerId) next[index] = providerId;
    else next.splice(index, 1);
    const unique = [...new Set(next.filter(Boolean))].slice(0, 2);
    if (Array.isArray(selection) && selected.length > 0) return unique;
    return unique.length > 1 ? unique : unique[0] ?? "";
};

export const getOfflinePresetOptions = (statuses, translate) => (
    getPresetTranslationModels(statuses).map(({ preset, model }) => ({
        id: preset,
        title: translate(`main_page.preset.${preset}`),
        modelId: model.id,
    }))
);

export const getAdvancedOfflineModelOptions = (statuses) => (
    toArray(statuses)
        .filter((model) => model?.id)
        .map((model) => ({
            id: model.id,
            title: model.display_name ?? model.title ?? model.label ?? model.id,
            subtitle: model.id,
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
