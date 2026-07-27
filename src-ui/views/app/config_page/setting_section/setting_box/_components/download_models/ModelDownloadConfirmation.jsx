import { useEffect, useId } from "react";
import { useI18n } from "@useI18n";
import styles from "./ModelDownloadConfirmation.module.scss";

export const ModelDownloadConfirmation = ({ model, onConfirm, onCancel }) => {
    const { t } = useI18n();
    const titleId = useId();
    const descriptionId = useId();

    useEffect(() => {
        const cancelOnEscape = (event) => {
            if (event.key === "Escape") onCancel();
        };
        document.addEventListener("keydown", cancelOnEscape);
        return () => document.removeEventListener("keydown", cancelOnEscape);
    }, [onCancel]);

    const cancelOnBackdrop = (event) => {
        if (event.target === event.currentTarget) onCancel();
    };
    const modelLabel = model.label ?? model.id;

    return (
        <div className={styles.backdrop} onMouseDown={cancelOnBackdrop}>
            <div
                className={styles.dialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
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
        </div>
    );
};
