export const TRANSCRIPTION_ENGINE_QUICK_PICK_ROLES = [
    {
        id: "speaking",
        profile: "send",
        titleKey: "main_page.language_panels.speaking_engine",
    },
    {
        id: "listening",
        profile: "receive",
        titleKey: "main_page.language_panels.listening_engine",
    },
];

export const getQuickPickerProfile = (role, sendProfile = {}, receiveProfile = {}) => (
    role === "listening" ? receiveProfile : sendProfile
);
