export const sidebarTabOrder = [
    "device",
    "appearance",
    "model_and_provider",
    "vr",
    "others",
    "hotkeys",
    "advanced_settings",
    "about",
];

const sidebarTabMeta = {
    device: {
        label: "Device",
        tooltipTitle: "Audio devices",
        tooltipDetail: "Choose microphone and speaker input.",
    },
    appearance: {
        label: "Appearance",
        tooltipTitle: "Appearance",
        tooltipDetail: "Adjust theme, scale, and window style.",
    },
    translation: {
        label: "Translation",
        tooltipTitle: "Translation",
        tooltipDetail: "Configure translation engines and output.",
    },
    transcription: {
        label: "Transcription",
        tooltipTitle: "Transcription",
        tooltipDetail: "Tune speech recognition settings.",
    },
    model_and_provider: {
        label: "Model & Provider",
        tooltipTitle: "Model & Provider",
        tooltipDetail: "Configure translation providers and speech models.",
    },
    vr: {
        label: "VR",
        tooltipTitle: "VR overlay",
        tooltipDetail: "Set VRChat overlay and OSC behavior.",
    },
    others: {
        label: "Others",
        tooltipTitle: "Other settings",
        tooltipDetail: "Manage general app behavior.",
    },
    hotkeys: {
        label: "Hotkeys",
        tooltipTitle: "Hotkeys",
        tooltipDetail: "Set keyboard shortcuts.",
    },
    advanced_settings: {
        label: "Advanced Settings",
        tooltipTitle: "Advanced",
        tooltipDetail: "Change expert-level options.",
    },
    about: {
        label: "About",
        tooltipTitle: "About",
        tooltipDetail: "See version, project lineage, and repository links.",
    },
};

export const getSidebarTabMeta = (tabId, translate) => {
    const meta = sidebarTabMeta[tabId] ?? {
        label: tabId,
        tooltipTitle: tabId,
        tooltipDetail: "Open this settings section.",
    };

    const translateWithFallback = (key, fallback) => {
        if (typeof translate !== "function") return fallback;
        const translated = translate(key);
        return translated && translated !== key ? translated : fallback;
    };

    return {
        ...meta,
        label: translateWithFallback(
            `config_page.focus_settings.section_labels.${tabId}`,
            translateWithFallback(`config_page.side_menu_labels.${tabId}`, meta.label),
        ),
        tooltipDetail: translateWithFallback(
            `config_page.focus_settings.section_descriptions.${tabId}`,
            meta.tooltipDetail,
        ),
    };
};
