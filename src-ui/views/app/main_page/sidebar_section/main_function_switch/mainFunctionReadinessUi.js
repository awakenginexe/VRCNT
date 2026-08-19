export const getTranscriptionSwitchReadiness = ({
    readiness = {},
    isBackendReady = false,
    backendWaitingCopy = "",
    localModelCopy = "",
    cloudCredentialCopy = "",
} = {}) => {
    const isModelNotReady = readiness.state === "not_ready";
    const disabledReason = !isBackendReady
        ? backendWaitingCopy
        : isModelNotReady
            ? readiness.engine === "Whisper Cloud" ? cloudCredentialCopy : localModelCopy
            : "";

    return {
        isDisabled: !isBackendReady || isModelNotReady,
        disabledReason,
        disabledDetail: disabledReason,
    };
};
