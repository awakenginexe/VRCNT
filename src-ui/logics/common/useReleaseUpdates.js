import { useCallback, useEffect } from "react";
import { useAtomValue, useStore } from "jotai";
import { invoke } from "@tauri-apps/api/core";
import { fetch as nativeFetch } from "@tauri-apps/plugin-http";
import { check } from "@tauri-apps/plugin-updater";
import { Atom_LatestSoftwareVersionInfo } from "@store";
import { version } from "../../../package.json";
import { isTauriRuntime } from "./tauriRuntime.js";
import { fetchReleaseHistory, selectReleaseUpdates } from "./releaseUpdates.js";

const pendingChecks = new WeakMap();

export const useReleaseUpdates = ({ enabled = true } = {}) => {
    const store = useStore();
    const current = useAtomValue(Atom_LatestSoftwareVersionInfo);
    const refresh = useCallback(() => {
        if (pendingChecks.has(store)) return pendingChecks.get(store);
        const patch = (data) => store.set(Atom_LatestSoftwareVersionInfo, (previous) => ({
            ...previous, data: { ...previous.data, ...data },
        }));
        patch({ check_status: "loading", check_error: null });
        const task = (async () => {
            const native = isTauriRuntime();
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            try {
                const installed = native ? await invoke("get_installed_release_version") : version;
                patch({ installed_version: installed });
                const history = await fetchReleaseHistory(native ? nativeFetch : window.fetch.bind(window), controller.signal);
                patch({ ...selectReleaseUpdates(history, installed), check_status: "ready", check_error: null });
            } catch (error) {
                if (native && !store.get(Atom_LatestSoftwareVersionInfo).data.catalog_checked) {
                    let update;
                    try {
                        update = await check({ timeout: 15000 });
                        patch({
                            update_checked: true,
                            is_update_available: Boolean(update),
                            new_version: update?.version || store.get(Atom_LatestSoftwareVersionInfo).data.installed_version,
                            release_url: update ? `https://github.com/awakenginexe/VRCNT/releases/tag/v${update.version}` : "https://github.com/awakenginexe/VRCNT/releases",
                            notes_complete: false,
                        });
                    } catch (fallbackError) {
                        console.warn("Could not check the signed update fallback:", fallbackError);
                    } finally {
                        if (update) await update.close().catch(() => {});
                    }
                }
                patch({ check_status: "error", check_error: String(error) });
            } finally {
                clearTimeout(timeout);
                pendingChecks.delete(store);
            }
        })();
        pendingChecks.set(store, task);
        return task;
    }, [store]);
    const status = current.data.check_status ?? "idle";
    useEffect(() => {
        if (enabled && status === "idle") void refresh();
    }, [enabled, status, refresh]);
    return { info: current.data, status, error: current.data.check_error ?? null, refresh };
};
