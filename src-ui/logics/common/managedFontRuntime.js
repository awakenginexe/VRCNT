import { FONT_PACKS, resolveFontScriptProfile } from "./fontScriptRegistry.js";

const unique = (values) => [...new Set(values)];

const PACK_UNICODE_RANGES = Object.freeze({
    "latin-greek-cyrillic": "U+0000-02AF, U+0300-052F, U+1E00-1EFF, U+2C60-2C7F, U+A640-A69F",
    thai: "U+0E00-0E7F",
    japanese: "U+3000-30FF, U+31F0-31FF, U+4E00-9FFF, U+FF00-FFEF",
    "cjk-simplified": "U+3000-303F, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FF00-FFEF",
    "cjk-traditional": "U+3000-303F, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FF00-FFEF",
    "cjk-hong-kong": "U+3000-303F, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FF00-FFEF",
    korean: "U+1100-11FF, U+3130-318F, U+AC00-D7AF",
    lao: "U+0E80-0EFF",
    khmer: "U+1780-17FF, U+19E0-19FF",
    myanmar: "U+1000-109F, U+AA60-AA7F, U+A9E0-A9FF",
    devanagari: "U+0900-097F, U+A8E0-A8FF",
    arabic: "U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF",
    urdu: "U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF",
    ethiopic: "U+1200-137F, U+1380-139F, U+2D80-2DDF, U+AB00-AB2F",
    armenian: "U+0530-058F, U+FB13-FB17",
    bengali: "U+0980-09FF",
    georgian: "U+10A0-10FF, U+2D00-2D2F",
    gujarati: "U+0A80-0AFF",
    hebrew: "U+0590-05FF, U+FB1D-FB4F",
    kannada: "U+0C80-0CFF",
    malayalam: "U+0D00-0D7F",
    sinhala: "U+0D80-0DFF",
    tamil: "U+0B80-0BFF",
    telugu: "U+0C00-0C7F",
});

export const collectManagedPackIds = (languageProfiles = []) => unique(
    languageProfiles.flatMap((profile) => resolveFontScriptProfile(profile).packIds),
);

export const createManagedFontRuntime = ({
    invoke,
    convertFileSrc,
    document = globalThis.document,
    FontFace = globalThis.FontFace,
    logger = console,
} = {}) => {
    const activations = new Map();
    const facesByPack = new Map();

    const activatePack = async (packId) => {
        if (activations.has(packId)) return activations.get(packId);
        const activation = (async () => {
            if (!FONT_PACKS[packId] || !invoke || !convertFileSrc || !document?.fonts?.add || !FontFace) return false;
            const faces = [];
            try {
                const assets = await invoke("resolve_managed_font_assets", { packIds: [packId] });
                if (!Array.isArray(assets) || assets.length === 0) return false;
                for (const asset of assets) {
                    const descriptors = {
                        style: "normal",
                        ...(asset.weightRange ? { weight: `${asset.weightRange[0]} ${asset.weightRange[1]}` } : {}),
                        ...(PACK_UNICODE_RANGES[asset.packId] ? { unicodeRange: PACK_UNICODE_RANGES[asset.packId] } : {}),
                    };
                    const face = new FontFace(asset.family, `url(${convertFileSrc(asset.path)})`, descriptors);
                    const loadedFace = await face.load();
                    document.fonts.add(loadedFace);
                    faces.push(loadedFace);
                }
                facesByPack.set(packId, faces);
                return true;
            } catch (error) {
                faces.forEach((face) => document?.fonts?.delete?.(face));
                logger?.warn?.(`Managed font pack ${packId} could not be activated.`, error);
                return false;
            }
        })();
        activations.set(packId, activation);
        const activated = await activation;
        if (!activated && activations.get(packId) === activation) activations.delete(packId);
        return activated;
    };

    const activateLanguageProfiles = async (languageProfiles) => Promise.all(
        collectManagedPackIds(languageProfiles).map(activatePack),
    );

    const activateAvailablePack = (event) => activatePack(event?.payload?.packId ?? event?.packId);

    const deactivatePack = (packId) => {
        const faces = facesByPack.get(packId);
        if (!faces?.length) return false;
        faces.forEach((face) => document?.fonts?.delete?.(face));
        facesByPack.delete(packId);
        activations.delete(packId);
        return true;
    };

    return { activatePack, activateLanguageProfiles, activateAvailablePack, deactivatePack };
};
