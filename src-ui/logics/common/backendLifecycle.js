export const BACKEND_SPAWN_TIMEOUT_MS = 10000;

const BACKEND_SPAWN_TIMEOUT = Symbol("backend-spawn-timeout");

export const spawnBackendWithTimeout = async (
    spawn,
    timeoutMs = BACKEND_SPAWN_TIMEOUT_MS,
) => {
    let timeoutId;
    try {
        const timeoutPromise = new Promise((resolve) => {
            timeoutId = setTimeout(
                () => resolve(BACKEND_SPAWN_TIMEOUT),
                timeoutMs,
            );
        });
        const result = await Promise.race([
            Promise.resolve().then(spawn),
            timeoutPromise,
        ]);
        if (result === BACKEND_SPAWN_TIMEOUT) {
            throw new Error(
                `Backend sidecar did not respond within ${timeoutMs}ms.`,
            );
        }
        return result;
    } finally {
        clearTimeout(timeoutId);
    }
};

export const createBackendProcessLifecycle = () => {
    let stopRequested = false;

    return {
        requestStop: () => {
            stopRequested = true;
        },
        wasIntentionallyStopped: () => stopRequested,
    };
};
