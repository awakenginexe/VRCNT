import { FONT_PACK_DELIVERY, FONT_PACKS } from "./fontScriptRegistry.js";

export const FONT_DOWNLOAD_POLICY = Object.freeze({
    ASK: "ask",
    AUTOMATIC: "automatic",
    NEVER: "never",
});

const isAvailableAction = (action) => action === "available";

export const getFontPackDownloadState = (policy, isAvailable, confirmed = false) => {
    if (isAvailable) return { action: "available", usesSystemFallback: false };
    if (policy === FONT_DOWNLOAD_POLICY.NEVER) return { action: "fallback", usesSystemFallback: true };
    if (policy === FONT_DOWNLOAD_POLICY.ASK && !confirmed) return { action: "ask", usesSystemFallback: true };
    return { action: "download", usesSystemFallback: true };
};

export const requestOptionalFontPack = async (invoke, packId, policy, confirmed = false) => {
    const pack = FONT_PACKS[packId];
    if (!pack || pack.delivery !== FONT_PACK_DELIVERY.OPTIONAL) {
        throw new Error("Only approved optional font packs can be requested");
    }

    const outcome = await invoke("download_optional_font_pack", {
        request: { packId, policy, confirmed },
    });
    return {
        action: outcome.action,
        usesSystemFallback: !isAvailableAction(outcome.action) && !outcome.result?.installed,
    };
};

export const subscribeFontPackDownloadProgress = (listen, onProgress) => (
    listen("font-pack-download-progress", ({ payload }) => onProgress(payload))
);

export const cancelOptionalFontPack = (invoke, packId) => (
    invoke("cancel_optional_font_pack", { packId })
);
