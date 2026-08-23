const enabledSlots = (slots) => Object.entries(slots ?? {})
    .filter(([, value]) => value?.enable === true)
    .sort(([left], [right]) => Number(left) - Number(right));

const catalogEntry = (languageData, languageCatalog) => (
    (Array.isArray(languageCatalog) ? languageCatalog : []).find((entry) => (
        entry?.language === languageData?.language
        && entry?.country === languageData?.country
    ))
);

export const getUnsupportedBingLanguageSlots = ({
    engine,
    slots,
    languageCatalog,
    maxLanguages = 1,
}) => {
    if (engine !== "Bing" || !Array.isArray(languageCatalog) || languageCatalog.length === 0) {
        return [];
    }

    return enabledSlots(slots)
        .slice(0, Math.max(1, Number(maxLanguages) || 1))
        .filter(([, languageData]) => catalogEntry(languageData, languageCatalog)?.bing_supported !== true)
        .map(([slot, languageData]) => ({
            slot,
            language: languageData?.language ?? "",
            country: languageData?.country ?? "",
        }));
};

export const shouldBlockBingDirection = (args) => (
    getUnsupportedBingLanguageSlots(args).length > 0
);

export const formatBingUnsupportedLanguages = (unsupported) => (
    unsupported.map(({ language, country }) => `${language} (${country})`).join(", ")
);
