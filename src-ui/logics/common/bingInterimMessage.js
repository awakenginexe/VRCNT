export const BING_INTERIM_MESSAGE_IDS = Object.freeze({
    mic: "bing-interim-mic",
    speaker: "bing-interim-speaker",
});

const sourceKey = (source) => source === "speaker" ? "speaker" : "mic";

const createTimeData = () => new Date().toLocaleTimeString(
    "ja-JP",
    { hour12: false, hour: "2-digit", minute: "2-digit" },
);

export const updateBingInterimMessageLogs = (logs, payload = {}) => {
    if (!Array.isArray(logs)) return logs;

    const key = sourceKey(payload.source);
    const id = BING_INTERIM_MESSAGE_IDS[key];
    const currentIndex = logs.findIndex((entry) => entry?.id === id);
    const text = typeof payload.text === "string" ? payload.text : "";

    if (payload.clear === true || text.trim() === "") {
        return currentIndex < 0
            ? logs
            : logs.filter((entry) => entry?.id !== id);
    }

    const nextEntry = {
        id,
        created_at: payload.created_at ?? createTimeData(),
        category: key === "mic" ? "sent" : "received",
        status: "interim",
        trace_id: null,
        source_language: payload.language ?? null,
        messages: {
            original: {
                message: text,
                transliteration: [],
            },
            translations: [],
        },
    };

    if (currentIndex < 0) return [...logs, nextEntry];

    const nextLogs = [...logs];
    nextLogs[currentIndex] = nextEntry;
    return nextLogs;
};
