import { useEffect, useState } from "react";
import clsx from "clsx";
import { useI18n } from "@useI18n";
import logoBadge from "@images/vrcnt_logo_badge.png";
import { getRuntimeBadge, getRuntimePresentation, getRuntimeState } from "@logics_common/runtimeManager.js";

import styles from "./TitleBox.module.scss";

export const TitleBox = () => {
    const { t } = useI18n();
    const [runtimeBadge, setRuntimeBadge] = useState("Runtime unknown");
    const [runtimeVariant, setRuntimeVariant] = useState(null);

    useEffect(() => {
        let isCurrent = true;
        getRuntimeState()
            .then((runtime) => {
                if (isCurrent) {
                    const presentation = getRuntimePresentation(runtime);
                    const variant = presentation.status === "active" ? presentation.currentVariant : null;
                    setRuntimeVariant(variant);
                    setRuntimeBadge(getRuntimeBadge(runtime, { preferNvidiaCuda: true }));
                }
            })
            .catch(() => {
                if (isCurrent) {
                    setRuntimeVariant(null);
                    setRuntimeBadge("Runtime unknown");
                }
            });
        return () => {
            isCurrent = false;
        };
    }, []);

    const displayedBadge = runtimeVariant === "cuda" ? "CUDA" : (runtimeVariant === "cpu" ? "CPU" : null);

    return (
        <div className={styles.container}>
            <img className={styles.logo_mark} src={logoBadge} alt="VRCNT" />
            <div>
                <div className={styles.title_row}>
                    <p id="config-page-title" className={styles.title}>VRCNT</p>
                    {displayedBadge && (
                        <span
                            className={clsx(styles.runtime_badge, {
                                [styles.variant_cpu]: runtimeVariant === "cpu",
                                [styles.variant_cuda]: runtimeVariant === "cuda",
                            })}
                            title={`Installed edition: ${runtimeBadge}`}
                        >
                            {displayedBadge}
                        </span>
                    )}
                </div>
                <p className={styles.subtitle}>{t("config_page.focus_settings.settings_title")}</p>
            </div>
        </div>
    );
};
