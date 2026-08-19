import { useI18n } from "@useI18n";
import styles from "./LiveTranscriptionReadinessBadge.module.scss";

export const LiveTranscriptionReadinessBadge = ({ readiness }) => {
    const { t } = useI18n();
    const readyLabel = t("main_page.live_workspace.transcription_ready", {
        defaultValue: t("main_page.live_workspace.session_ready"),
    });
    const notReadyLabel = t("main_page.live_workspace.transcription_not_ready", {
        defaultValue: t("config_page.translation_models.model_not_ready"),
    });
    const loadingLabel = t("main_page.language_panels.loading");
    return (
        <div className={styles.badge} role="status" data-state={readiness.state}>
            <span className={styles.label}>
                {readiness.state === "ready"
                    ? readyLabel
                    : readiness.state === "loading"
                        ? loadingLabel
                        : notReadyLabel}
            </span>
            <span className={styles.detail}>
                {readiness.missing.map((item) => item.detail).join(", ")}
            </span>
        </div>
    );
};
