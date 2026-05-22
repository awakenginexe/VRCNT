import { useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useSoftwareVersion } from "./useSoftwareVersion";
import { useIsSoftwareUpdating } from "./useIsSoftwareUpdating";
import { useNotificationStatus } from "./useNotificationStatus";

export const useUpdateSoftware = () => {
    const { currentLatestSoftwareVersionInfo } = useSoftwareVersion();
    const { updateIsSoftwareUpdating } = useIsSoftwareUpdating();
    const { showNotification_Error, showNotification_Success } = useNotificationStatus();
    const [updateState, setUpdateState] = useState({
        status: "idle",
        progress: 0,
        message: "",
    });

    const openReleaseFallback = () => {
        const releaseUrl = currentLatestSoftwareVersionInfo.data.release_url;
        if (releaseUrl) window.open(releaseUrl, "_blank", "noopener,noreferrer");
    };

    const updateSoftware = async () => {
        try {
            setUpdateState({ status: "checking", progress: 0, message: "Checking for update..." });
            const update = await check();
            if (!update) {
                setUpdateState({ status: "idle", progress: 0, message: "" });
                openReleaseFallback();
                return;
            }

            updateIsSoftwareUpdating(true);
            let downloaded = 0;
            let contentLength = 0;
            setUpdateState({ status: "downloading", progress: 0, message: "Downloading update..." });

            await update.downloadAndInstall((event) => {
                switch (event.event) {
                    case "Started":
                        contentLength = event.data.contentLength ?? 0;
                        downloaded = 0;
                        setUpdateState({
                            status: "downloading",
                            progress: 0,
                            message: "Downloading update...",
                        });
                        break;
                    case "Progress":
                        downloaded += event.data.chunkLength ?? 0;
                        setUpdateState({
                            status: "downloading",
                            progress: contentLength > 0 ? Math.min(downloaded / contentLength, 1) : 0,
                            message: "Downloading update...",
                        });
                        break;
                    case "Finished":
                        setUpdateState({
                            status: "installing",
                            progress: 1,
                            message: "Installing update...",
                        });
                        break;
                    default:
                        break;
                }
            });

            showNotification_Success("Update installed. Restarting VRCNT...");
            setUpdateState({ status: "restarting", progress: 1, message: "Restarting..." });
            await relaunch();
        } catch (error) {
            console.error("Update failed:", error);
            updateIsSoftwareUpdating(false);
            setUpdateState({
                status: "error",
                progress: 0,
                message: "Automatic update failed. Opening releases...",
            });
            showNotification_Error(`Automatic update failed: ${String(error)}`, { hide_duration: 10000 });
            openReleaseFallback();
        }
    };

    return {
        updateSoftware,
        updateState,
    };
};
