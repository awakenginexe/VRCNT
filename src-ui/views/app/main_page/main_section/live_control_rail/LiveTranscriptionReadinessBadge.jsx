import { useI18n } from "@useI18n";
import { getLiveTranscriptionReadinessPresentation } from "./liveTranscriptionReadinessBadgeUi.js";
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
    const presentation = getLiveTranscriptionReadinessPresentation({
        readiness,
        labels: {
            ready: readyLabel,
            notReady: notReadyLabel,
            loading: loadingLabel,
            sourceLabels: {
                send: t("main_page.transcription_send"),
                receive: t("main_page.transcription_receive"),
            },
        },
        formatMissingDetail: (item, sourceLabel) => {
            const model = `${sourceLabel} · ${item.engine} · ${item.model}`;
            if (item.engine === "Whisper Cloud") {
                return `${model}: ${t("config_page.common.correct_auth_key_required")}`;
            }
            return t("config_page.common.model_download.detail", { model });
        },
    });
    return (
        <div className={styles.badge} role="status" data-state={presentation.state}>
            <span className={styles.label}>
                {presentation.label}
            </span>
            <span className={styles.detail}>
                {presentation.detail}
            </span>
        </div>
    );
};
