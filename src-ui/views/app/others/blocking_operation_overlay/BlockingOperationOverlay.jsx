import { useEffect, useRef } from "react";

import styles from "./BlockingOperationOverlay.module.scss";
import logoBadge from "@images/vrcnt_logo_badge.png";

export const BlockingOperationOverlay = ({
    open,
    operationId,
    terminalError = false,
    title,
    phaseLabel,
    phase,
    detail,
    progress,
    progressLabel,
    progressText,
    elapsedText,
}) => {
    const cardRef = useRef(null);
    const previousFocusRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;

        previousFocusRef.current = document.activeElement;
        cardRef.current?.focus();

        return () => {
            const previous = previousFocusRef.current;
            if (previous?.isConnected) previous.focus();
        };
    }, [open]);

    if (!open) return null;

    const titleId = `blocking-operation-${operationId}-title`;
    const descriptionId = `blocking-operation-${operationId}-description`;
    const determinate = progress.kind === "determinate";
    const progressPercent = determinate
        ? Math.min(100, Math.max(0, progress.max > 0
            ? (progress.value / progress.max) * 100
            : 0))
        : 0;
    const progressAria = determinate
        ? {
            "aria-valuemin": 0,
            "aria-valuemax": progress.max,
            "aria-valuenow": progress.value,
        }
        : { "aria-valuetext": progressText };
    const progressClassName = determinate
        ? styles.progress
        : `${styles.progress} ${styles.is_indeterminate}`;

    return (
        <div
            className={`${styles.overlay}${terminalError ? ` ${styles.terminal_error}` : ""}`}
            role="dialog"
            aria-modal={terminalError ? undefined : "true"}
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
        >
            <section
                className={styles.card}
                ref={cardRef}
                tabIndex={-1}
            >
                <header className={styles.header}>
                    <div className={styles.brand_mark_shell}>
                        <img className={styles.brand_mark} src={logoBadge} alt="VRCNT" />
                    </div>
                    <div>
                        <p className={styles.phase_label}>{phaseLabel}</p>
                        <h2 className={styles.title} id={titleId}>{title}</h2>
                    </div>
                </header>
                <div
                    id={descriptionId}
                    className={styles.description}
                    role="status"
                    aria-live={terminalError ? "assertive" : "polite"}
                    aria-atomic="true"
                >
                    <p className={styles.phase}>{phase}</p>
                    {detail ? <p className={styles.detail}>{detail}</p> : null}
                </div>
                <div className={styles.progress_section}>
                    <div className={styles.progress_meta}>
                        <span className={styles.progress_label}>{progressLabel}</span>
                        <p className={styles.progress_text}>{progressText}</p>
                    </div>
                    <div
                        className={progressClassName}
                        role="progressbar"
                        aria-label={progressLabel}
                        {...progressAria}
                    >
                        <span
                            className={styles.progress_fill}
                            style={determinate
                                ? { "--progress-percent": `${progressPercent}%` }
                                : undefined}
                        />
                    </div>
                    <p className={styles.elapsed}>{elapsedText}</p>
                </div>
            </section>
        </div>
    );
};
