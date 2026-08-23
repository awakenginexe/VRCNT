export const shouldRestoreQuickWakeUp = ({
    isBackendReady,
    enabled,
    restoreState,
}) => {
    return isBackendReady === true
        && enabled === true
        && restoreState === "confirmed";
};
