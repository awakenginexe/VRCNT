import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAppearance } from "@logics_configs";
import { useLanguageSettings } from "@logics_main";
import {
    FONT_DOWNLOAD_POLICY,
    applyFontPackProgress,
    createFontPackManagementState,
    getRequiredOptionalPackIds,
    getOptionalFontPackCatalog,
    normalizeFontDownloadPolicy,
    removeOptionalFontPack,
    requestOptionalFontPack,
    requestRequiredOptionalFontPack,
} from "@logics_common";
import { isTauriRuntime } from "@logics_common/tauriRuntime.js";
import styles from "./FontPackManagement.module.scss";

const policyOptions = [
    [FONT_DOWNLOAD_POLICY.ASK, "Ask before downloading"],
    [FONT_DOWNLOAD_POLICY.AUTOMATIC, "Automatically download required fonts"],
    [FONT_DOWNLOAD_POLICY.NEVER, "Never download; use system fallback"],
];

const ReviewSurface = () => import.meta.env.DEV ? (
    <div className={styles.review_surface} data-testid="font-review-surface">
        <strong>Managed-font review</strong>
        <span>English · ไทย · 日本語 · 简体中文 · 繁體中文 · 한국어 · العربية · हिन्दी</span>
    </div>
) : null;

export const FontPackManagement = () => {
    const {
        currentFontDownloadPolicy,
        currentSelectedFontFamily,
        setFontDownloadPolicy,
    } = useAppearance();
    const {
        currentSelectedYourLanguages,
        currentSelectedYourTranslationLanguages,
        currentSelectedTargetLanguages,
    } = useLanguageSettings();
    const [catalog, setCatalog] = useState({ totalBytes: 0, packs: [] });
    const [progress, setProgress] = useState({});
    const [promptPackId, setPromptPackId] = useState(null);
    const policy = normalizeFontDownloadPolicy(currentFontDownloadPolicy.data);
    const managedFamilySelected = currentSelectedFontFamily.data === "VRCNT Noto";
    const state = useMemo(() => createFontPackManagementState(catalog, { managedFamilySelected }), [catalog, managedFamilySelected]);
    const requiredOptionalPackIds = useMemo(() => getRequiredOptionalPackIds([
        ...Object.values(currentSelectedYourLanguages.data ?? {}).flatMap(Object.values),
        ...Object.values(currentSelectedYourTranslationLanguages.data ?? {}).flatMap(Object.values),
        ...Object.values(currentSelectedTargetLanguages.data ?? {}).flatMap(Object.values),
    ]), [
        currentSelectedTargetLanguages.data,
        currentSelectedYourLanguages.data,
        currentSelectedYourTranslationLanguages.data,
    ]);

    const refresh = async () => {
        if (!isTauriRuntime()) return;
        setCatalog(await getOptionalFontPackCatalog(invoke));
    };

    useEffect(() => {
        refresh().catch(console.warn);
        if (!isTauriRuntime()) return undefined;
        let disposed = false;
        let unlisten;
        listen("font-pack-download-progress", ({ payload }) => {
            setProgress((current) => applyFontPackProgress(current, payload));
            if (payload?.state === "complete") refresh().catch(console.warn);
        }).then((dispose) => {
            if (disposed) dispose();
            else unlisten = dispose;
        });
        return () => {
            disposed = true;
            unlisten?.();
        };
    }, []);

    useEffect(() => {
        const onRequiredPack = (event) => {
            if (policy === FONT_DOWNLOAD_POLICY.ASK && event.detail?.packId) {
                setPromptPackId((current) => current ?? event.detail.packId);
            }
        };
        globalThis.addEventListener("vrcnt-font-pack-required", onRequiredPack);
        return () => globalThis.removeEventListener("vrcnt-font-pack-required", onRequiredPack);
    }, [policy]);

    useEffect(() => {
        if (!isTauriRuntime() || policy !== FONT_DOWNLOAD_POLICY.ASK) return undefined;
        let disposed = false;
        requiredOptionalPackIds.forEach((packId) => {
            requestRequiredOptionalFontPack(invoke, packId, policy, (missingPackId) => {
                if (!disposed) setPromptPackId((current) => current ?? missingPackId);
            }).catch(console.warn);
        });
        return () => {
            disposed = true;
        };
    }, [policy, requiredOptionalPackIds]);

    const request = async (packId, confirmed = false) => {
        const outcome = await requestOptionalFontPack(invoke, packId, policy, confirmed);
        if (outcome.action === "ask") {
            setPromptPackId(packId);
            return;
        }
        setPromptPackId(null);
        await refresh();
    };

    const remove = async (packId) => {
        setCatalog(await removeOptionalFontPack(invoke, packId));
        globalThis.dispatchEvent(new CustomEvent("vrcnt-font-pack-removed", { detail: { packId } }));
        setProgress((current) => {
            const next = { ...current };
            delete next[packId];
            return next;
        });
    };

    return (
        <section className={styles.container} aria-label="Optional font packs">
            <div className={styles.header}>
                <div>
                    <h3>Optional font packs</h3>
                    <p>Verified Noto packs are used when available. Missing packs always keep system fallback active.</p>
                    <p>{managedFamilySelected
                        ? "VRCNT Noto is selected; verified packs activate on demand and failed faces use system fallback."
                        : "A system font is selected; installed packs remain available without claiming activation."}</p>
                </div>
                <span className={styles.cache_size}>Cache: {state.totalSizeLabel}</span>
            </div>
            <label className={styles.policy}>
                <span>Font download policy</span>
                <select value={policy} onChange={(event) => setFontDownloadPolicy(event.target.value)}>
                    {policyOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
            </label>
            {promptPackId && (
                <div className={styles.prompt} role="alertdialog" aria-label="Download required font pack">
                    <span>This writing system needs an optional verified Noto pack. System fallback remains active until it is installed.</span>
                    <button onClick={() => request(promptPackId, true)}>Download required pack</button>
                    <button onClick={() => setPromptPackId(null)}>Use system fallback</button>
                </div>
            )}
            <div className={styles.pack_list}>
                {state.packs.map((pack) => {
                    const task = progress[pack.id];
                    return (
                        <article className={styles.pack} key={pack.id}>
                            <div>
                                <strong>{pack.displayName}</strong>
                                <span>{pack.writingSystems} · v{pack.packVersion} · {pack.sizeLabel}</span>
                                <small>{pack.activationStatus}</small>
                                {task && <small>{task.state} {task.totalBytes ? `${Math.round((task.receivedBytes / task.totalBytes) * 100)}%` : ""}{task.error ? `: ${task.error}` : ""}</small>}
                            </div>
                            {pack.installed
                                ? <button onClick={() => remove(pack.id)}>Remove</button>
                                : <button onClick={() => request(pack.id)}> {task?.state === "failed" ? "Retry" : "Download"} </button>}
                        </article>
                    );
                })}
            </div>
            <ReviewSurface />
        </section>
    );
};
