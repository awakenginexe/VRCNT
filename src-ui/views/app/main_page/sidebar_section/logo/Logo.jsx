import clsx from "clsx";
import styles from "./Logo.module.scss";
import logoBadge from "@images/vrcnt_logo_badge.png";
import { useEffect, useState } from "react";
import { useIsMainPageCompactMode } from "@logics_main";
import { getRuntimeBadge, getRuntimeState } from "@logics_common/runtimeManager.js";

export const Logo = () => {
    const { currentIsMainPageCompactMode } = useIsMainPageCompactMode();
    const [runtimeBadge, setRuntimeBadge] = useState("Runtime unknown");

    useEffect(() => {
        let isCurrent = true;
        getRuntimeState()
            .then((runtime) => {
                if (isCurrent) setRuntimeBadge(getRuntimeBadge(runtime));
            })
            .catch(() => {
                if (isCurrent) setRuntimeBadge("Runtime unknown");
            });
        return () => {
            isCurrent = false;
        };
    }, []);

    return (
        <div className={clsx(styles.container, {
            [styles.is_compact_mode]: currentIsMainPageCompactMode.data,
        })}>
            <img className={styles.logo_badge} src={logoBadge} alt="VRCNT" />
            <div className={styles.logo_copy}>
                <p className={styles.logo_title}>VRCNT</p>
                <span className={styles.runtime_badge} title={`Installed edition: ${runtimeBadge}`}>{runtimeBadge}</span>
                <p className={styles.logo_subtitle}>Next Gen VRChat Translation</p>
            </div>
        </div>
    );
};
