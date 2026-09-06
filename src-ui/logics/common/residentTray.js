export const RESIDENT_ACTIVATE_EVENT = "vrcnt://resident-activate";
export const RESIDENT_CLOSE_REQUESTED_EVENT = "vrcnt://resident-close-requested";
export const RUNTIME_SWITCH_REQUESTED_EVENT = "vrcnt://runtime-switch-requested";

export const RESIDENT_BACKEND_SHUTDOWN_DELAY_MS = 2000;
export const RESIDENT_STARTUP_CHECK_TIMEOUT_MS = 2000;

export const resolveWithTimeout = async (operation, timeoutMs, fallback) => {
    let timeoutId;
    try {
        const timeoutPromise = new Promise((resolve) => {
            timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
        });
        return await Promise.race([
            Promise.resolve().then(operation),
            timeoutPromise,
        ]);
    } catch {
        return fallback;
    } finally {
        clearTimeout(timeoutId);
    }
};

export const resolveResidentStartup = async ({
    isBackgroundStartup,
    consumeResidentActivation,
    timeoutMs = RESIDENT_STARTUP_CHECK_TIMEOUT_MS,
}) => {
    const backgroundStartup = await resolveWithTimeout(
        isBackgroundStartup,
        timeoutMs,
        null,
    );
    if (backgroundStartup !== true) return true;

    const activationPending = await resolveWithTimeout(
        consumeResidentActivation,
        timeoutMs,
        false,
    );
    return activationPending === true;
};
