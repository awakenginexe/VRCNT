const toProgress = (value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return Math.min(100, Math.max(0, value));
};

export const getTranslationModelStatus = (model = {}) => {
    const progress = toProgress(model.progress);
    const downloading = model.is_pending === true || progress !== null;
    const failed = !downloading && (
        model.download_failed === true
        || model.error !== undefined
    );
    const ready = !downloading
        && model.is_downloaded === true
        && model.tokenizer_valid === true;

    let state = "not_installed";
    if (downloading) {
        state = progress === null ? "preparing" : "downloading";
    } else if (failed) {
        state = "failed";
    } else if (ready) {
        state = "ready";
    }

    return { state, progress, ready, failed };
};

export const canSelectTranslationModel = (translationActive) => (
    translationActive !== true
);
