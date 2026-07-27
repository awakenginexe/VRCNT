export const getModelRowState = (option, selectionPending = false) => {
    if (option.downloadable === false || option.disabled === true) return "unavailable";
    if (option.is_pending || option.progress !== null) return "downloading";
    if (!option.is_downloaded) return "download_required";
    if (selectionPending) return "selection_pending";
    return "installed";
};

export const resolvePendingModelSelection = (pendingModelId, options) => {
    if (!pendingModelId) return { action: "none", modelId: null };
    const option = options.find((item) => item.id === pendingModelId);
    if (!option) return { action: "clear", modelId: null };
    if (option.is_pending || option.progress !== null) {
        return { action: "wait", modelId: pendingModelId };
    }
    if (option.is_downloaded) return { action: "select", modelId: pendingModelId };
    return { action: "clear", modelId: null };
};
