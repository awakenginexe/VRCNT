export const getLiveTranscriptionReadinessPresentation = ({
    readiness = {},
    labels = {},
    formatMissingDetail = () => "",
} = {}) => {
    const state = readiness.state ?? "loading";
    const label = state === "ready"
        ? labels.ready
        : state === "not_ready"
            ? labels.notReady
            : labels.loading;
    const sourceLabels = labels.sourceLabels ?? {};
    const detail = (readiness.missing ?? [])
        .map((item) => formatMissingDetail(item, sourceLabels[item.source] ?? item.source))
        .filter(Boolean)
        .join(", ");

    return { state, label, detail };
};
