import { useEffect, useState } from "react";
import clsx from "clsx";
import { useI18n } from "@useI18n";
import logoBadge from "@images/vrcnt_logo_badge.png";
import { getCachedRuntimeState, getRuntimeBadge, getRuntimePresentation, getRuntimeState } from "@logics_common/runtimeManager.js";

import styles from "./TitleBox.module.scss";

export const TitleBox = () => {
    const { t } = useI18n();
    const [runtime, setRuntime] = useState(getCachedRuntimeState);

    useEffect(() => {
        let isCurrent = true;
        getRuntimeState()
            .then((currentRuntime) => {
                if (isCurrent) {
                    setRuntime(currentRuntime);
                }
            })
            .catch(() => {
                if (isCurrent) {
                    setRuntime(null);
                }
            });
        return () => {
            isCurrent = false;
        };
    }, []);

    const presentation = getRuntimePresentation(runtime);
    const runtimeVariant = presentation.status === "active" ? presentation.currentVariant : null;
    const runtimeBadge = getRuntimeBadge(runtime, { preferNvidiaCuda: true });
    const displayedBadge = runtimeVariant === "cuda" ? "CUDA" : (runtimeVariant === "cpu" ? "CPU" : null);

    return (
        <div className={styles.container}>
            <img className={styles.logo_mark} src={logoBadge} alt="VRCNT" />
            <div>
                <div className={styles.title_row}>
                    <p id="config-page-title" className={styles.title}>VRCNT</p>
                    <span
                        className={clsx(styles.runtime_badge, {
                            [styles.variant_cpu]: runtimeVariant === "cpu",
                            [styles.variant_cuda]: runtimeVariant === "cuda",
                        })}
                        data-unverified={!displayedBadge}
                        aria-hidden={!displayedBadge}
                        title={displayedBadge ? `Installed edition: ${runtimeBadge}` : undefined}
                    >
                        {displayedBadge ?? "CUDA"}
                    </span>
                </div>
                <p className={styles.subtitle}>{t("config_page.focus_settings.settings_title")}</p>
            </div>
        </div>
    );
};
