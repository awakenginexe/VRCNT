import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@useI18n";
import {
    handleModelDownloadDialogKeyDown,
    setModelDownloadBackgroundInert,
} from "./modelDownloadDialogAccessibility";
import styles from "./ModelDownloadConfirmation.module.scss";

const FOCUSABLE_SELECTOR = [
    "button:not([disabled])",
    "[href]",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
].join(",");

export const ModelDownloadConfirmation = ({ model, onConfirm, onCancel }) => {
    const { t } = useI18n();
    const titleId = useId();
    const descriptionId = useId();
    const dialogRef = useRef(null);

    useEffect(() => (
        setModelDownloadBackgroundInert(document.getElementById("root"))
    ), []);

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
    const modelLabel = model.label ?? model.id;

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
                <h2 className={styles.title} id={titleId}>
                    {t("config_page.common.model_download.title")}
                </h2>
                <p className={styles.detail} id={descriptionId}>
                    {t("config_page.common.model_download.detail", { model: modelLabel })}
                </p>
                <div className={styles.actions}>
                    <button
                        className={styles.cancel_button}
                        type="button"
                        onClick={onCancel}
                        autoFocus
                    >
                        {t("config_page.common.model_download.no")}
                    </button>
                    <button
                        className={styles.confirm_button}
                        type="button"
                        onClick={onConfirm}
                    >
                        {t("config_page.common.model_download.yes")}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
};
