import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { PhysicalSize } from "@tauri-apps/api/window";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useI18n } from "@useI18n";
import {
    DESKTOP_OVERLAY_CHANNEL,
    DESKTOP_OVERLAY_CONTROL_CHANNEL,
    DESKTOP_OVERLAY_SETTINGS_CHANNEL,
    DESKTOP_OVERLAY_WINDOW_CONSTRAINTS,
    estimateDesktopOverlayFitHeight,
    readDesktopOverlayPayload,
    readDesktopOverlaySettings,
    createDesktopOverlayPayload,
    getDesktopOverlayLanguageProfiles,
    normalizeDesktopOverlaySettings,
    writeDesktopOverlaySettings,
    createManagedFontRuntime,
    applyManagedFontVariables,
} from "@logics_common";
import { store, useStore_MessageLogs } from "@store";
import ConfigurationSvg from "@images/configuration.svg?react";
import ForegroundSvg from "@images/foreground.svg?react";
import XMarkSvg from "@images/x_mark.svg?react";
import {
    createDesktopOverlayStyle,
    DesktopOverlayMessageStack,
    DesktopOverlayStatusStrip,
} from "./DesktopOverlayPreview";
import styles from "./DesktopOverlayApp.module.scss";

export const DesktopOverlayApp = () => {
    const { t, i18n } = useI18n();
    const { currentMessageLogs } = useStore_MessageLogs();
    const [payload, setPayload] = useState(() => (
        readDesktopOverlayPayload() ?? createDesktopOverlayPayload({ messageLogs: currentMessageLogs.data })
    ));
    const [settings, setSettings] = useState(readDesktopOverlaySettings);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const panelRef = useRef(null);

    useEffect(() => {
        document.documentElement.classList.add(styles.desktop_overlay_root);
        document.body.classList.add(styles.desktop_overlay_body);

        return () => {
            document.documentElement.classList.remove(styles.desktop_overlay_root);
            document.body.classList.remove(styles.desktop_overlay_body);
        };
    }, []);

    useEffect(() => {
        const runtime = createManagedFontRuntime({ invoke, convertFileSrc });
        const profiles = getDesktopOverlayLanguageProfiles(payload)
            .map((language) => typeof language === "string" ? { language } : language);
        runtime.activateLanguageProfiles(profiles);
        let unlisten;
        let disposed = false;
        listen("font-pack-download-progress", (event) => {
            if (event.payload?.state === "complete") runtime.activateAvailablePack(event);
        }).then((dispose) => {
            if (disposed) dispose();
            else unlisten = dispose;
        });
        return () => {
            disposed = true;
            unlisten?.();
        };
    }, [payload]);

    useEffect(() => {
        applyManagedFontVariables(document.documentElement, payload?.fontFamily);
    }, [payload?.fontFamily]);

    useEffect(() => {
        writeDesktopOverlaySettings(settings);
        store.appWindow?.setAlwaysOnTop?.(settings.pinned === true);
    }, [settings]);

    useEffect(() => {
        if (payload?.uiLanguage) i18n.changeLanguage(payload.uiLanguage);
    }, [i18n, payload?.uiLanguage]);

    useEffect(() => {
        try {
            const channel = new BroadcastChannel(DESKTOP_OVERLAY_CHANNEL);
            channel.onmessage = (event) => setPayload(event.data);
            return () => channel.close();
        } catch (error) {
            console.warn("Unable to listen for desktop overlay payload.", error);
            return undefined;
        }
    }, []);

    useEffect(() => {
        const applyIncomingSettings = (nextSettings) => {
            setSettings(normalizeDesktopOverlaySettings(nextSettings));
        };
        const onStorage = (event) => {
            if (event.key === "vrcnt-desktop-overlay-settings") {
                applyIncomingSettings(readDesktopOverlaySettings());
            }
        };

        globalThis.addEventListener?.("storage", onStorage);
        try {
            const channel = new BroadcastChannel(DESKTOP_OVERLAY_SETTINGS_CHANNEL);
            channel.onmessage = (event) => applyIncomingSettings(event.data);
            return () => {
                globalThis.removeEventListener?.("storage", onStorage);
                channel.close();
            };
        } catch {
            return () => globalThis.removeEventListener?.("storage", onStorage);
        }
    }, []);

    useEffect(() => {
        const intervalId = setInterval(() => {
            const storedPayload = readDesktopOverlayPayload();
            if (storedPayload) setPayload(storedPayload);
        }, 600);

        return () => clearInterval(intervalId);
    }, []);

    const startDragging = (event) => {
        if (event.button !== 0) return;
        if (event.target.closest("button, input, label")) return;
        store.appWindow?.startDragging?.();
    };

    const updateSetting = (key, value) => {
        setSettings((currentSettings) => ({
            ...currentSettings,
            [key]: value,
        }));
    };

    const fitToContent = useCallback(async () => {
        const visibleLogCount = settings.expanded
            ? (payload?.messageLogs?.slice(-3).length ?? 0)
            : Math.min(1, payload?.messageLogs?.length ?? 0);
        const measuredHeight = panelRef.current?.scrollHeight
            ? Math.ceil(panelRef.current.scrollHeight + 24)
            : estimateDesktopOverlayFitHeight({ visibleLogCount });
        const height = Math.min(
            settings.geometry.maxHeight,
            Math.max(DESKTOP_OVERLAY_WINDOW_CONSTRAINTS.minHeight, measuredHeight),
        );
        const nextSettings = normalizeDesktopOverlaySettings({
            ...settings,
            geometry: {
                ...settings.geometry,
                height,
                autoHeight: true,
            },
        });

        setSettings((currentSettings) => (
            currentSettings.geometry.height === nextSettings.geometry.height
            && currentSettings.geometry.autoHeight === nextSettings.geometry.autoHeight
                ? currentSettings
                : nextSettings
        ));
        await store.appWindow?.setSize?.(new PhysicalSize(
            nextSettings.geometry.width,
            nextSettings.geometry.height,
        ));
    }, [payload?.messageLogs, settings]);

    useEffect(() => {
        if (!settings.geometry.autoHeight) return undefined;
        const frameId = globalThis.requestAnimationFrame?.(() => {
            fitToContent();
        });
        return () => {
            if (frameId !== undefined) globalThis.cancelAnimationFrame?.(frameId);
        };
    }, [fitToContent, settings.geometry.autoHeight]);

    useEffect(() => {
        let dispose;
        const listenForFitToContent = () => {
            try {
                const channel = new BroadcastChannel(DESKTOP_OVERLAY_CONTROL_CHANNEL);
                channel.onmessage = (event) => {
                    if (event.data?.type === "fit-to-content") fitToContent();
                };
                dispose = () => channel.close();
            } catch {
                dispose = undefined;
            }
        };
        listenForFitToContent();
        return () => dispose?.();
    }, [fitToContent]);

    useEffect(() => {
        let unlisten;
        const persistManualGeometry = async () => {
            const size = await store.appWindow?.outerSize?.();
            if (!size) return;
            setSettings((currentSettings) => normalizeDesktopOverlaySettings({
                ...currentSettings,
                geometry: {
                    ...currentSettings.geometry,
                    width: size.width,
                    height: size.height,
                    autoHeight: false,
                },
            }));
        };

        store.appWindow?.onResized?.(persistManualGeometry)
            ?.then?.((unsubscribe) => {
                unlisten = unsubscribe;
            });
        return () => unlisten?.();
    }, []);

    const closeOverlay = () => {
        store.appWindow?.close?.();
    };

    return (
        <div
            className={styles.overlay_shell}
            style={createDesktopOverlayStyle(settings)}
            onMouseDown={startDragging}
        >
            <section ref={panelRef} className={styles.overlay_panel}>
                <header className={styles.header}>
                    <div className={styles.title_group}>
                        <p className={styles.eyebrow}>VRCNT</p>
                        <h1 className={styles.title}>{t("main_page.desktop_overlay.title")}</h1>
                    </div>
                    <div className={styles.header_controls}>
                        <button
                            className={clsx(styles.icon_button, { [styles.is_active]: settings.pinned })}
                            onClick={() => updateSetting("pinned", !settings.pinned)}
                            aria-label={settings.pinned
                                ? t("main_page.desktop_overlay.unpin")
                                : t("main_page.desktop_overlay.pin")}
                        >
                            <ForegroundSvg className={styles.icon} />
                        </button>
                        <button
                            className={clsx(styles.icon_button, { [styles.is_active]: isSettingsOpen })}
                            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                            aria-label={t("main_page.desktop_overlay.settings")}
                        >
                            <ConfigurationSvg className={styles.icon} />
                        </button>
                        <button
                            className={styles.icon_button}
                            onClick={closeOverlay}
                            aria-label={t("main_page.desktop_overlay.close")}
                        >
                            <XMarkSvg className={styles.icon} />
                        </button>
                    </div>
                </header>

                <DesktopOverlayStatusStrip statuses={payload?.statuses} />
                <DesktopOverlayMessageStack
                    payload={payload}
                    settings={settings}
                    className={styles.log_stack}
                />

                {isSettingsOpen && (
                    <div className={styles.settings_panel}>
                        <p className={styles.settings_title}>{t("main_page.desktop_overlay.settings_title")}</p>
                        <RangeSetting
                            label={t("config_page.vr.opacity")}
                            value={settings.opacity}
                            min={45}
                            max={100}
                            step={5}
                            suffix="%"
                            onChange={(value) => updateSetting("opacity", value)}
                        />
                        <RangeSetting
                            label={t("config_page.vr.ui_scaling")}
                            value={settings.scale}
                            min={80}
                            max={130}
                            step={5}
                            suffix="%"
                            onChange={(value) => updateSetting("scale", value)}
                        />
                        <ToggleSetting
                            label={t("main_page.desktop_overlay.translations_only")}
                            checked={settings.translationsOnly}
                            onChange={(checked) => updateSetting("translationsOnly", checked)}
                        />
                        <ToggleSetting
                            label={t("main_page.desktop_overlay.expanded_view")}
                            checked={settings.expanded}
                            onChange={(checked) => updateSetting("expanded", checked)}
                        />
                    </div>
                )}
            </section>
        </div>
    );
};

const RangeSetting = ({ label, value, min, max, step, suffix, onChange }) => (
    <label className={styles.range_setting}>
        <span className={styles.setting_label}>{label}</span>
        <input
            className={styles.range_input}
            type="range"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className={styles.setting_value}>{value}{suffix}</span>
    </label>
);

const ToggleSetting = ({ label, checked, onChange }) => (
    <label className={styles.toggle_setting}>
        <span className={styles.setting_label}>{label}</span>
        <input
            className={styles.checkbox}
            type="checkbox"
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
        />
        <span className={styles.toggle_visual}></span>
    </label>
);
