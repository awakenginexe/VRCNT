import { useEffect, useState } from "react";
import { useWindow } from "@logics_common";
import { getRuntimeBadge, getRuntimePresentation, getRuntimeState } from "@logics_common/runtimeManager.js";
import clsx from "clsx";
import styles from "./WindowTitleBar.module.scss";
import XMarkSvg from "@images/cancel.svg?react";
import SquareSvg from "@images/square.svg?react";
import LineSvg from "@images/line.svg?react";
import PerformanceIcon from "@images/mui_discover_tune.svg?react";
import logoBadge from "@images/vrcnt_logo_badge.png";
import { useStore_EnablePerformanceMode } from "@store";

export const WindowTitleBar = () => {
    const { asyncCloseApp, asyncToggleMaximizeApp, asyncMinimizeApp } = useWindow();
    const { currentEnablePerformanceMode, updateEnablePerformanceMode } = useStore_EnablePerformanceMode();
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

    const togglePerformanceMode = () => {
        const nextVal = !currentEnablePerformanceMode.data;
        updateEnablePerformanceMode(nextVal);
        localStorage.setItem("enable_performance_mode", nextVal ? "true" : "false");
    };

    const displayedBadge = runtimeVariant === "cuda" ? "CUDA" : (runtimeVariant === "cpu" ? "CPU" : null);

    return (
        <div className={styles.container} data-onboarding-title-bar>
            <div className={styles.wrapper} data-tauri-drag-region>
                <div className={styles.title_wrapper}>
                    <img className={styles.title_logo} src={logoBadge} alt="" />
                    <p className={styles.title_text}>VRCNT</p>
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
                    <p className={styles.title_subtitle}>Next Gen VRChat Translation</p>
                </div>

                <div className={styles.window_control_wrapper}>
                    <div
                        className={clsx(styles.performance_button, {
                            [styles.is_active]: currentEnablePerformanceMode.data,
                        })}
                        onClick={togglePerformanceMode}
                        title="Toggle Performance Mode (disables blurs/animations to save CPU/GPU)"
                    >
                        <PerformanceIcon className={styles.performance_svg} />
                    </div>
                    <div className={styles.minimize_button} onClick={asyncMinimizeApp}>
                        <LineSvg className={styles.line_svg}/>
                    </div>
                    <div className={styles.maximize_button} onClick={asyncToggleMaximizeApp}>
                        <SquareSvg className={styles.square_svg}/>
                    </div>
                    <div className={styles.close_button} onClick={asyncCloseApp}>
                        <XMarkSvg className={styles.x_mark_svg}/>
                    </div>
                </div>
            </div>
        </div>
    );
};
