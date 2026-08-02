import { FONT_DOWNLOAD_POLICY, requestOptionalFontPack } from "./fontPackDownloads.js";
import { FONT_PACK_DELIVERY, FONT_PACKS, resolveFontScriptProfile } from "./fontScriptRegistry.js";

const WRITING_SYSTEM_LABELS = Object.freeze({
    Arab: "Arabic",
    Armn: "Armenian",
    Beng: "Bengali",
    Deva: "Devanagari",
    Ethi: "Ethiopic",
    Geor: "Georgian",
    Grek: "Greek",
    Gujr: "Gujarati",
    Hans: "Simplified Chinese",
    Hant: "Traditional Chinese",
    Hebr: "Hebrew",
    Jpan: "Japanese",
    Knda: "Kannada",
    Khmr: "Khmer",
    Kore: "Korean",
    Laoo: "Lao",
    Latn: "Latin",
    Mlym: "Malayalam",
    Mymr: "Myanmar",
    Sinh: "Sinhala",
    Taml: "Tamil",
    Telu: "Telugu",
    Thai: "Thai",
    Zsye: "Emoji",
});

export const normalizeFontDownloadPolicy = (value) => (
    Object.values(FONT_DOWNLOAD_POLICY).includes(value)
        ? value
        : FONT_DOWNLOAD_POLICY.ASK
);

export const getRequiredOptionalPackIds = (languageProfiles = []) => [...new Set(
    languageProfiles
        .flatMap((profile) => resolveFontScriptProfile(profile).packIds)
        .filter((packId) => FONT_PACKS[packId]?.delivery === FONT_PACK_DELIVERY.OPTIONAL),
)];

export const formatFontBytes = (bytes) => {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 ** 2).toFixed(1)} MB`;
};

export const createFontPackManagementState = (catalog = {}, { managedFamilySelected = false } = {}) => ({
    totalSizeLabel: formatFontBytes(catalog.totalBytes),
    packs: (catalog.packs ?? []).map((pack) => ({
        ...pack,
        sizeLabel: formatFontBytes(pack.sizeBytes),
        writingSystems: (pack.scripts ?? [])
            .map((script) => WRITING_SYSTEM_LABELS[script] ?? script)
            .join(", "),
        activationStatus: pack.installed
            ? (managedFamilySelected ? "Ready for managed activation" : "System font selected")
            : "System fallback",
    })),
});

export const applyFontPackProgress = (current = {}, progress = {}) => ({
    ...current,
    [progress.packId]: {
        state: progress.state,
        receivedBytes: progress.receivedBytes ?? 0,
        totalBytes: progress.totalBytes ?? 0,
        error: progress.error ?? null,
    },
});

export const getOptionalFontPackCatalog = (invoke) => invoke("optional_font_pack_catalog");

export const removeOptionalFontPack = (invoke, packId) => (
    invoke("remove_optional_font_pack", { packId })
);

export const requestRequiredOptionalFontPack = async (invoke, packId, policy, onPrompt) => {
    const outcome = await requestOptionalFontPack(invoke, packId, policy);
    if (outcome.action === "ask") onPrompt(packId);
    return outcome;
};
