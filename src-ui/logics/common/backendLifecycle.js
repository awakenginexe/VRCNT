export const BACKEND_SPAWN_TIMEOUT_MS = 10000;
export const RUNTIME_ACTIVATION_READINESS_ENDPOINT = "/get/health/readiness";

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

export const createRuntimeActivationHandshake = ({
    activationToken,
    generation,
    backendPid,
    signalReady,
}) => {
    let completed = false;

    const hasRequiredActivationArguments = () => (
        typeof activationToken === "string"
        && activationToken.length > 0
        && Number.isInteger(generation)
        && Number.isInteger(backendPid)
        && backendPid > 0
    );

    const accepts = (response) => {
        const readiness = response?.result;
        return hasRequiredActivationArguments()
            && response?.endpoint === RUNTIME_ACTIVATION_READINESS_ENDPOINT
            && response?.status === 200
            && readiness?.protocol_version === 1
            && readiness?.status === "ready"
            && readiness?.backend_pid === backendPid
            && readiness?.activation_token === activationToken
            && readiness?.generation === generation
            && (readiness?.runtime_variant === "cpu" || readiness?.runtime_variant === "cuda")
            && typeof readiness?.app_version === "string"
            && readiness.app_version.length > 0;
    };

    return {
        accept: async (response) => {
            if (completed || !accepts(response)) return false;
            await signalReady();
            completed = true;
            return true;
        },
        isActive: () => hasRequiredActivationArguments(),
    };
};
