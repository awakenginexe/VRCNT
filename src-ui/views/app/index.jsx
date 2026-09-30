import React from "react";
import ReactDOM from "react-dom/client";
import "@root/locales/config.js";
import "./_index_css/root.css";
import "flag-icons/css/flag-icons.min.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createBrowserPreviewWindow, isTauriRuntime } from "@logics_common/tauriRuntime.js";
import { isDesktopOverlayRoute } from "@logics_common/desktopOverlayWindow.js";

import { store } from "@store";

store.appWindow = isTauriRuntime()
    ? getCurrentWindow()
    : createBrowserPreviewWindow();

import { App } from "./App";
import { DesktopOverlayApp } from "./desktop_overlay/DesktopOverlayApp";
import { UpdateDialog } from "./others/modal_controller/update_modal/UpdateModal";

const updatePreviewState = new URLSearchParams(window.location.search).get("state") || "default";
const showUpdatePreview = import.meta.env.DEV
    && !isTauriRuntime()
    && new URLSearchParams(window.location.search).get("preview") === "update";

const previewReleases = [
    {
        version: "5.16.0",
        tag: "v5.16.0",
        name: "VRCNT 5.16.0 · Preview fixture",
        published_at: "2026-09-13T00:00:00Z",
        url: "https://github.com/awakenginexe/VRCNT/releases",
        body: "- Sample release note for layout preview.\n- This fixture does not describe shipped product changes.",
    },
    {
        version: "5.15.4",
        tag: "v5.15.4",
        name: "VRCNT 5.15.4 · Preview fixture",
        published_at: "2026-09-10T00:00:00Z",
        url: "https://github.com/awakenginexe/VRCNT/releases",
        body: "Sample note for an intermediate version, included to preview skipped releases.",
    },
    {
        version: "5.14.0",
        tag: "v5.14.0",
        name: "VRCNT 5.14.0 · Preview fixture",
        published_at: "2026-08-28T00:00:00Z",
        url: "https://github.com/awakenginexe/VRCNT/releases",
        body: "Sample note for an older version, included to preview the full release history.",
    },
];

const UpdatePreview = () => {
    const state = updatePreviewState;
    const upToDate = state === "up-to-date";
    const loading = state === "loading";
    const catalogError = state === "error";
    const downloading = state === "download";
    const info = {
        installed_version: upToDate ? "5.16.0" : "5.13.0",
        new_version: "5.16.0",
        is_update_available: !upToDate,
        release_url: "https://github.com/PrismAudio/VRCNT/releases",
        releases: loading || catalogError || upToDate ? [] : previewReleases,
        catalog_checked: !loading,
        notes_complete: !loading && !catalogError,
    };

    return (
        <main style={{ minHeight: "100vh", padding: "3rem", display: "grid", placeItems: "center" }}>
            <UpdateDialog
                info={info}
                status={loading ? "loading" : catalogError ? "error" : "ready"}
                error={catalogError ? "Preview fixture: sample release catalog error." : null}
                updateState={downloading ? {
                    status: "downloading",
                    progress: 0.58,
                    version: "5.16.0",
                    message: "Preview fixture: sample installation progress.",
                    is_indeterminate: false,
                } : { status: "idle", progress: 0, message: "", is_indeterminate: false }}
                onUpdate={() => {}}
                onRefresh={() => {}}
                onRelease={() => {}}
                onClose={() => {}}
                isPreview
            />
        </main>
    );
};

const RootApp = isDesktopOverlayRoute()
    ? DesktopOverlayApp
    : showUpdatePreview
        ? UpdatePreview
        : App;

ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <RootApp />
    </React.StrictMode>,
);
