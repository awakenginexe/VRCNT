export const getDownloadProgress = (status) => {
    if (status?.progress === null || status?.progress === undefined || status?.progress === "") return null;
    const progress = Number(status.progress);
    return Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : null;
};

export const getModelDownloadState = (status = {}) => {
    const normalizedStatus = status ?? {};
    if (normalizedStatus.downloadable === false) return "unavailable";
    if (normalizedStatus.is_cancelling === true) return "cancelling";
    if (normalizedStatus.download_failed === true) return "failed";
    if (normalizedStatus.is_downloaded === true) return "installed";
    if (normalizedStatus.is_pending === true) {
        return getDownloadProgress(normalizedStatus) === null ? "preparing" : "downloading";
    }
    return "download_required";
};
