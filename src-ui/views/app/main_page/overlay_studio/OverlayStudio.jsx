import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@useI18n";
import { useAppearance, useVr } from "@logics_configs";
import { ColorRoleEditor } from "@common_components";
import {
    applyDesktopOverlayGeometry,
    createDesktopOverlayPayload,
    DESKTOP_OVERLAY_DEFAULT_SETTINGS,
    DESKTOP_OVERLAY_MAX_MESSAGE_LOGS,
    DESKTOP_OVERLAY_SETTINGS_CHANNEL,
    DEFAULT_OVERLAY_COLOR_PALETTE,
    estimateDesktopOverlayFitHeight,
    getContrastRatio,
    getOverlayCssVariables,
    normalizeDesktopOverlaySettings,
    normalizeColorPalette,
    OVERLAY_COLOR_ROLE_GROUPS,
    openDesktopOverlayWindow,
    readDesktopOverlaySettings,
    sendDesktopOverlayControl,
    writeDesktopOverlaySettings,
} from "@logics_common";
import {
    useStore_MessageLogs,
    useStore_TranscriptionReceiveStatus,
    useStore_TranscriptionSendStatus,
    useStore_TranslationStatus,
} from "@store";
import { ui_configs } from "@ui_configs";
import { TopBar } from "../main_section/top_bar/TopBar";
import { DesktopOverlayPreview } from "../../desktop_overlay/DesktopOverlayPreview";
import styles from "./OverlayStudio.module.scss";

const overlayRoleLabelKeys = {
    primary: "primary",
    secondary: "secondary",
    border: "border",
    background: "background",
    panel: "panel",
    text: "text",
    textMuted: "text_muted",
    sent: "sent",
    received: "received",
    translation: "translation",
    success: "success",
    warning: "warning",
    error: "error",
    info: "info",
};

const overlayGroupLabelKeys = {
    brand: "brand",
    surfaces: "surfaces",
    content: "content",
    messages: "messages",
    status: "status",
};

const vrSettingsFor = (mode, smallSettings, largeSettings) => (
    mode === "large" ? largeSettings : smallSettings
);

const lastVisibleText = (messageLogs, translationsOnly) => {
    const lastLog = messageLogs.at?.(-1) ?? messageLogs[messageLogs.length - 1];
    if (!lastLog) return "";
    const translation = lastLog.messages?.translations?.find((item) => item?.message)?.message;
    return translation || (translationsOnly ? "" : lastLog.messages?.original?.message) || "";
};

export const OverlayStudio = () => {
    const { t } = useI18n();
    const { currentUiLanguage, currentSelectedFontFamily } = useAppearance();
    const {
        currentIsEnabledOverlaySmallLog,
        toggleIsEnabledOverlaySmallLog,
        currentIsEnabledOverlayLargeLog,
        toggleIsEnabledOverlayLargeLog,
        currentOverlaySmallLogSettings,
        setOverlaySmallLogSettings,
        currentOverlayLargeLogSettings,
        setOverlayLargeLogSettings,
        currentOverlayShowOnlyTranslatedMessages,
        currentOverlayColorPalette,
        updateOverlayColorPalette,
        setOverlayColorPalette,
    } = useVr();
    const { currentMessageLogs } = useStore_MessageLogs();
    const { currentTranslationStatus } = useStore_TranslationStatus();
    const { currentTranscriptionSendStatus } = useStore_TranscriptionSendStatus();
    const { currentTranscriptionReceiveStatus } = useStore_TranscriptionReceiveStatus();
    const [desktopSettings, setDesktopSettings] = useState(readDesktopOverlaySettings);
    const [vrMode, setVrMode] = useState("small");
    const [feedback, setFeedback] = useState("");
    const overlayPersistTimer = useRef(null);

    const smallSettings = currentOverlaySmallLogSettings.data ?? ui_configs.overlay_small_log_default_settings;
    const largeSettings = currentOverlayLargeLogSettings.data ?? ui_configs.overlay_large_log_default_settings;
    const activeVrSettings = vrSettingsFor(vrMode, smallSettings, largeSettings);
    const activeVrEnabled = vrMode === "large"
        ? currentIsEnabledOverlayLargeLog.data === true
        : currentIsEnabledOverlaySmallLog.data === true;
    const overlayPalette = useMemo(
        () => normalizeColorPalette(currentOverlayColorPalette.data, DEFAULT_OVERLAY_COLOR_PALETTE),
        [currentOverlayColorPalette.data],
    );
    const overlayVariables = useMemo(
        () => getOverlayCssVariables(overlayPalette),
        [overlayPalette],
    );
    const overlayGroups = useMemo(() => OVERLAY_COLOR_ROLE_GROUPS.map((group) => ({
        id: group.id,
        label: t(`main_page.overlay_studio.colors.groups.${overlayGroupLabelKeys[group.id]}`),
        description: t(`main_page.overlay_studio.colors.group_descriptions.${overlayGroupLabelKeys[group.id]}`),
        roles: group.roles.map((roleId) => ({
            id: roleId,
            label: t(`main_page.overlay_studio.colors.roles.${overlayRoleLabelKeys[roleId]}`),
            description: t(`main_page.overlay_studio.colors.role_descriptions.${overlayRoleLabelKeys[roleId]}`),
        })),
    })), [t]);
    const payload = useMemo(() => createDesktopOverlayPayload({
        messageLogs: currentMessageLogs.data,
        translationEnabled: currentTranslationStatus.data === true,
        speakingEnabled: currentTranscriptionSendStatus.data === true,
        listeningEnabled: currentTranscriptionReceiveStatus.data === true,
        uiLanguage: currentUiLanguage.data,
        fontFamily: currentSelectedFontFamily.data,
        overlayColorPalette: overlayPalette,
    }), [
        currentMessageLogs.data,
        currentTranslationStatus.data,
        currentTranscriptionSendStatus.data,
        currentTranscriptionReceiveStatus.data,
        currentUiLanguage.data,
        currentSelectedFontFamily.data,
        overlayPalette,
    ]);

    useEffect(() => () => {
        if (overlayPersistTimer.current) clearTimeout(overlayPersistTimer.current);
    }, []);
    const vrPreviewText = lastVisibleText(
        currentMessageLogs.data ?? [],
        currentOverlayShowOnlyTranslatedMessages.data === true,
    );

    useEffect(() => {
        const applyIncomingSettings = (nextSettings) => setDesktopSettings(normalizeDesktopOverlaySettings(nextSettings));
        const onStorage = (event) => {
            if (event.key === "vrcnt-desktop-overlay-settings") applyIncomingSettings(readDesktopOverlaySettings());
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

    const updateDesktopSettings = async (update) => {
        const nextCandidate = typeof update === "function" ? update(desktopSettings) : update;
        const nextSettings = writeDesktopOverlaySettings(nextCandidate);
        setDesktopSettings(nextSettings);
        await applyDesktopOverlayGeometry({ settings: nextSettings });
        return nextSettings;
    };

    const openDesktopOverlay = async () => {
        try {
            await openDesktopOverlayWindow();
            await applyDesktopOverlayGeometry({ settings: desktopSettings });
            setFeedback(t("main_page.overlay_studio.overlay_opened"));
        } catch (error) {
            console.error("Unable to open desktop overlay from Overlay Studio.", error);
            setFeedback(t("main_page.overlay_studio.overlay_open_error"));
        }
    };

    const fitToContent = async () => {
        const visibleLogCount = desktopSettings.expanded
            ? Math.min(DESKTOP_OVERLAY_MAX_MESSAGE_LOGS, currentMessageLogs.data?.length ?? 0)
            : Math.min(1, currentMessageLogs.data?.length ?? 0);
        const nextSettings = await updateDesktopSettings((current) => ({
            ...current,
            geometry: {
                ...current.geometry,
                autoHeight: true,
                height: Math.min(
                    current.geometry.maxHeight,
                    estimateDesktopOverlayFitHeight({
                        visibleLogCount,
                        messageTextScale: current.messageTextScale,
                    }),
                ),
            },
        }));
        await openDesktopOverlayWindow();
        await applyDesktopOverlayGeometry({ settings: nextSettings });
        sendDesktopOverlayControl({ type: "fit-to-content" });
        setFeedback(t("main_page.overlay_studio.fit_applied"));
    };

    const resetGeometry = async () => {
        const nextSettings = await updateDesktopSettings((current) => ({
            ...current,
            geometry: DESKTOP_OVERLAY_DEFAULT_SETTINGS.geometry,
        }));
        await applyDesktopOverlayGeometry({ settings: nextSettings });
        setFeedback(t("main_page.overlay_studio.geometry_reset"));
    };

    const persistOverlayPalette = (nextPalette) => {
        updateOverlayColorPalette(nextPalette);
        setFeedback(t("main_page.overlay_studio.colors.saving"));
        if (overlayPersistTimer.current) clearTimeout(overlayPersistTimer.current);
        overlayPersistTimer.current = setTimeout(() => {
            setOverlayColorPalette(nextPalette);
            setFeedback(t("main_page.overlay_studio.colors.saved"));
            overlayPersistTimer.current = null;
        }, 180);
    };

    const updateOverlayRole = (roleId, value) => {
        persistOverlayPalette(normalizeColorPalette(
            { ...overlayPalette, [roleId]: value },
            DEFAULT_OVERLAY_COLOR_PALETTE,
        ));
    };

    const resetOverlayRole = (roleId) => updateOverlayRole(roleId, DEFAULT_OVERLAY_COLOR_PALETTE[roleId]);
    const resetOverlayPalette = () => persistOverlayPalette({ ...DEFAULT_OVERLAY_COLOR_PALETTE });
    const getOverlayContrastWarning = (roleId, value) => {
        if (!roleId.startsWith("text")) return null;
        return getContrastRatio(value, overlayPalette.background) < 4.5
            ? t("main_page.overlay_studio.colors.contrast_warning")
            : null;
    };

    const updateActiveVrSettings = (key, value) => {
        const nextSettings = { ...activeVrSettings, [key]: value };
        if (vrMode === "large") setOverlayLargeLogSettings(nextSettings);
        else setOverlaySmallLogSettings(nextSettings);
    };

    const toggleActiveVrOverlay = () => {
        if (vrMode === "large") toggleIsEnabledOverlayLargeLog();
        else toggleIsEnabledOverlaySmallLog();
    };

    return (
        <div className={styles.container}>
            <TopBar />
            <main className={styles.content}>
                <header className={styles.hero}>
                    <div>
                        <p className={styles.eyebrow}>{t("main_page.overlay_studio.eyebrow")}</p>
                        <h1>{t("main_page.overlay_studio.title")}</h1>
                        <p>{t("main_page.overlay_studio.detail")}</p>
                    </div>
                    <button type="button" className={styles.open_button} onClick={openDesktopOverlay}>
                        {t("main_page.overlay_studio.open_desktop_overlay")}
                    </button>
                </header>

                <div className={styles.studio_grid}>
                    <div className={styles.preview_column}>
                        <section className={styles.desktop_card} aria-labelledby="desktop-overlay-heading">
                            <header className={styles.card_header}>
                                <div>
                                    <p className={styles.section_kicker}>{t("main_page.overlay_studio.desktop_kicker")}</p>
                                    <h2 id="desktop-overlay-heading">{t("main_page.overlay_studio.desktop_preview")}</h2>
                                    <p>{t("main_page.overlay_studio.desktop_detail")}</p>
                                </div>
                                <div className={styles.card_actions}>
                                    <button type="button" className={styles.secondary_button} onClick={fitToContent}>
                                        {t("main_page.overlay_studio.fit_to_content")}
                                    </button>
                                    <button type="button" className={styles.secondary_button} onClick={resetGeometry}>
                                        {t("main_page.overlay_studio.reset_size")}
                                    </button>
                                </div>
                            </header>
                            <div className={styles.preview_canvas}>
                                <DesktopOverlayPreview payload={payload} settings={desktopSettings} />
                            </div>
                        </section>

                        <section className={styles.vr_card} aria-labelledby="vr-overlay-heading">
                            <div className={styles.vr_heading}>
                                <div>
                                    <p className={styles.section_kicker}>{t("main_page.overlay_studio.vr_kicker")}</p>
                                    <h2 id="vr-overlay-heading">{t("main_page.overlay_studio.vr_preview")}</h2>
                                </div>
                                <label className={styles.switch_label}>
                                    <span>{t("main_page.overlay_studio.vr_enabled")}</span>
                                    <input type="checkbox" checked={activeVrEnabled} onChange={toggleActiveVrOverlay} />
                                    <span aria-hidden="true" className={styles.toggle_visual} />
                                </label>
                            </div>
                            <div
                                className={styles.vr_canvas}
                                style={{
                                    "--vr-accent": overlayPalette.primary,
                                    "--vr-accent-rgb": overlayVariables["--overlay_primary_color_rgb"],
                                    "--vr-opacity": activeVrSettings.opacity ?? 1,
                                    "--vr-message-text-scale": activeVrSettings.message_text_scale ?? 1,
                                }}
                            >
                                <div className={styles.vr_frame} data-enabled={activeVrEnabled}>
                                    <span>{activeVrSettings.tracker ?? "HMD"}</span>
                                    <strong>{vrPreviewText || t("main_page.desktop_overlay.waiting")}</strong>
                                    <small>{t("main_page.overlay_studio.vr_scale", { scale: Math.round((activeVrSettings.ui_scaling ?? 1) * 100) })}</small>
                                </div>
                            </div>
                            <div className={styles.vr_controls}>
                                <label className={styles.field}>
                                    <span>{t("main_page.overlay_studio.vr_mode")}</span>
                                    <select value={vrMode} onChange={(event) => setVrMode(event.target.value)}>
                                        <option value="small">{t("main_page.overlay_studio.small_overlay")}</option>
                                        <option value="large">{t("main_page.overlay_studio.large_overlay")}</option>
                                    </select>
                                </label>
                                <label className={styles.field}>
                                    <span>{t("main_page.overlay_studio.background")}</span>
                                    <select
                                        value={activeVrSettings.background_mode ?? "transparent_black"}
                                        onChange={(event) => updateActiveVrSettings("background_mode", event.target.value)}
                                    >
                                        <option value="transparent_black">{t("main_page.overlay_studio.transparent")}</option>
                                        <option value="solid_black">{t("main_page.overlay_studio.solid")}</option>
                                    </select>
                                </label>
                                <RangeControl
                                    label={t("main_page.overlay_studio.message_text_size")}
                                    value={Math.round((activeVrSettings.message_text_scale ?? 1) * 100)}
                                    min={40}
                                    max={200}
                                    step={10}
                                    suffix="%"
                                    onChange={(value) => updateActiveVrSettings("message_text_scale", value / 100)}
                                />
                            </div>
                        </section>
                    </div>

                    <div className={styles.control_grid}>
                        <section className={styles.geometry_card} aria-labelledby="geometry-heading">
                            <h2 id="geometry-heading">{t("main_page.overlay_studio.geometry_title")}</h2>
                            <RangeControl
                                label={t("main_page.overlay_studio.width")}
                                value={desktopSettings.geometry.width}
                                min={360}
                                max={960}
                                suffix="px"
                                onChange={(width) => updateDesktopSettings((current) => ({
                                    ...current,
                                    geometry: { ...current.geometry, width },
                                }))}
                            />
                            <RangeControl
                                label={t("main_page.overlay_studio.height")}
                                value={desktopSettings.geometry.height}
                                min={160}
                                max={desktopSettings.geometry.maxHeight}
                                suffix="px"
                                disabled={desktopSettings.geometry.autoHeight}
                                onChange={(height) => updateDesktopSettings((current) => ({
                                    ...current,
                                    geometry: { ...current.geometry, height, autoHeight: false },
                                }))}
                            />
                            <RangeControl
                                label={t("main_page.overlay_studio.max_height")}
                                value={desktopSettings.geometry.maxHeight}
                                min={200}
                                max={720}
                                suffix="px"
                                onChange={(maxHeight) => updateDesktopSettings((current) => ({
                                    ...current,
                                    geometry: {
                                        ...current.geometry,
                                        maxHeight,
                                        height: Math.min(current.geometry.height, maxHeight),
                                    },
                                }))}
                            />
                            <RangeControl
                                label={t("main_page.overlay_studio.opacity")}
                                value={desktopSettings.opacity}
                                min={45}
                                max={100}
                                suffix="%"
                                onChange={(opacity) => updateDesktopSettings((current) => ({ ...current, opacity }))}
                            />
                            <RangeControl
                                label={t("main_page.overlay_studio.message_text_size")}
                                value={desktopSettings.messageTextScale}
                                min={40}
                                max={200}
                                step={10}
                                suffix="%"
                                onChange={(messageTextScale) => updateDesktopSettings((current) => ({ ...current, messageTextScale }))}
                            />
                            <label className={styles.toggle_row}>
                                <span>{t("main_page.overlay_studio.auto_height")}</span>
                                <input
                                    type="checkbox"
                                    checked={desktopSettings.geometry.autoHeight}
                                    onChange={(event) => updateDesktopSettings((current) => ({
                                        ...current,
                                        geometry: { ...current.geometry, autoHeight: event.target.checked },
                                    }))}
                                />
                                <span aria-hidden="true" className={styles.toggle_visual} />
                            </label>
                        </section>

                        <section
                            className={styles.overlay_colors_card}
                            aria-label={t("main_page.overlay_studio.colors.editor_title")}
                        >
                            <div className={styles.overlay_color_editor}>
                                <ColorRoleEditor
                                    groups={overlayGroups}
                                    palette={overlayPalette}
                                    onChangeRole={updateOverlayRole}
                                    onResetRole={resetOverlayRole}
                                    onResetAll={resetOverlayPalette}
                                    resetLabel={t("main_page.overlay_studio.colors.reset_all")}
                                    getContrastWarning={getOverlayContrastWarning}
                                    labels={{
                                        kicker: t("main_page.overlay_studio.colors.editor_kicker"),
                                        title: t("main_page.overlay_studio.colors.editor_title"),
                                        description: t("main_page.overlay_studio.colors.editor_description"),
                                        reset: t("main_page.overlay_studio.colors.reset_role"),
                                        hue: t("config_page.appearance.colors.picker_hue"),
                                        saturation: t("config_page.appearance.colors.picker_saturation"),
                                        brightness: t("config_page.appearance.colors.picker_brightness"),
                                        hex: t("config_page.appearance.colors.picker_hex"),
                                        invalid: t("config_page.appearance.colors.picker_invalid"),
                                    }}
                                />
                            </div>
                            <p className={styles.sync_note}>{t("main_page.overlay_studio.colors.sync_detail")}</p>
                        </section>
                    </div>
                </div>
                <p className={styles.feedback} role="status" aria-live="polite">{feedback}</p>
            </main>
        </div>
    );
};

const RangeControl = ({ label, value, min, max, step = 1, suffix, disabled = false, onChange }) => {
    const numericValue = Number(value);
    const rangeProgress = max > min
        ? Math.min(100, Math.max(0, ((numericValue - min) / (max - min)) * 100))
        : 0;

    return (
        <label className={styles.range_control}>
            <span>{label}</span>
            <strong>{value}{suffix}</strong>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                disabled={disabled}
                style={{ "--range-progress": `${rangeProgress}%` }}
                onChange={(event) => onChange(Number(event.target.value))}
            />
        </label>
    );
};
