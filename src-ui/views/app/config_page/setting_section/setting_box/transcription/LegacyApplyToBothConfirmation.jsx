import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@useI18n";
import {
    handleModelDownloadDialogKeyDown,
    setModelDownloadBackgroundInert,
} from "../_components/download_models/modelDownloadDialogAccessibility";
import styles from "./LegacyApplyToBothConfirmation.module.scss";

const FOCUSABLE_SELECTOR = [
    "button:not([disabled])",
    "[href]",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
].join(",");

export const LegacyApplyToBothConfirmation = ({ onConfirm, onCancel }) => {
    const { t } = useI18n();
    const titleId = useId();
    const descriptionId = useId();
    const dialogRef = useRef(null);

    useEffect(() => {
        const previouslyFocused = document.activeElement;
        const restoreBackground = setModelDownloadBackgroundInert(document.getElementById("root"));
        return () => {
            restoreBackground();
            previouslyFocused?.focus?.();
        };
    }, []);

    useEffect(() => {
        const handleDocumentKeyDown = (event) => {
            const focusableElements = [
                ...(dialogRef.current?.querySelectorAll(FOCUSABLE_SELECTOR) ?? []),
            ];
            handleModelDownloadDialogKeyDown(event, {
                activeElement: document.activeElement,
                focusableElements,
                onCancel,
            });
        };
        document.addEventListener("keydown", handleDocumentKeyDown);
        return () => document.removeEventListener("keydown", handleDocumentKeyDown);
    }, [onCancel]);

    const cancelOnBackdrop = (event) => {
        if (event.target === event.currentTarget) onCancel();
    };

    return createPortal(
        <div className={styles.backdrop} onMouseDown={cancelOnBackdrop}>
            <div
                className={styles.dialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                ref={dialogRef}
            >
                <div className={styles.icon} aria-hidden="true">!</div>
                <div className={styles.copy}>
                    <p className={styles.eyebrow}>{t("config_page.transcription.apply_to_both_eyebrow")}</p>
                    <h2 className={styles.title} id={titleId}>
                        {t("config_page.transcription.apply_to_both_title")}
                    </h2>
                    <p className={styles.detail} id={descriptionId}>
                        {t("config_page.transcription.apply_to_both_warning")}
                    </p>
                </div>
                <div className={styles.actions}>
                    <button className={styles.cancel_button} type="button" onClick={onCancel} autoFocus>
                        {t("config_page.transcription.apply_to_both_cancel")}
                    </button>
                    <button className={styles.confirm_button} type="button" onClick={onConfirm}>
                        {t("config_page.transcription.apply_to_both_confirm")}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
};
