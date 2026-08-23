import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useI18n } from "@useI18n";
import { useOnboarding } from "@logics_configs";
import { useIsOpenedConfigPage, useNotificationStatus } from "@logics_common";
import {
    ONBOARDING_TOUR_STEPS,
    endOnboarding,
    getOnboardingTourSnapshot,
    setOnboardingTourStep,
    subscribeToOnboardingTour,
} from "@logics_common/onboardingTourState.js";
import { useStdoutToPython } from "@useStdoutToPython";
import { useStore_ExperienceRoute } from "@store";
import styles from "../guided_setup/GuidedSetup.module.scss";

const SETUP_COMPLETION_TIMEOUT_MS = 8000;

export const OnboardingTour = () => {
    const { t } = useI18n();
    const { currentSetupCompleted } = useOnboarding();
    const { asyncStdoutToPython } = useStdoutToPython();
    const { setIsOpenedConfigPage } = useIsOpenedConfigPage();
    const { showNotification_Success, showNotification_Error } = useNotificationStatus();
    const { updateExperienceRoute } = useStore_ExperienceRoute();
    const { active, phase, stepIndex } = useSyncExternalStore(
        subscribeToOnboardingTour,
        getOnboardingTourSnapshot,
        getOnboardingTourSnapshot,
    );
    const [completionIntent, setCompletionIntent] = useState(null);
    const [completionError, setCompletionError] = useState("");
    const [isSkipConfirmationOpen, setIsSkipConfirmationOpen] = useState(false);
    const cancelSkipButtonRef = useRef(null);
    const dialogRef = useRef(null);
    const completionRequestRef = useRef(false);
    const currentStep = ONBOARDING_TOUR_STEPS[stepIndex];
    const isCompletingSetup = completionIntent !== null;

    useEffect(() => {
        if (!completionIntent) return;
        const setupCompletionAcknowledged = currentSetupCompleted.data === true;
        if (!setupCompletionAcknowledged) return;

        if (completionIntent.showSuccessNotification) {
            showNotification_Success(
                t("main_page.guided_setup.complete_notification"),
                { category_id: "guided_setup_complete" },
            );
        }
        setCompletionIntent(null);
        setCompletionError("");
        completionRequestRef.current = false;
        endOnboarding();
        setIsOpenedConfigPage(false);
        updateExperienceRoute("live");
    }, [
        completionIntent,
        currentSetupCompleted.data,
        setIsOpenedConfigPage,
        showNotification_Success,
        t,
        updateExperienceRoute,
    ]);

    useEffect(() => {
        if (!completionIntent) return undefined;

        const timeoutId = window.setTimeout(() => {
            completionRequestRef.current = false;
            setCompletionIntent(null);
            setCompletionError(t("main_page.guided_setup.setup_completion_error"));
        }, SETUP_COMPLETION_TIMEOUT_MS);

        return () => window.clearTimeout(timeoutId);
    }, [completionIntent, t]);

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
        const nextStep = ONBOARDING_TOUR_STEPS[stepIndex + 1];
        if (!nextStep) return;
        setOnboardingTourStep(stepIndex + 1);
        setIsOpenedConfigPage(false);
        updateExperienceRoute(nextStep.route);
    };

    const moveBackward = () => {
        const previousStep = ONBOARDING_TOUR_STEPS[stepIndex - 1];
        if (!previousStep) return;
        setOnboardingTourStep(stepIndex - 1);
        setIsOpenedConfigPage(false);
        updateExperienceRoute(previousStep.route);
    };

    const completeSetup = async (showSuccessNotification) => {
        if (completionRequestRef.current) return;
        completionRequestRef.current = true;

        setCompletionError("");
        setCompletionIntent({ showSuccessNotification });
        const transportResult = await asyncStdoutToPython("/set/data/setup_completed", true);

        if (!transportResult.ok) {
            completionRequestRef.current = false;
            setCompletionIntent(null);
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
