export const FONT_PACK_DELIVERY = Object.freeze({
    BUNDLED: "bundled",
    OPTIONAL: "optional",
});

export const THAI_UI_LANGUAGE_ID = "th";

const createPack = (id, delivery, sourceFamily, scripts) => Object.freeze({
    id,
    delivery,
    sourceFamily,
    scripts: Object.freeze(scripts),
});

export const FONT_PACKS = Object.freeze({
    "latin-greek-cyrillic": createPack("latin-greek-cyrillic", FONT_PACK_DELIVERY.BUNDLED, "Noto Sans", ["Latn", "Grek", "Cyrl"]),
    thai: createPack("thai", FONT_PACK_DELIVERY.BUNDLED, "Noto Sans Thai", ["Thai"]),
    japanese: createPack("japanese", FONT_PACK_DELIVERY.BUNDLED, "Noto Sans JP", ["Jpan"]),
    "cjk-simplified": createPack("cjk-simplified", FONT_PACK_DELIVERY.BUNDLED, "Noto Sans SC", ["Hans"]),
    "cjk-traditional": createPack("cjk-traditional", FONT_PACK_DELIVERY.BUNDLED, "Noto Sans TC", ["Hant"]),
    korean: createPack("korean", FONT_PACK_DELIVERY.BUNDLED, "Noto Sans KR", ["Kore"]),
    lao: createPack("lao", FONT_PACK_DELIVERY.BUNDLED, "Noto Sans Lao", ["Laoo"]),
    khmer: createPack("khmer", FONT_PACK_DELIVERY.BUNDLED, "Noto Sans Khmer", ["Khmr"]),
    myanmar: createPack("myanmar", FONT_PACK_DELIVERY.BUNDLED, "Noto Sans Myanmar", ["Mymr"]),
    devanagari: createPack("devanagari", FONT_PACK_DELIVERY.BUNDLED, "Noto Sans Devanagari", ["Deva"]),
    arabic: createPack("arabic", FONT_PACK_DELIVERY.BUNDLED, "Noto Sans Arabic", ["Arab"]),
    "cjk-hong-kong": createPack("cjk-hong-kong", FONT_PACK_DELIVERY.OPTIONAL, "Noto Sans HK", ["Hant"]),
    urdu: createPack("urdu", FONT_PACK_DELIVERY.OPTIONAL, "Noto Nastaliq Urdu", ["Arab"]),
    ethiopic: createPack("ethiopic", FONT_PACK_DELIVERY.OPTIONAL, "Noto Sans Ethiopic", ["Ethi"]),
    armenian: createPack("armenian", FONT_PACK_DELIVERY.OPTIONAL, "Noto Sans Armenian", ["Armn"]),
    bengali: createPack("bengali", FONT_PACK_DELIVERY.OPTIONAL, "Noto Sans Bengali", ["Beng"]),
    georgian: createPack("georgian", FONT_PACK_DELIVERY.OPTIONAL, "Noto Sans Georgian", ["Geor"]),
    gujarati: createPack("gujarati", FONT_PACK_DELIVERY.OPTIONAL, "Noto Sans Gujarati", ["Gujr"]),
    hebrew: createPack("hebrew", FONT_PACK_DELIVERY.OPTIONAL, "Noto Sans Hebrew", ["Hebr"]),
    kannada: createPack("kannada", FONT_PACK_DELIVERY.OPTIONAL, "Noto Sans Kannada", ["Knda"]),
    malayalam: createPack("malayalam", FONT_PACK_DELIVERY.OPTIONAL, "Noto Sans Malayalam", ["Mlym"]),
    sinhala: createPack("sinhala", FONT_PACK_DELIVERY.OPTIONAL, "Noto Sans Sinhala", ["Sinh"]),
    tamil: createPack("tamil", FONT_PACK_DELIVERY.OPTIONAL, "Noto Sans Tamil", ["Taml"]),
    telugu: createPack("telugu", FONT_PACK_DELIVERY.OPTIONAL, "Noto Sans Telugu", ["Telu"]),
    emoji: createPack("emoji", FONT_PACK_DELIVERY.OPTIONAL, "Noto Color Emoji", ["Zsye"]),
});

const DEFAULT_USER_FONT_FAMILY = '"Yu Gothic UI"';
const SYSTEM_FONT_FALLBACK = '"Inter", "Segoe UI Variable Text", "Yu Gothic UI", system-ui, sans-serif';
const DEFAULT_SCRIPT_STACK = '"VRCNT Noto Core"';
const MANAGED_FONT_FAMILY = "var(--vrcnt-script-stack), var(--vrcnt-user-font), var(--vrcnt-system-fallback)";

const DISPLAY_LANGUAGE_CODES = Object.freeze({
    "afrikaans": "af", "albanian": "sq", "amharic": "am", "arabic": "ar", "armenian": "hy",
    "azerbaijani": "az", "basque": "eu", "bengali": "bn", "bosnian": "bs", "bulgarian": "bg",
    "burmese": "my", "catalan": "ca", "croatian": "hr", "czech": "cs", "danish": "da",
    "dutch": "nl", "english": "en", "estonian": "et", "filipino": "fil", "finnish": "fi",
    "french": "fr", "galician": "gl", "georgian": "ka", "german": "de", "greek": "el",
    "gujarati": "gu", "hebrew": "he", "hindi": "hi", "hungarian": "hu", "icelandic": "is",
    "indonesian": "id", "italian": "it", "japanese": "ja", "kannada": "kn", "kazakh": "kk",
    "khmer": "km", "korean": "ko", "lao": "lo", "latvian": "lv", "lithuanian": "lt",
    "macedonian": "mk", "malay": "ms", "malayalam": "ml", "mongolian": "mn", "nepali": "ne",
    "norwegian": "no", "persian": "fa", "polish": "pl", "portuguese": "pt", "romanian": "ro",
    "russian": "ru", "serbian": "sr", "sinhala": "si", "slovak": "sk", "slovenian": "sl",
    "spanish": "es", "sundanese": "su", "swahili": "sw", "swedish": "sv", "tamil": "ta",
    "telugu": "te", "thai": "th", "turkish": "tr", "ukrainian": "uk", "urdu": "ur",
    "uzbek": "uz", "vietnamese": "vi",
});

const CORE_CODES = new Set([
    "af", "sq", "az", "eu", "bs", "ca", "hr", "cs", "da", "nl", "en", "et", "fil", "tl", "fi", "fr", "gl", "de",
    "hu", "is", "id", "it", "lv", "lt", "ms", "no", "nb", "pl", "pt", "ro", "sk", "sl", "es", "su", "sw", "sv",
    "tr", "uz", "vi", "bg", "kk", "mk", "mn", "ru", "sr", "uk", "el",
]);

const PACK_BY_LANGUAGE_CODE = Object.freeze({
    th: ["thai"], ja: ["japanese"], ko: ["korean"], lo: ["lao"], km: ["khmer"], my: ["myanmar"],
    hi: ["devanagari"], ne: ["devanagari"], mr: ["devanagari"], ar: ["arabic"], fa: ["arabic"],
    ur: ["urdu", "arabic"], am: ["ethiopic"], hy: ["armenian"], bn: ["bengali"], ka: ["georgian"],
    gu: ["gujarati"], he: ["hebrew"], kn: ["kannada"], ml: ["malayalam"], si: ["sinhala"],
    ta: ["tamil"], te: ["telugu"],
});

const RTL_LANGUAGE_CODES = new Set(["ar", "fa", "he", "ur"]);
const RTL_SCRIPT_CODES = new Set(["Arab", "Hebr"]);
const AUTOMATIC_LANGUAGE_NAMES = new Set(["", "auto", "automatic", "detect", "unknown"]);

const normalizeDisplayName = (value) => (
    typeof value === "string"
        ? value.trim().normalize("NFC").toLocaleLowerCase().replace(/\s+/g, " ")
        : ""
);

export const normalizeFontLanguageTag = (value) => {
    if (typeof value !== "string") return null;
    const parts = value.trim().replaceAll("_", "-").split("-").filter(Boolean);
    if (parts.length === 0) return null;

    return parts.map((part, index) => {
        if (index === 0) return part.toLowerCase();
        if (/^[a-z]{4}$/i.test(part)) return `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`;
        if (/^[a-z]{2}$/i.test(part) || /^\d{3}$/.test(part)) return part.toUpperCase();
        return part.toLowerCase();
    }).join("-");
};

const readLanguageTag = (input) => normalizeFontLanguageTag(
    input?.code ?? input?.languageCode ?? input?.locale ?? input?.tag,
);

const getTagParts = (tag) => {
    const parts = tag?.split("-") ?? [];
    return {
        languageCode: parts[0] ?? null,
        script: parts.find((part) => /^[A-Z][a-z]{3}$/.test(part)) ?? null,
        region: parts.find((part) => /^[A-Z]{2}$/.test(part) || /^\d{3}$/.test(part)) ?? null,
    };
};

const isHongKong = (country, region) => (
    region === "HK" || ["hong kong", "hong kong sar china", "hk"].includes(normalizeDisplayName(country))
);

const uniquePackIds = (packIds) => [...new Set(packIds)];

export const resolveFontScriptProfile = (input = {}) => {
    const profile = typeof input === "string" ? { code: input } : input;
    const displayName = normalizeDisplayName(profile?.language);
    const languageTag = readLanguageTag(profile);
    const isAutomaticDisplayName = displayName !== "" && AUTOMATIC_LANGUAGE_NAMES.has(displayName);
    const isAutomaticLanguageTag = ["auto", "automatic", "detect", "unknown"].includes(languageTag);
    if (isAutomaticDisplayName || isAutomaticLanguageTag) {
        return { languageTag: null, direction: "ltr", packIds: [], usesSystemFallback: true };
    }

    const { languageCode: tagLanguageCode, script, region } = getTagParts(languageTag);
    const languageCode = tagLanguageCode ?? DISPLAY_LANGUAGE_CODES[displayName] ?? null;
    const hongKong = isHongKong(profile?.country, region);
    let packIds = [];

    if (script === "Hans") {
        packIds = ["cjk-simplified"];
    } else if (script === "Hant") {
        packIds = hongKong || tagLanguageCode === "yue"
            ? ["cjk-hong-kong", "cjk-traditional"]
            : ["cjk-traditional"];
    } else if (displayName === "chinese simplified") {
        packIds = ["cjk-simplified"];
    } else if (displayName === "chinese traditional" || languageCode === "yue") {
        packIds = hongKong || languageCode === "yue"
            ? ["cjk-hong-kong", "cjk-traditional"]
            : ["cjk-traditional"];
    } else if (CORE_CODES.has(languageCode)) {
        packIds = ["latin-greek-cyrillic"];
    } else if (languageCode && PACK_BY_LANGUAGE_CODE[languageCode]) {
        packIds = PACK_BY_LANGUAGE_CODE[languageCode];
    }

    return {
        languageTag: languageTag ?? languageCode,
        direction: RTL_LANGUAGE_CODES.has(languageCode) || RTL_SCRIPT_CODES.has(script) ? "rtl" : "ltr",
        packIds: uniquePackIds(packIds),
        usesSystemFallback: true,
    };
};

export const getManagedFontVariables = (selectedFontFamily) => ({
    "--vrcnt-user-font": typeof selectedFontFamily === "string" && selectedFontFamily.trim()
        ? selectedFontFamily.trim()
        : DEFAULT_USER_FONT_FAMILY,
    "--vrcnt-script-stack": DEFAULT_SCRIPT_STACK,
    "--vrcnt-system-fallback": SYSTEM_FONT_FALLBACK,
    "--font_family": MANAGED_FONT_FAMILY,
});

export const applyManagedFontVariables = (rootElement, selectedFontFamily) => {
    if (!rootElement?.style) return;
    for (const [name, value] of Object.entries(getManagedFontVariables(selectedFontFamily))) {
        rootElement.style.setProperty(name, value);
    }
};
