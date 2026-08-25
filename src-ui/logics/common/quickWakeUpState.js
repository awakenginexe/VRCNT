export const shouldRestoreQuickWakeUp = ({
    isBackendReady,
    isInitializationComplete = true,
    enabled,
    restoreState,
}) => {
    return isBackendReady === true
        && isInitializationComplete === true
        && enabled === true
        && restoreState === "confirmed";
};

export const advanceQuickWakeUpRestoreState = ({
    isBackendReady,
    isInitializationComplete = true,
    enabled,
    restoreState,
}) => {
    if (isBackendReady !== true) {
        return {
            restoreState: "unconfirmed",
            shouldRequest: false,
        };
    }

    const confirmedRestoreState = restoreState === "unconfirmed"
        ? "confirmed"
        : restoreState;
    const shouldRequest = shouldRestoreQuickWakeUp({
        isBackendReady,
        isInitializationComplete,
        enabled,
        restoreState: confirmedRestoreState,
    });

    return {
        restoreState: shouldRequest ? "requested" : confirmedRestoreState,
        shouldRequest,
    };
};

export const QUICK_WAKE_UP_RESTORE_FEATURES = [
    "translation",
    "transcription_send",
    "transcription_receive",
];

const createFeatureState = (value = false) => Object.fromEntries(
    QUICK_WAKE_UP_RESTORE_FEATURES.map((feature) => [feature, value]),
);

export const createQuickWakeUpRestoreState = () => ({
    generation: 0,
    phase: "idle",
    requested: createFeatureState(),
    restoring: createFeatureState(),
    ready: createFeatureState(),
    failed: {},
});

const normalizeFeatureState = (value, fallback = false) => {
    const source = value && typeof value === "object" ? value : {};
    return Object.fromEntries(
        QUICK_WAKE_UP_RESTORE_FEATURES.map((feature) => [
            feature,
            typeof source[feature] === "boolean" ? source[feature] : fallback,
        ]),
    );
};

export const beginQuickWakeUpRestore = (currentState, generation) => ({
    generation,
    phase: "requested",
    requested: createFeatureState(true),
    restoring: createFeatureState(false),
    ready: createFeatureState(false),
    failed: {},
});

export const applyQuickWakeUpRestoreEvent = (currentState, event = {}) => {
    const previous = currentState ?? createQuickWakeUpRestoreState();
    const phase = ["requested", "restoring", "ready", "failed"].includes(event.phase)
        ? event.phase
        : previous.phase;
    const nextGeneration = Number.isInteger(event.generation)
        ? event.generation
        : previous.generation;
    const requested = event.requested && typeof event.requested === "object"
        ? normalizeFeatureState(event.requested)
        : previous.requested;
    const restoring = event.restoring && typeof event.restoring === "object"
        ? normalizeFeatureState(event.restoring)
        : phase === "restoring"
            ? requested
            : createFeatureState(false);
    const ready = event.ready && typeof event.ready === "object"
        ? normalizeFeatureState(event.ready)
        : previous.ready;
    const failed = event.failed && typeof event.failed === "object"
        ? event.failed
        : previous.failed;

    return {
        generation: nextGeneration,
        phase,
        requested,
        restoring,
        ready,
        failed,
    };
};

export const resetQuickWakeUpRestore = () => createQuickWakeUpRestoreState();
