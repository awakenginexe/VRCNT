export const refreshDeepSeekStatusOnce = (refreshState, isBackendReady, refreshStatus) => {
    if (!isBackendReady || refreshState.current) return false;

    refreshState.current = true;
    refreshStatus();
    return true;
};
