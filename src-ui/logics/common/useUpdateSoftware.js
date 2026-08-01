import { useRef, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useI18n } from "@useI18n";
import { useSoftwareVersion } from "./useSoftwareVersion";
import { useNotificationStatus } from "./useNotificationStatus";
import { isTauriRuntime } from "./tauriRuntime";

export const useUpdateSoftware = () => {
    const {
        currentLatestSoftwareVersionInfo,
        updateLatestSoftwareVersionInfo,
    } = useSoftwareVersion();
    const { showNotification_Error, showNotification_Success } = useNotificationStatus();
    const { t } = useI18n();
    const updateInFlightRef = useRef(false);
    const [updateState, setUpdateState] = useState({
        status: "idle",
        progress: 0,
        message: "",
        version: "",
        is_indeterminate: false,
    });

    const openReleaseFallback = () => {
        const releaseUrl = currentLatestSoftwareVersionInfo.data.release_url;
        if (!releaseUrl || typeof window === "undefined") return false;
        window.open(releaseUrl, "_blank", "noopener,noreferrer");
        return true;
    };

    const updateSoftware = async () => {
        if (updateInFlightRef.current) return;
        updateInFlightRef.current = true;
        let pendingUpdate = null;

        try {
            if (!isTauriRuntime()) {
                setUpdateState({
                    status: "opening",
                    progress: 1,
                    message: t("update_modal.opening_releases"),
                    version: "",
                    is_indeterminate: false,
                });
                openReleaseFallback();
                showNotification_Success(t("update_modal.opened_releases"));
                setUpdateState({
                    status: "idle",
                    progress: 0,
                    message: "",
                    version: "",
                    is_indeterminate: false,
                });
                return;
            }

            setUpdateState({
                status: "checking",
                progress: 0,
                message: t("update_modal.checking"),
                version: "",
                is_indeterminate: true,
            });

            pendingUpdate = await check();
            if (!pendingUpdate) {
                updateLatestSoftwareVersionInfo((previous) => ({
                    ...previous.data,
                    is_update_available: false,
                }));
                showNotification_Success(t("update_modal.up_to_date"));
                setUpdateState({
                    status: "idle",
                    progress: 0,
                    message: "",
                    version: "",
                    is_indeterminate: false,
                });
                return;
            }

            const version = pendingUpdate.version || currentLatestSoftwareVersionInfo.data.new_version;
            updateLatestSoftwareVersionInfo((previous) => ({
                ...previous.data,
                is_update_available: true,
                new_version: version,
            }));
            let contentLength = 0;
            let downloadedBytes = 0;
            let lastProgressUpdate = 0;

            setUpdateState({
                status: "downloading",
                progress: 0,
                message: t("update_modal.downloading"),
                version,
                is_indeterminate: true,
            });

            const publishProgress = (force = false) => {
                const now = Date.now();
                if (!force && now - lastProgressUpdate < 100) return;
                lastProgressUpdate = now;
                const hasContentLength = contentLength > 0;
                setUpdateState((current) => ({
                    ...current,
                    progress: hasContentLength
                        ? Math.min(downloadedBytes / contentLength, 1)
                        : current.progress,
                    is_indeterminate: !hasContentLength,
                }));
            };

            await pendingUpdate.downloadAndInstall((event) => {
                if (event.event === "Started") {
                    contentLength = Number(event.data.contentLength) || 0;
                    downloadedBytes = 0;
                    publishProgress(true);
                    return;
                }
                if (event.event === "Progress") {
                    downloadedBytes += Number(event.data.chunkLength) || 0;
                    publishProgress();
                    return;
                }
                publishProgress(true);
            });

            setUpdateState({
                status: "restarting",
                progress: 1,
                message: t("update_modal.restarting"),
                version,
                is_indeterminate: false,
            });
            await relaunch();
        } catch (error) {
            console.error("Update failed:", error);
            setUpdateState({
                status: "error",
                progress: 0,
                message: t("update_modal.error"),
                version: pendingUpdate?.version || "",
                is_indeterminate: false,
            });
            showNotification_Error(`${t("update_modal.error")} ${String(error)}`, { hide_duration: 10000 });
        } finally {
            if (pendingUpdate) {
                try {
                    await pendingUpdate.close();
                } catch (error) {
                    console.warn("Could not close update resource:", error);
                }
            }
            updateInFlightRef.current = false;
        }
    };

    return {
        updateSoftware,
        openReleaseFallback,
        updateState,
    };
};
