import { useEffect, useMemo } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAppearance } from "@logics_configs";
import { useLanguageSettings } from "@logics_main";
import { useStore_SelectableFontFamilyList } from "@store";
import {
    applyManagedFontVariables,
    createManagedFontRuntime,
    FONT_DOWNLOAD_POLICY,
    getRequiredOptionalPackIds,
    normalizeManagedFontPreference,
    normalizeFontDownloadPolicy,
    requestOptionalFontPack,
    requestRequiredOptionalFontPack,
} from "@logics_common";
import { isTauriRuntime } from "@logics_common/tauriRuntime.js";

export const FontFamilyController = () => {
    const {
        currentSelectedFontFamily,
        setSelectedFontFamily,
        currentFontDownloadPolicy,
    } = useAppearance();
    const { currentSelectableFontFamilyList } = useStore_SelectableFontFamilyList();
    const {
        currentSelectedYourLanguages,
        currentSelectedYourTranslationLanguages,
        currentSelectedTargetLanguages,
    } = useLanguageSettings();
    const systemFontFamilies = useMemo(() => Object.keys(currentSelectableFontFamilyList.data ?? {})
        .filter((family) => family !== "VRCNT Noto"), [currentSelectableFontFamilyList.data]);
    const selected = normalizeManagedFontPreference(currentSelectedFontFamily.data, systemFontFamilies.length ? systemFontFamilies : null);
    const fontDownloadPolicy = normalizeFontDownloadPolicy(currentFontDownloadPolicy.data);

    useEffect(() => {
        applyManagedFontVariables(document.documentElement, selected);
    }, [selected]);

    useEffect(() => {
        if (currentSelectedFontFamily.state === "ok" && selected !== currentSelectedFontFamily.data) {
            setSelectedFontFamily(selected);
        }
    }, [currentSelectedFontFamily.data, currentSelectedFontFamily.state, selected, setSelectedFontFamily]);

    useEffect(() => {
        if (!isTauriRuntime() || selected !== "VRCNT Noto") return undefined;
        const runtime = createManagedFontRuntime({ invoke, convertFileSrc });
        const profiles = [
            ...Object.values(currentSelectedYourLanguages.data ?? {}).flatMap(Object.values),
            ...Object.values(currentSelectedYourTranslationLanguages.data ?? {}).flatMap(Object.values),
            ...Object.values(currentSelectedTargetLanguages.data ?? {}).flatMap(Object.values),
        ];
        runtime.activateLanguageProfiles(profiles);
        const requiredOptionalPackIds = getRequiredOptionalPackIds(profiles);
        if (fontDownloadPolicy === FONT_DOWNLOAD_POLICY.AUTOMATIC) {
            requiredOptionalPackIds.forEach((packId) => {
                requestOptionalFontPack(invoke, packId, fontDownloadPolicy).catch(console.warn);
            });
        } else if (fontDownloadPolicy === FONT_DOWNLOAD_POLICY.ASK) {
            requiredOptionalPackIds.forEach((packId) => {
                requestRequiredOptionalFontPack(invoke, packId, fontDownloadPolicy, (requiredPackId) => {
                    globalThis.dispatchEvent(new CustomEvent("vrcnt-font-pack-required", { detail: { packId: requiredPackId } }));
                }).catch(console.warn);
            });
        }
        let unlisten;
        let disposed = false;
        listen("font-pack-download-progress", (event) => {
            if (event.payload?.state === "complete") runtime.activateAvailablePack(event);
        }).then((dispose) => {
            if (disposed) dispose();
            else unlisten = dispose;
        });
        const onPackRemoved = (event) => runtime.deactivatePack(event.detail?.packId);
        globalThis.addEventListener("vrcnt-font-pack-removed", onPackRemoved);
        return () => {
            disposed = true;
            unlisten?.();
            globalThis.removeEventListener("vrcnt-font-pack-removed", onPackRemoved);
        };
    }, [
        currentSelectedTargetLanguages.data,
        currentSelectedYourLanguages.data,
        currentSelectedYourTranslationLanguages.data,
        fontDownloadPolicy,
        selected,
    ]);

    return null;
};
