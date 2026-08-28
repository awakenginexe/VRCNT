export const BACKEND_SPAWN_TIMEOUT_MS = 10000;
export const RUNTIME_ACTIVATION_READINESS_ENDPOINT = "/get/health/readiness";
export const RUNTIME_ACTIVATION_READINESS_TIMEOUT_MS = 10000;

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
    timeoutMs = RUNTIME_ACTIVATION_READINESS_TIMEOUT_MS,
}) => {
    let state = "idle";
    let result;
    let waiting;
    let timeoutId;
    let resolveWaiting;
    let rejectWaiting;

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
        waitForResponse: () => {
            if (!hasRequiredActivationArguments()) {
                return Promise.reject(new Error("Runtime activation context is incomplete."));
            }
            if (state === "completed") return Promise.resolve(result);
            if (state === "failed") return Promise.reject(new Error("Runtime activation readiness failed."));
            if (state === "pending") return waiting;

            state = "pending";
            waiting = new Promise((resolve, reject) => {
                resolveWaiting = resolve;
                rejectWaiting = reject;
            });
            timeoutId = setTimeout(() => {
                if (state !== "pending") return;
                state = "failed";
                rejectWaiting(new Error(`Runtime activation readiness timed out after ${timeoutMs}ms.`));
            }, timeoutMs);
            return waiting;
        },
        accept: (response) => {
            if (state !== "pending") return false;
            if (response?.endpoint !== RUNTIME_ACTIVATION_READINESS_ENDPOINT) return false;
            if (response?.status !== 200) {
                state = "failed";
                clearTimeout(timeoutId);
                rejectWaiting(new Error("Runtime activation readiness request failed."));
                return false;
            }
            if (!accepts(response)) return false;
            state = "completed";
            result = response.result;
            clearTimeout(timeoutId);
            resolveWaiting(result);
            return true;
        },
        isActive: () => hasRequiredActivationArguments(),
        isPending: () => state === "pending",
    };
};
