import clsx from "clsx";
import styles from "./Logo.module.scss";
import logoBadge from "@images/vrcnt_logo_badge.png";
import { useEffect, useState } from "react";
import { useIsMainPageCompactMode } from "@logics_main";
import { getRuntimeBadge, getRuntimePresentation, getRuntimeState } from "@logics_common/runtimeManager.js";

export const Logo = () => {
    const { currentIsMainPageCompactMode } = useIsMainPageCompactMode();
    const isCompact = Boolean(currentIsMainPageCompactMode?.data);
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

    const compactBadge = runtimeVariant === "cuda" ? "CUDA" : (runtimeVariant === "cpu" ? "CPU" : runtimeBadge);
    const displayedBadge = isCompact ? compactBadge : runtimeBadge;

    return (
        <div className={clsx(styles.container, {
            [styles.is_compact_mode]: isCompact,
        })}>
            <div className={styles.brand_wrapper}>
                <img className={styles.logo_badge} src={logoBadge} alt="VRCNT" />
                <span
                    className={clsx(styles.runtime_badge, {
                        [styles.variant_cpu]: runtimeVariant === "cpu",
                        [styles.variant_cuda]: runtimeVariant === "cuda",
                        [styles.variant_unknown]: !runtimeVariant,
                    })}
                    title={`Installed edition: ${runtimeBadge}`}
                >
                    {displayedBadge}
                </span>
            </div>
            <div className={styles.logo_copy}>
                <p className={styles.logo_title}>VRCNT</p>
                <p className={styles.logo_subtitle}>Next Gen VRChat Translation</p>
            </div>
        </div>
    );
};
