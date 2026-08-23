export const ONBOARDING_TOUR_STEPS = Object.freeze([
    { route: "live", titleKey: "live_controls_title", detailKey: "live_controls_detail" },
    { route: "live", titleKey: "live_services_title", detailKey: "live_services_detail" },
    { route: "models", titleKey: "recognition_title", detailKey: "recognition_detail" },
    { route: "translation_models", titleKey: "translation_title", detailKey: "translation_detail" },
    { route: "overlay", titleKey: "overlay_title", detailKey: "overlay_detail" },
    { route: "customize", titleKey: "customize_title", detailKey: "customize_detail" },
]);

export const canNavigateDuringOnboarding = ({ setupCompleted, onboardingActive }) => (
    setupCompleted === true && onboardingActive !== true
);

let snapshot = Object.freeze({ active: false, phase: "idle", stepIndex: 0 });
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
    publish({ active: true, phase: "setup", stepIndex: 0 });
};

export const beginProductTour = () => {
    publish({ active: true, phase: "tour", stepIndex: 0 });
};

export const setOnboardingTourStep = (stepIndex) => {
    const boundedStepIndex = Math.max(0, Math.min(ONBOARDING_TOUR_STEPS.length - 1, stepIndex));
    if (snapshot.phase !== "tour" || boundedStepIndex === snapshot.stepIndex) return;
    publish({ ...snapshot, stepIndex: boundedStepIndex });
};

export const endOnboarding = () => {
    publish({ active: false, phase: "idle", stepIndex: 0 });
};
