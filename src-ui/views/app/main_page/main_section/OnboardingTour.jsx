import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useI18n } from "@useI18n";
import { useOnboarding } from "@logics_configs";
import { useIsOpenedConfigPage, useNotificationStatus } from "@logics_common";
import {
    ONBOARDING_TOUR_ROUTE_AUTHORITY,
    ONBOARDING_TOUR_STEPS,
    acknowledgeOnboardingCompletion,
    beginOnboardingCompletion,
    cancelOnboardingCompletion,
    getOnboardingTourSnapshot,
    requestOnboardingTourTransition,
    subscribeToOnboardingTour,
} from "@logics_common/onboardingTourState.js";
import { useStdoutToPython } from "@useStdoutToPython";
import { useStore_ExperienceRoute } from "@store";
import styles from "../guided_setup/GuidedSetup.module.scss";

const SETUP_COMPLETION_TIMEOUT_MS = 8000;
const TOUR_SPOTLIGHT_PADDING = 12;

export const OnboardingTour = () => {
    const { t } = useI18n();
    const { currentSetupCompleted } = useOnboarding();
    const { asyncStdoutToPython } = useStdoutToPython();
    const { setIsOpenedConfigPage } = useIsOpenedConfigPage();
    const { showNotification_Success, showNotification_Error } = useNotificationStatus();
    const { currentExperienceRoute, updateExperienceRoute } = useStore_ExperienceRoute();
    const {
        active,
        phase,
        stepIndex,
        completionPending,
        completionNotification,
    } = useSyncExternalStore(
        subscribeToOnboardingTour,
        getOnboardingTourSnapshot,
        getOnboardingTourSnapshot,
    );
    const [completionError, setCompletionError] = useState("");
    const [isSkipConfirmationOpen, setIsSkipConfirmationOpen] = useState(false);
    const [spotlightRect, setSpotlightRect] = useState(null);
    const cancelSkipButtonRef = useRef(null);
    const dialogRef = useRef(null);
    const currentStep = ONBOARDING_TOUR_STEPS[stepIndex];
    const isCompletingSetup = completionPending;

    useLayoutEffect(() => {
        if (!active || phase !== "tour" || !currentStep?.target) {
            setSpotlightRect(null);
            return undefined;
        }

        let animationFrameId = null;
        const getSpotlightTarget = () => (
            document.querySelector(`[data-onboarding-target="${currentStep.target}"]`)
            ?? document.querySelector('[data-onboarding-target="tour-workspace"]')
        );
        const target = getSpotlightTarget();
        target?.scrollIntoView?.({
            block: "center",
            inline: "nearest",
            behavior: "auto",
        });
        const measureSpotlight = () => {
            const target = getSpotlightTarget();
            if (!target) {
                setSpotlightRect(null);
                return;
            }

            const rect = target.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const left = Math.max(0, Math.min(viewportWidth, rect.left - TOUR_SPOTLIGHT_PADDING));
            const top = Math.max(0, Math.min(viewportHeight, rect.top - TOUR_SPOTLIGHT_PADDING));
            const right = Math.max(left, Math.min(viewportWidth, rect.right + TOUR_SPOTLIGHT_PADDING));
            const bottom = Math.max(top, Math.min(viewportHeight, rect.bottom + TOUR_SPOTLIGHT_PADDING));

            if (right <= left || bottom <= top) {
                setSpotlightRect(null);
                return;
            }

            const nextRect = { top, right, bottom, left, width: right - left, height: bottom - top };
            setSpotlightRect((previousRect) => (
                previousRect
                && previousRect.top === nextRect.top
                && previousRect.right === nextRect.right
                && previousRect.bottom === nextRect.bottom
                && previousRect.left === nextRect.left
                    ? previousRect
                    : nextRect
            ));
        };
        const scheduleSpotlightMeasurement = () => {
            if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId);
            animationFrameId = window.requestAnimationFrame(measureSpotlight);
        };

        scheduleSpotlightMeasurement();
        window.addEventListener("resize", scheduleSpotlightMeasurement);
        window.addEventListener("scroll", scheduleSpotlightMeasurement, true);

        return () => {
            if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId);
            window.removeEventListener("resize", scheduleSpotlightMeasurement);
            window.removeEventListener("scroll", scheduleSpotlightMeasurement, true);
        };
    }, [active, currentExperienceRoute.data, currentStep?.target, phase]);

    useEffect(() => {
        if (!completionPending) return;
        const setupCompletionAcknowledged = currentSetupCompleted.data === true;
        if (!setupCompletionAcknowledged) return;

        const acknowledgedRoute = acknowledgeOnboardingCompletion();
        if (!acknowledgedRoute) return;
        if (completionNotification) {
            showNotification_Success(
                t("main_page.guided_setup.complete_notification"),
                { category_id: "guided_setup_complete" },
            );
        }
        setCompletionError("");
        setIsOpenedConfigPage(false);
        updateExperienceRoute(acknowledgedRoute);
    }, [
        completionNotification,
        completionPending,
        currentSetupCompleted.data,
        setIsOpenedConfigPage,
        showNotification_Success,
        t,
        updateExperienceRoute,
    ]);

    useEffect(() => {
        if (!completionPending || phase !== "tour") return undefined;

        const timeoutId = window.setTimeout(() => {
            cancelOnboardingCompletion();
            setCompletionError(t("main_page.guided_setup.setup_completion_error"));
        }, SETUP_COMPLETION_TIMEOUT_MS);

        return () => window.clearTimeout(timeoutId);
    }, [completionPending, phase, t]);

    useEffect(() => {
        if (!isSkipConfirmationOpen) return undefined;

        const handleKeyDown = (event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setIsSkipConfirmationOpen(false);
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [isSkipConfirmationOpen]);

    useEffect(() => {
        if (!active || phase !== "tour") return;
        if (isSkipConfirmationOpen) {
            cancelSkipButtonRef.current?.focus();
        } else {
            dialogRef.current?.focus();
        }
    }, [active, isSkipConfirmationOpen, phase, stepIndex]);

    if (!active || phase !== "tour" || !currentStep) return null;

    const moveForward = () => {
        const nextRoute = requestOnboardingTourTransition({
            authority: ONBOARDING_TOUR_ROUTE_AUTHORITY,
            stepIndex: stepIndex + 1,
        });
        if (!nextRoute) return;
        setIsOpenedConfigPage(false);
        updateExperienceRoute(nextRoute);
    };

    const moveBackward = () => {
        const previousRoute = requestOnboardingTourTransition({
            authority: ONBOARDING_TOUR_ROUTE_AUTHORITY,
            stepIndex: stepIndex - 1,
        });
        if (!previousRoute) return;
        setIsOpenedConfigPage(false);
        updateExperienceRoute(previousRoute);
    };

    const completeSetup = async (showSuccessNotification) => {
        if (!beginOnboardingCompletion({ showSuccessNotification })) return;

        setCompletionError("");
        const transportResult = await asyncStdoutToPython("/set/data/setup_completed", true);

        if (!transportResult.ok) {
            cancelOnboardingCompletion();
            setCompletionError(t("main_page.guided_setup.setup_completion_error"));
            showNotification_Error(
                t("blocking_operation.backend_unavailable"),
                { category_id: "guided_setup_completion_failed" },
            );
        }
    };

    const finishTour = () => completeSetup(true);
    const confirmSkipTour = () => {
        setIsSkipConfirmationOpen(false);
        completeSetup(false);
    };
    const titleId = "onboarding-tour-title";
    const detailId = "onboarding-tour-detail";

    return (
        <div className={styles.tour_backdrop}>
            <div className={styles.tour_spotlight_layers} aria-hidden="true">
                {spotlightRect ? (
                    <>
                        <div
                            className={styles.tour_dimming_layer}
                            style={{ top: 0, right: 0, left: 0, height: spotlightRect.top }}
                        />
                        <div
                            className={styles.tour_dimming_layer}
                            style={{ top: spotlightRect.top, left: 0, width: spotlightRect.left, height: spotlightRect.height }}
                        />
                        <div
                            className={styles.tour_dimming_layer}
                            style={{ top: spotlightRect.top, right: 0, left: spotlightRect.right, height: spotlightRect.height }}
                        />
                        <div
                            className={styles.tour_dimming_layer}
                            style={{ top: spotlightRect.bottom, right: 0, bottom: 0, left: 0 }}
                        />
                        <div
                            className={styles.tour_spotlight}
                            style={{
                                top: spotlightRect.top,
                                left: spotlightRect.left,
                                width: spotlightRect.width,
                                height: spotlightRect.height,
                            }}
                        />
                    </>
                ) : (
                    <div className={styles.tour_dimming_layer} style={{ inset: 0 }} />
                )}
            </div>
            <section
                ref={dialogRef}
                className={styles.tour_dialog}
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
                aria-labelledby={titleId}
                aria-describedby={detailId}
            >
                {isSkipConfirmationOpen ? (
                    <>
                        <p className={styles.eyebrow}>{t("main_page.guided_setup.skip_confirmation_eyebrow")}</p>
                        <h2 id={titleId}>{t("main_page.guided_setup.skip_confirmation_title")}</h2>
                        <p id={detailId}>{t("main_page.guided_setup.skip_confirmation_detail")}</p>
                        <div className={styles.tour_actions}>
                            <button
                                ref={cancelSkipButtonRef}
                                type="button"
                                className={styles.secondary_button}
                                onClick={() => setIsSkipConfirmationOpen(false)}
                            >
                                {t("main_page.guided_setup.skip_confirmation_cancel")}
                            </button>
                            <button
                                type="button"
                                className={styles.primary_button}
                                onClick={confirmSkipTour}
                            >
                                {t("main_page.guided_setup.skip_confirmation_confirm")}
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <div className={styles.tour_heading}>
                            <p className={styles.eyebrow}>{t("main_page.onboarding_tour.eyebrow")}</p>
                            <span className={styles.step_badge}>
                                {t("main_page.onboarding_tour.step_count", {
                                    current: stepIndex + 1,
                                    total: ONBOARDING_TOUR_STEPS.length,
                                })}
                            </span>
                        </div>
                        <h2 id={titleId}>{t(`main_page.onboarding_tour.${currentStep.titleKey}`)}</h2>
                        <p id={detailId}>{t(`main_page.onboarding_tour.${currentStep.detailKey}`)}</p>
                        {completionError && <p className={styles.tour_error} role="alert">{completionError}</p>}
                        <div className={styles.tour_actions}>
                            <button
                                type="button"
                                className={styles.secondary_button}
                                disabled={stepIndex === 0 || isCompletingSetup}
                                onClick={moveBackward}
                            >
                                {t("main_page.guided_setup.back")}
                            </button>
                            <button
                                type="button"
                                className={styles.secondary_button}
                                disabled={isCompletingSetup}
                                onClick={() => setIsSkipConfirmationOpen(true)}
                            >
                                {t("main_page.guided_setup.skip")}
                            </button>
                            {stepIndex === ONBOARDING_TOUR_STEPS.length - 1 ? (
                                <button
                                    type="button"
                                    className={styles.primary_button}
                                    disabled={isCompletingSetup}
                                    onClick={finishTour}
                                >
                                    {t("main_page.guided_setup.finish")}
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className={styles.primary_button}
                                    disabled={isCompletingSetup}
                                    onClick={moveForward}
                                >
                                    {t("main_page.guided_setup.continue")}
                                </button>
                            )}
                        </div>
                    </>
                )}
            </section>
        </div>
    );
};
