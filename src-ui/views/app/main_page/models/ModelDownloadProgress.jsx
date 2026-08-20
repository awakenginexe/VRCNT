import clsx from "clsx";
import { useI18n } from "@useI18n";
import { getDownloadProgress, getModelDownloadState } from "./modelDownloadDisplay.js";
import styles from "./ModelsHub.module.scss";

export const ModelDownloadProgress = ({ status, onCancel }) => {
    const { t } = useI18n();
    if (status?.is_pending !== true) return null;

    const progress = getDownloadProgress(status);
    const determinate = progress !== null;
    const roundedProgress = determinate ? Math.round(progress) : null;
    const isCancelling = getModelDownloadState(status) === "cancelling";

    return (
        <div className={styles.download_progress}>
            <div className={styles.download_progress_meta} aria-live="polite">
                <span>
                    {isCancelling
                        ? t("main_page.models_hub.cancelling_download")
                        : determinate
                            ? t("main_page.models_hub.downloading")
                            : t("main_page.models_hub.preparing_download")}
                </span>
                <div className={styles.download_progress_actions}>
                    {determinate && <strong>{roundedProgress}%</strong>}
                    {onCancel && (
                        <button
                            type="button"
                            className={styles.download_cancel_button}
                            onClick={onCancel}
                            disabled={isCancelling}
                            aria-label={t("main_page.models_hub.cancel_download")}
                        >
                            {t("main_page.models_hub.cancel_download")}
                        </button>
                    )}
                </div>
            </div>
            <div
                className={clsx(styles.download_progress_track, {
                    [styles.is_indeterminate]: !determinate,
                })}
                role="progressbar"
                aria-label={isCancelling
                    ? t("main_page.models_hub.cancelling_download")
                    : determinate
                        ? t("main_page.models_hub.download_progress", { progress: roundedProgress })
                        : t("main_page.models_hub.preparing_download")}
                aria-valuemin={determinate ? 0 : undefined}
                aria-valuemax={determinate ? 100 : undefined}
                aria-valuenow={determinate ? progress : undefined}
            >
                <span
                    className={styles.download_progress_fill}
                    style={determinate ? { width: `${progress}%` } : undefined}
                />
            </div>
        </div>
    );
};
