export const createBackendSessionGuard = () => {
    let currentSessionId = 0;
    let nextSessionId = 0;

    return {
        begin: () => {
            nextSessionId += 1;
            currentSessionId = nextSessionId;
            return currentSessionId;
        },
        invalidate: (sessionId = currentSessionId) => {
            if (sessionId === currentSessionId) currentSessionId = 0;
        },
        isCurrent: (sessionId) => sessionId === currentSessionId && sessionId !== 0,
        current: () => currentSessionId,
    };
};
