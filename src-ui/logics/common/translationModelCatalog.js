export const TRANSLATION_MODEL_PRESETS = Object.freeze([
    { preset: "fast", weightType: "m2m100_418M-ct2-int8" },
    { preset: "balanced", weightType: "nllb-200-distilled-600M-ct2-int8" },
    { preset: "good", weightType: "nllb-200-distilled-1.3B-ct2-int8" },
    { preset: "precise", weightType: "madlad400-3b-mt-ct2-int8" },
]);

export const getPresetTranslationModels = (models = []) => {
    const byId = new Map((Array.isArray(models) ? models : []).map((model) => [model.id, model]));
    return TRANSLATION_MODEL_PRESETS.map(({ preset, weightType }) => ({
        preset,
        weightType,
        model: byId.get(weightType) ?? { id: weightType },
    }));
};

export const getAllTranslationModels = (models = []) => (
    Array.isArray(models) ? models : []
);
