import { useI18n } from "@useI18n";
import { useIsBackendReady } from "@logics_common";
import { useMainFunction } from "@logics_main";
import {
    getSessionActionState,
} from "@logics_main/sessionControlUtils.js";
import styles from "./SessionPrimaryAction.module.scss";

export const SessionPrimaryAction = () => {
    const { t } = useI18n();
    const { currentIsBackendReady } = useIsBackendReady();
    const {
        currentTranslationStatus,
        currentTranscriptionSendStatus,
        currentTranscriptionReceiveStatus,
        setLiveSession,
    } = useMainFunction();
    const state = getSessionActionState({
        backendReady: currentIsBackendReady.data,
        statuses: {
            translation: currentTranslationStatus,
            speaking: currentTranscriptionSendStatus,
            listening: currentTranscriptionReceiveStatus,
        },
    });
    const toggleSession = async () => {
        if (state.isDisabled) return;
        await setLiveSession(state.action === "start");
    };
    const label = state.isBusy
        ? t(`main_page.live_workspace.session_${state.action}ing`)
        : state.action === "start"
            ? t("main_page.live_workspace.start_session")
            : t("main_page.live_workspace.stop_session");

    return (
        <button
            type="button"
            className={styles.button}
            data-action={state.action}
            data-busy={state.isBusy}
            onClick={toggleSession}
            disabled={state.isDisabled}
            aria-busy={state.isBusy}
        >
            <span className={styles.icon} aria-hidden="true">
                {state.action === "start" ? "▶" : "■"}
            </span>
            <span>{label}</span>
        </button>
    );
};
