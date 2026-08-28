import { useEffect, useRef, useState } from "react";
import { useI18n } from "@useI18n";
import {
    confirmRuntimeSwitch,
    createRuntimeSwitchState,
    getRuntimePresentation,
    getRuntimeState,
    getRuntimeSwitchStatus,
    launchRuntimeSwitch,
    requestRuntimeSwitch,
    waitForRuntimeSwitchOutcome,
} from "@logics_common/runtimeManager.js";
import styles from "./RuntimeSettings.module.scss";

const variantLabelKey = (variant) => `config_page.others.runtime.${variant}`;

export const RuntimeSettings = () => {
    const { t } = useI18n();
    const [runtime, setRuntime] = useState(null);
    const [pendingTarget, setPendingTarget] = useState(null);
    const [isBusy, setIsBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const switchButtonRef = useRef(null);
    const cancelButtonRef = useRef(null);
    const dialogRef = useRef(null);
    const dialogWasOpenRef = useRef(false);

    useEffect(() => {
        let isCurrent = true;
        getRuntimeState().then((state) => {
            if (isCurrent) setRuntime(state);
        });
        return () => {
            isCurrent = false;
        };
    }, []);

    const presentation = runtime ? getRuntimePresentation(runtime) : null;
    const switchState = createRuntimeSwitchState({ isBusy, pendingTarget });
    const currentLabel = presentation?.currentVariant
        ? t(variantLabelKey(presentation.currentVariant))
        : null;
    const targetLabel = presentation?.targetVariant
        ? t(variantLabelKey(presentation.targetVariant))
        : null;

    const requestSwitch = () => {
        try {
            const request = requestRuntimeSwitch({
                runtime,
                targetVariant: presentation?.targetVariant,
            });
            setError("");
            setNotice("");
            setPendingTarget(request.targetVariant);
        } catch {
            setError(t("config_page.others.runtime.recovery"));
        }
    };

    const confirmSwitch = async () => {
        setIsBusy(true);
        setError("");
        try {
            await confirmRuntimeSwitch({
                runtime,
                targetVariant: pendingTarget,
                launch: launchRuntimeSwitch,
                getStatus: getRuntimeSwitchStatus,
            });
            setNotice(t("config_page.others.runtime.switch_accepted"));
            setPendingTarget(null);
            const outcome = await waitForRuntimeSwitchOutcome({
                getStatus: getRuntimeSwitchStatus,
                refreshRuntime: getRuntimeState,
            });
            setRuntime(outcome.runtime);
            if (outcome.status !== "succeeded") setError(t("config_page.others.runtime.switch_failed"));
            else setNotice(t("config_page.others.runtime.switch_complete"));
            setIsBusy(false);
        } catch {
            setRuntime(await getRuntimeState());
            setPendingTarget(null);
            setError(t("config_page.others.runtime.switch_failed"));
        } finally {
            setIsBusy(false);
        }
    };

    useEffect(() => {
        if (!pendingTarget) {
            if (dialogWasOpenRef.current) switchButtonRef.current?.focus();
            dialogWasOpenRef.current = false;
            return undefined;
        }
        dialogWasOpenRef.current = true;
        const dialog = dialogRef.current;
        const focusables = () => [...dialog.querySelectorAll("button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])")];
        const handleKeyDown = (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                setPendingTarget(null);
                return;
            }
            if (event.key !== "Tab") return;
            const controls = focusables();
            if (controls.length === 0) return;
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        dialog.addEventListener("keydown", handleKeyDown);
        cancelButtonRef.current?.focus();
        return () => dialog.removeEventListener("keydown", handleKeyDown);
    }, [pendingTarget]);

    return (
        <section className={styles.card} aria-busy={switchState.isBusy}>
            <div className={styles.content}>
                <h3>{t("config_page.others.runtime.label")}</h3>
                <p>{t("config_page.others.runtime.desc")}</p>
                {!presentation && <p role="status">{t("config_page.others.runtime.loading")}</p>}
                {presentation?.status === "active" && (
                    <p className={styles.current} role="status">
                        {t("config_page.others.runtime.current", { variant: currentLabel })}
                    </p>
                )}
                {presentation?.status === "recovery" && (
                    <p className={styles.recovery} role="alert">
                        {t("config_page.others.runtime.recovery")}
                    </p>
                )}
                <p className={styles.restart_notice}>{t("config_page.others.runtime.restart_notice")}</p>
                {error && <p className={styles.error} role="alert">{error}</p>}
                {notice && <p className={styles.notice} role="status">{notice}</p>}
            </div>
            <button
                ref={switchButtonRef}
                className={styles.switch_button}
                type="button"
                onClick={requestSwitch}
                disabled={!presentation?.canSwitch || switchState.controlsDisabled}
            >
                {targetLabel
                    ? t("config_page.others.runtime.switch_to", { variant: targetLabel })
                    : t("config_page.others.runtime.loading")}
            </button>
            {pendingTarget && (
                <section
                    ref={dialogRef}
                    className={styles.confirmation}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="runtime-switch-confirmation-title"
                    aria-describedby="runtime-switch-confirmation-detail"
                >
                    <h4 id="runtime-switch-confirmation-title">
                        {t("config_page.others.runtime.confirmation_title")}
                    </h4>
                    <p id="runtime-switch-confirmation-detail">
                        {t("config_page.others.runtime.confirmation_detail", {
                            variant: t(variantLabelKey(pendingTarget)),
                        })}
                    </p>
                    <div className={styles.confirmation_actions}>
                        <button ref={cancelButtonRef} type="button" onClick={() => setPendingTarget(null)} disabled={switchState.controlsDisabled}>
                            {t("config_page.others.runtime.cancel")}
                        </button>
                        <button type="button" onClick={confirmSwitch} disabled={switchState.controlsDisabled}>
                            {t("config_page.others.runtime.confirm")}
                        </button>
                    </div>
                </section>
            )}
        </section>
    );
};
