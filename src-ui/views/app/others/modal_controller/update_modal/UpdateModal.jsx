import clsx from "clsx";
import styles from "./UpdateModal.module.scss";
import { useI18n } from "@useI18n";
import { useStore_OpenedQuickSetting } from "@store";
import {
    useUpdateSoftware,
    useSoftwareVersion,
} from "@logics_common";

export const UpdateModal = () => {
    const { t } = useI18n();
    const { updateOpenedQuickSetting } = useStore_OpenedQuickSetting();
    const { updateSoftware, openReleaseFallback, updateState } = useUpdateSoftware();
    const { currentLatestSoftwareVersionInfo } = useSoftwareVersion();

    const is_latest_version_already = currentLatestSoftwareVersionInfo.data.is_update_available === false;
    const is_updating = ["opening", "checking", "downloading", "restarting"].includes(updateState.status);
    const is_error = updateState.status === "error";
    const progress_percent = Math.round((updateState.progress ?? 0) * 100);
    const update_version = updateState.version || currentLatestSoftwareVersionInfo.data.new_version;

    const onClickUpdateSoftware = () => updateSoftware();

    const accept_button_class_name = styles.accept_button;

    return (
        <div className={styles.container}>
            <div className={styles.wrapper}>
                <div className={styles.update_section_wrapper}>
                    <section className={styles.update_section} aria-live="polite">
                        <div className={styles.single_update_section}>
                            <button
                                type="button"
                                className={accept_button_class_name}
                                onClick={onClickUpdateSoftware}
                                disabled={is_updating}
                            >
                                {is_updating
                                    ? updateState.status === "opening"
                                        ? t("update_modal.opening_releases")
                                        : t(`update_modal.${updateState.status}`)
                                    : is_latest_version_already
                                        ? t("update_modal.check_for_updates")
                                        : t("update_modal.download_latest_button")}
                            </button>
                            <CurrentVersionLabel is_latest_version_already={is_latest_version_already} />
                            {!is_latest_version_already && (
                                <p className={styles.current_version_label}>
                                    {t("update_modal.new_version_available", { version: update_version })}
                                </p>
                            )}
                            {is_updating && (
                                <div className={styles.progress_wrapper}>
                                    <div
                                        className={styles.progress_bar}
                                        role="progressbar"
                                        aria-label={t("update_modal.progress_label")}
                                        aria-valuemin="0"
                                        aria-valuemax="100"
                                        aria-valuenow={updateState.is_indeterminate ? undefined : progress_percent}
                                    >
                                        <div
                                            className={clsx(styles.progress_fill, {
                                                [styles.is_indeterminate]: updateState.is_indeterminate,
                                            })}
                                            style={updateState.is_indeterminate ? undefined : { width: `${progress_percent}%` }}
                                        />
                                    </div>
                                    <p className={styles.current_version_label}>
                                        {updateState.message}
                                        {!updateState.is_indeterminate && progress_percent > 0
                                            ? ` ${t("update_modal.progress", { percent: progress_percent })}`
                                            : ""}
                                    </p>
                                </div>
                            )}
                            {is_error && (
                                <div className={styles.error_section}>
                                    <p className={styles.error_message}>{updateState.message}</p>
                                    <p className={styles.version_desc}>{t("update_modal.fallback_detail")}</p>
                                    <button
                                        type="button"
                                        className={styles.fallback_button}
                                        onClick={openReleaseFallback}
                                    >
                                        {t("update_modal.open_releases")}
                                    </button>
                                </div>
                            )}
                            {!is_latest_version_already && !is_error && (
                                <p className={styles.version_desc}>{t("update_modal.download_latest_and_restart")}</p>
                            )}
                        </div>
                    </section>
                </div>

                <div className={styles.button_wrapper}>
                    <button type="button" className={styles.deny_button} onClick={() => updateOpenedQuickSetting("")}>
                        {t("update_modal.close_modal")}
                    </button>
                </div>
            </div>
        </div>
    );
};

const CurrentVersionLabel = (props) => {
    const { t } = useI18n();

    if (props.is_latest_version_already) {
        return <p className={styles.current_version_label}>{t("update_modal.is_latest_version_already")}</p>;
    }
    return null;
};
