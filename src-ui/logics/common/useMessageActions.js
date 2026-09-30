import { useSetAtom } from "jotai";
import { Atom_MessageLogs, Atom_MessageInputValue } from "@store";
import { useStdoutToPython } from "@useStdoutToPython";

// Rows need commands, not subscriptions to the entire history and input field.
export const useMessageActions = () => {
    const setLogs = useSetAtom(Atom_MessageLogs);
    const setInput = useSetAtom(Atom_MessageInputValue);
    const { asyncStdoutToPython } = useStdoutToPython();
    const sendMessage = (message) => {
        const id = crypto.randomUUID();
        asyncStdoutToPython("/run/send_message_box", { id, message });
        setLogs((current) => ({ state: "ok", data: [...current.data, {
            id, category: "sent", status: "pending",
            created_at: new Date().toLocaleTimeString("ja-JP", {
                hour12: false, hour: "2-digit", minute: "2-digit",
            }),
            messages: { original: { message, transliteration: [] }, translations: [] },
        }] }));
    };
    return {
        sendMessage,
        updateMessageInputValue: (data) => setInput({ state: "ok", data }),
        retryTranslation: (payload) => asyncStdoutToPython("/run/retry_translation", payload),
    };
};
