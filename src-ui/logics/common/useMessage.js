import {
    useStore_MessageLogs,
    useStore_MessageInputValue,
    store,
} from "@store";

import { useStdoutToPython } from "@useStdoutToPython";
import { useNotificationStatus } from "./useNotificationStatus";
import {
    createMessageLogEntry,
    mergeTranslationUpdateByTrace,
} from "./messageLogUtils.js";

const COOLDOWN = 2000; // 2 seconds

export const useMessage = () => {
    const { currentMessageLogs, addMessageLogs, updateMessageLogs } = useStore_MessageLogs();
    const { currentMessageInputValue, updateMessageInputValue } = useStore_MessageInputValue();
    const { asyncStdoutToPython } = useStdoutToPython();
    const { showNotification_Error } = useNotificationStatus();

    const sendMessage = (message) => {
        const uuid = crypto.randomUUID();
        const send_message_object = {
            id: uuid,
            message: message,
        };
        asyncStdoutToPython("/run/send_message_box", send_message_object);

        addMessageLogs({
            id: uuid,
            category: "sent",
            status: "pending",
            created_at: generateTimeData(),
            messages: {
                original: { message: message, transliteration: [] },
                translations: [],
            },
        });
    };

    const addSystemMessageLog = (message) => {
        const uuid = crypto.randomUUID();
        const date = generateTimeData();

        addMessageLogs({
            id: uuid,
            category: "system",
            status: "system",
            created_at: date,
            messages: {
                original: { message: message, transliteration: [] },
                translations: [],
            },
        });
    };

    const addSystemMessageLog_FromBackend = (payload) => {
        addSystemMessageLog(payload.message);
    };

    const updateSentMessageLogById = (payload) => {
        updateMessageLogs(updateItemById(payload.id, payload));
    };

    const addSentMessageLog = (payload) => {
        const message_object = createMessageLogEntry(payload, "sent");
        addMessageLogs(message_object);
    };

    const addReceivedMessageLog = (payload) => {
        const message_object = createMessageLogEntry(payload, "received");
        addMessageLogs(message_object);
    };

    const updateTranscriptionTranslation = (payload) => {
        updateMessageLogs((current) =>
            mergeTranslationUpdateByTrace(current.data, payload, Date.now())
        );
    };

    const retryTranslation = (payload) => {
        asyncStdoutToPython("/run/retry_translation", payload);
    };

    const handleManualTranslationRetryAdmission = (payload) => {
        if (payload?.accepted !== false) return;
        const providers = Object.keys(payload?.cooldowns ?? {});
        const providerLabel = providers.length > 0
            ? providers.join(" + ")
            : "Selected translation service";
        const message = payload?.reason === "retry_active"
            ? "This sentence is already being translated."
            : `${providerLabel} is still cooling down. Try again when the countdown finishes.`;
        showNotification_Error(message, { category_id: "manual_translation_retry" });
    };

    const startTyping = () => {
        const now = Date.now();
        if (now - store.last_executed_time_startTyping >= 2000) {
            store.last_executed_time_startTyping = now;
            asyncStdoutToPython("/run/typing_message_box");
        }
    };

    const stopTyping = () => {
        asyncStdoutToPython("/run/stop_typing_message_box");
    };

    return {
        currentMessageLogs,
        sendMessage,
        addSystemMessageLog,
        addSystemMessageLog_FromBackend,
        updateSentMessageLogById,
        addSentMessageLog,
        addReceivedMessageLog,
        updateTranscriptionTranslation,
        retryTranslation,
        handleManualTranslationRetryAdmission,

        currentMessageInputValue,
        updateMessageInputValue,

        startTyping,
        stopTyping,
    };
};

const generateTimeData = () => {
    return new Date().toLocaleTimeString(
        "ja-JP",
        { hour12: false, hour: "2-digit", minute: "2-digit" }
    );
};

const updateItemById = (id, updated_data) => (current_items) => {
    return current_items.data.map(item => {
        if (item.id === id) {
            const normalized = createMessageLogEntry(updated_data, item.category, {
                id: item.id,
                createdAt: item.created_at,
                nowMs: Date.now(),
            });
            return {
                ...item,
                status: "ok",
                messages: updated_data.translations
                    ? {
                        ...item.messages,
                        translations: normalized.messages.translations,
                    }
                    : item.messages,
            };
        }
        return item;
    });
};
