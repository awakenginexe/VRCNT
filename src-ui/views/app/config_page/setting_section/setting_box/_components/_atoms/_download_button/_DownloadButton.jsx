import { useI18n } from "@useI18n";
import { CircularProgress } from "@common_components";
import styles from "./_DownloadButton.module.scss";

export const _DownloadButton = ({ option, rowState, ...props }) => {
    const { t } = useI18n();

    const renderContent = () => {
        switch (true) {
            case rowState === "unavailable":
                return (
                    <p className={styles.status_label} title={option.unavailable_reason}>
                        {t("config_page.common.model_download.unavailable")}
                    </p>
                );
            case option.progress !== null:
                return (
                    <div className={styles.progress}>
                        <CircularProgress
                            variant={(option.progress === 100) ? "indeterminate" : "determinate"}
                            value={Math.floor(option.progress / 10) * 10}
                            size="3rem"
                            sx={{ color: "var(--primary_300_color)" }}
                        />
                        <p className={styles.progress_label}>
                            {`${Math.round(option.progress)}%`}
                        </p>
                    </div>
                );
            case option.is_pending:
                return <CircularProgress size="3rem" sx={{ color: "var(--dark_600_color)" }}/>;
            case rowState === "download_required":
                return (
                    <p className={styles.status_label}>
                        {t("config_page.common.model_download.required")}
                    </p>
                );
            case option.update_button:
                return (
                    <button
                        className={styles.update_button}
                        type="button"
                        onClick={() => props.downloadStartFunction(option.id)}
                    >
                        <span className={styles.update_button_label}>Update</span>
                    </button>
                );
            default:
                return null;
        }
    };

    return <div className={styles.download_container}>{renderContent()}</div>;
};
