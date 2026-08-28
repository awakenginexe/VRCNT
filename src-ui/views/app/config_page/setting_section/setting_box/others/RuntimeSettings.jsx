import { useEffect, useState } from "react";
import { useI18n } from "@useI18n";
import {
    confirmRuntimeSwitch,
    createRuntimeSwitchState,
    getRuntimePresentation,
    getRuntimeState,
    launchRuntimeSwitch,
    requestRuntimeSwitch,
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
            });
            setNotice(t("config_page.others.runtime.switch_started"));
            setPendingTarget(null);
        } catch {
            setError(t("config_page.others.runtime.switch_failed"));
            setIsBusy(false);
        }
    };

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
                        <button type="button" onClick={() => setPendingTarget(null)} disabled={switchState.controlsDisabled}>
                            {t("config_page.others.runtime.cancel")}
                        </button>
                        <button type="button" onClick={confirmSwitch} disabled={switchState.controlsDisabled} autoFocus>
                            {t("config_page.others.runtime.confirm")}
                        </button>
                    </div>
                </section>
            )}
        </section>
    );
};
