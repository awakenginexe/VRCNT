export const ONBOARDING_TOUR_STEPS = Object.freeze([
    { route: "live", titleKey: "live_controls_title", detailKey: "live_controls_detail" },
    { route: "live", titleKey: "live_services_title", detailKey: "live_services_detail" },
    { route: "models", titleKey: "recognition_title", detailKey: "recognition_detail" },
    { route: "translation_models", titleKey: "translation_title", detailKey: "translation_detail" },
    { route: "overlay", titleKey: "overlay_title", detailKey: "overlay_detail" },
    { route: "customize", titleKey: "customize_title", detailKey: "customize_detail" },
]);

export const ONBOARDING_TOUR_ROUTE_AUTHORITY = Symbol("onboarding-tour-overlay");

export const canNavigateDuringOnboarding = ({ setupCompleted, onboardingActive }) => (
    setupCompleted === true && onboardingActive !== true
);

let snapshot = Object.freeze({
    active: false,
    phase: "idle",
    stepIndex: 0,
    completionPending: false,
    completionNotification: false,
});
const listeners = new Set();

const publish = (nextSnapshot) => {
    snapshot = Object.freeze(nextSnapshot);
    listeners.forEach((listener) => listener());
};

export const getOnboardingTourSnapshot = () => snapshot;

export const subscribeToOnboardingTour = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

export const beginOnboarding = () => {
    if (snapshot.active && snapshot.phase === "setup") return;
    publish({
        active: true,
        phase: "setup",
        stepIndex: 0,
        completionPending: false,
        completionNotification: false,
    });
};

export const beginProductTour = () => {
    if (!snapshot.active || snapshot.completionPending) return null;
    publish({ ...snapshot, phase: "tour", stepIndex: 0 });
    return ONBOARDING_TOUR_STEPS[0].route;
};

export const requestOnboardingTourTransition = ({ authority, stepIndex }) => {
    if (authority !== ONBOARDING_TOUR_ROUTE_AUTHORITY) return null;
    if (!snapshot.active || snapshot.phase !== "tour" || snapshot.completionPending) return null;
    const boundedStepIndex = Math.max(0, Math.min(ONBOARDING_TOUR_STEPS.length - 1, stepIndex));
    if (boundedStepIndex === snapshot.stepIndex) return null;
    publish({ ...snapshot, stepIndex: boundedStepIndex });
    return ONBOARDING_TOUR_STEPS[boundedStepIndex].route;
};

export const beginOnboardingCompletion = ({ showSuccessNotification = false } = {}) => {
    if (!snapshot.active || snapshot.completionPending) return false;
    publish({
        ...snapshot,
        completionPending: true,
        completionNotification: showSuccessNotification === true,
    });
    return true;
};

export const cancelOnboardingCompletion = () => {
    if (!snapshot.completionPending) return false;
    publish({ ...snapshot, completionPending: false, completionNotification: false });
    return true;
};

export const acknowledgeOnboardingCompletion = () => {
    if (!snapshot.active || !snapshot.completionPending) return null;
    publish({
        active: false,
        phase: "idle",
        stepIndex: 0,
        completionPending: false,
        completionNotification: false,
    });
    return "live";
};
