export const shouldOpenFirstRunSetup = ({
    isBackendReady,
    setupCompleted,
    alreadyDecided,
}) => {
    if (isBackendReady !== true) return false;
    if (setupCompleted === true) return false;
    if (alreadyDecided === true) return false;
    return true;
};
