import { store } from "@store";

import {
    useStore_TranslationStatus,
    useStore_TranscriptionSendStatus,
    useStore_TranscriptionReceiveStatus,
    useStore_ForegroundStatus,
} from "@store";
import { useStdoutToPython } from "@useStdoutToPython";
import { useI18n } from "@useI18n";
import {
    readBooleanBackendResult,
    resolveFailedMainFunction,
} from "../common/blockingOperationState.js";
import { useNotificationStatus } from "../common/useNotificationStatus";

export const useMainFunction = () => {
    const appWindow = store.appWindow;

    const {
        currentTranslationStatus,
        updateTranslationStatus,
        pendingTranslationStatus,
    } = useStore_TranslationStatus();
    const {
        currentTranscriptionSendStatus,
        updateTranscriptionSendStatus,
        pendingTranscriptionSendStatus,
    } = useStore_TranscriptionSendStatus();
    const {
        currentTranscriptionReceiveStatus,
        updateTranscriptionReceiveStatus,
        pendingTranscriptionReceiveStatus,
    } = useStore_TranscriptionReceiveStatus();
    const {
        currentForegroundStatus,
        updateForegroundStatus,
    } = useStore_ForegroundStatus();

    const { asyncStdoutToPython } = useStdoutToPython();
    const { showNotification_Error } = useNotificationStatus();
    const { t } = useI18n();

    const updateStatusFor = (operation) => ({
        translation: updateTranslationStatus,
        transcription_send: updateTranscriptionSendStatus,
        transcription_receive: updateTranscriptionReceiveStatus,
    })[operation];

    const createTogglePair = (currentStatus, pendingFn, updateStatus, endpointName) => {
        const setFn = async (to_enable) => {
            if (currentStatus.state === "pending") return;
            pendingFn();

            const action = to_enable ? "enable" : "disable";
            const transportResult = await asyncStdoutToPython(
                `/set/${action}/${endpointName}`,
            );
            if (!transportResult.ok) {
                updateStatus((current) => current.data);
                showNotification_Error(
                    t("blocking_operation.backend_unavailable"),
                    { category_id: "backend_unavailable" },
                );
            }
        };
        const toggleFn = () => {
            if (currentStatus.state !== "ok") return;
            return setFn(!currentStatus.data);
        };
        return { setFn, toggleFn };
    };

    const { setFn: setTranslation, toggleFn: toggleTranslation } = createTogglePair(
        currentTranslationStatus,
        pendingTranslationStatus,
        updateTranslationStatus,
        "translation",
    );
    const { setFn: setTranscriptionSend, toggleFn: toggleTranscriptionSend } = createTogglePair(
        currentTranscriptionSendStatus,
        pendingTranscriptionSendStatus,
        updateTranscriptionSendStatus,
        "transcription_send",
    );
    const { setFn: setTranscriptionReceive, toggleFn: toggleTranscriptionReceive } = createTogglePair(
        currentTranscriptionReceiveStatus,
        pendingTranscriptionReceiveStatus,
        updateTranscriptionReceiveStatus,
        "transcription_receive",
    );

    const setLiveSession = async (to_enable) => {
        const operationStatuses = [
            currentTranslationStatus,
            currentTranscriptionSendStatus,
            currentTranscriptionReceiveStatus,
        ];
        if (operationStatuses.some((status) => status.state === "pending")) return;

        pendingTranslationStatus();
        pendingTranscriptionSendStatus();
        pendingTranscriptionReceiveStatus();

        const action = to_enable ? "enable" : "disable";
        const transportResult = await asyncStdoutToPython(
            `/set/${action}/live_session`,
        );
        if (!transportResult.ok) {
            clearPendingMainFunctionStatuses();
            showNotification_Error(
                t("blocking_operation.backend_unavailable"),
                { category_id: "backend_unavailable" },
            );
        }
        return transportResult;
    };

    const clearPendingMainFunctionStatuses = () => {
        updateTranslationStatus((current) => current.data);
        updateTranscriptionSendStatus((current) => current.data);
        updateTranscriptionReceiveStatus((current) => current.data);
    };

    const clearPendingMainFunctionError = ({ endpoint, errorCode, result }) => {
        const operation = resolveFailedMainFunction({ endpoint, errorCode });
        if (!operation) return false;
        const backendValue = readBooleanBackendResult(result);
        updateStatusFor(operation)((current) => backendValue ?? current.data);
        return true;
    };

    const settleLiveSessionBatch = (result = {}) => {
        updateTranslationStatus(result.translation === true);
        updateTranscriptionSendStatus(result.transcription_send === true);
        updateTranscriptionReceiveStatus(result.transcription_receive === true);
        clearPendingMainFunctionStatuses();
        if (Array.isArray(result.errors) && result.errors.length > 0) {
            showNotification_Error(
                t("main_page.live_workspace.session_stop_partial"),
                {
                    category_id: "live_session_stop_partial",
                    hide_duration: 5000,
                },
            );
        }
    };

    const toggleForeground = async () => {
        const is_foreground_enabled = !currentForegroundStatus.data;
        await appWindow.setAlwaysOnTop(is_foreground_enabled);
        updateForegroundStatus(is_foreground_enabled);
    };

    return {
        currentTranslationStatus,
        toggleTranslation,
        updateTranslationStatus,
        setTranslation,
        pendingTranslationStatus, // Exception.(It shouldn't be used in other function, normally.)

        currentTranscriptionSendStatus,
        toggleTranscriptionSend,
        updateTranscriptionSendStatus,
        setTranscriptionSend,
        pendingTranscriptionSendStatus, // Exception.(It shouldn't be used in other function, normally.)

        currentTranscriptionReceiveStatus,
        toggleTranscriptionReceive,
        updateTranscriptionReceiveStatus,
        setTranscriptionReceive,
        pendingTranscriptionReceiveStatus, // Exception.(It shouldn't be used in other function, normally.)

        setLiveSession,

        currentForegroundStatus,
        toggleForeground,
        updateForegroundStatus,

        clearPendingMainFunctionStatuses,
        clearPendingMainFunctionError,
        settleLiveSessionBatch,
    };
};
