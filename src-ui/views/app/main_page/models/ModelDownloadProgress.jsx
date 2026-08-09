import clsx from "clsx";
import { useI18n } from "@useI18n";
import { getDownloadProgress } from "./modelDownloadDisplay.js";
import styles from "./ModelsHub.module.scss";

export const ModelDownloadProgress = ({ status }) => {
    const { t } = useI18n();
    if (status?.is_pending !== true) return null;

    const progress = getDownloadProgress(status);
    const determinate = progress !== null;
    const roundedProgress = determinate ? Math.round(progress) : null;

    return (
        <div className={styles.download_progress}>
            <div className={styles.download_progress_meta}>
                <span>
                    {determinate
                        ? t("main_page.models_hub.downloading")
                        : t("main_page.models_hub.preparing_download")}
                </span>
                {determinate && <strong>{roundedProgress}%</strong>}
            </div>
            <div
                className={clsx(styles.download_progress_track, {
                    [styles.is_indeterminate]: !determinate,
                })}
                role="progressbar"
                aria-label={determinate
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
