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
    normalizeOverlaySettings,
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
import { randomIntMinMax } from "@utils";
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
        toggleOverlayShowOnlyTranslatedMessages,
        currentOverlayShowOnlyReceivedMessages,
        toggleOverlayShowOnlyReceivedMessages,
        sendTextToOverlay,
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
    const [vrTransformMode, setVrTransformMode] = useState("position");
    const [isSampleTextEnabled, setIsSampleTextEnabled] = useState(false);
    const [feedback, setFeedback] = useState("");
    const overlayPersistTimer = useRef(null);
    const sampleTextSenderRef = useRef(sendTextToOverlay);
    const translateRef = useRef(t);
    sampleTextSenderRef.current = sendTextToOverlay;
    translateRef.current = t;

    const smallSettings = currentOverlaySmallLogSettings.data ?? ui_configs.overlay_small_log_default_settings;
    const largeSettings = currentOverlayLargeLogSettings.data ?? ui_configs.overlay_large_log_default_settings;
    const activeVrSettings = normalizeOverlaySettings(
        vrSettingsFor(vrMode, smallSettings, largeSettings),
        vrMode,
    );
    const activeVrHeight = activeVrSettings.canvas_height || 304;
    const isVrAutoHeight = activeVrSettings.canvas_height === 0;
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

    useEffect(() => {
        if (!isSampleTextEnabled) return undefined;

        const sendSampleText = () => {
            const sampleText = Array.from(
                { length: randomIntMinMax(1, 5) },
                () => translateRef.current("config_page.vr.sample_text_button.sample_text"),
            ).join(" ");
            sampleTextSenderRef.current(sampleText);
        };

        sendSampleText();
        const intervalId = setInterval(sendSampleText, 1000);
        return () => clearInterval(intervalId);
    }, [isSampleTextEnabled]);
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
                                <div className={styles.mode_tabs} role="tablist" aria-label={t("main_page.overlay_studio.vr_mode")}>
                                    {[
                                        ["small", t("main_page.overlay_studio.small_overlay")],
                                        ["large", t("main_page.overlay_studio.large_overlay")],
                                    ].map(([mode, label]) => (
                                        <button
                                            key={mode}
                                            type="button"
                                            role="tab"
                                            aria-selected={vrMode === mode}
                                            aria-controls="vr-overlay-controls"
                                            className={styles.mode_tab}
                                            data-active={vrMode === mode}
                                            onClick={() => setVrMode(mode)}
                                        >
                                            {label}
                                        </button>
                                    ))}
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
                                    "--vr-background-opacity": activeVrSettings.background_opacity / 100,
                                    "--vr-message-text-scale": activeVrSettings.message_text_scale ?? 1,
                                    "--vr-text-outline": activeVrSettings.text_outline_enabled
                                        ? `0 0 ${activeVrSettings.text_outline_width}px #000`
                                        : "none",
                                }}
                            >
                                <div
                                    className={styles.vr_frame}
                                    data-enabled={activeVrEnabled}
                                    data-border-enabled={activeVrSettings.border_enabled}
                                >
                                    <span>{activeVrSettings.tracker ?? "HMD"}</span>
                                    <strong>{vrPreviewText || t("main_page.desktop_overlay.waiting")}</strong>
                                    <small>{t("main_page.overlay_studio.vr_scale", { scale: Math.round((activeVrSettings.ui_scaling ?? 1) * 100) })}</small>
                                </div>
                            </div>
                            <div className={styles.vr_controls} id="vr-overlay-controls" role="tabpanel">
                                <RangeControl
                                    label={t("main_page.overlay_studio.background_transparency")}
                                    value={activeVrSettings.background_opacity}
                                    min={0}
                                    max={100}
                                    suffix="%"
                                    onChange={(value) => updateActiveVrSettings("background_opacity", value)}
                                />
                                <RangeControl
                                    label={t("main_page.overlay_studio.width")}
                                    value={activeVrSettings.canvas_width}
                                    min={640}
                                    max={7680}
                                    step={20}
                                    suffix="px"
                                    onChange={(value) => updateActiveVrSettings("canvas_width", value)}
                                />
                                <RangeControl
                                    label={t("main_page.overlay_studio.height")}
                                    value={activeVrHeight}
                                    min={64}
                                    max={2048}
                                    step={8}
                                    suffix="px"
                                    disabled={isVrAutoHeight}
                                    onChange={(value) => updateActiveVrSettings("canvas_height", value)}
                                />
                                <label className={styles.toggle_row}>
                                    <span>{t("main_page.overlay_studio.border_enabled")}</span>
                                    <input
                                        type="checkbox"
                                        checked={activeVrSettings.border_enabled}
                                        onChange={(event) => updateActiveVrSettings("border_enabled", event.target.checked)}
                                    />
                                    <span aria-hidden="true" className={styles.toggle_visual} />
                                </label>
                                <label className={styles.toggle_row}>
                                    <span>{t("main_page.overlay_studio.text_outline")}</span>
                                    <input
                                        type="checkbox"
                                        checked={activeVrSettings.text_outline_enabled}
                                        onChange={(event) => updateActiveVrSettings("text_outline_enabled", event.target.checked)}
                                    />
                                    <span aria-hidden="true" className={styles.toggle_visual} />
                                </label>
                                <RangeControl
                                    label={t("main_page.overlay_studio.outline_size")}
                                    value={activeVrSettings.text_outline_width}
                                    min={0}
                                    max={12}
                                    suffix="px"
                                    disabled={!activeVrSettings.text_outline_enabled}
                                    onChange={(value) => updateActiveVrSettings("text_outline_width", value)}
                                />
                                <label className={styles.toggle_row}>
                                        <span>{t("main_page.overlay_studio.auto_height")}</span>
                                        <input
                                            type="checkbox"
                                            checked={isVrAutoHeight}
                                            onChange={(event) => updateActiveVrSettings(
                                                "canvas_height",
                                                event.target.checked ? 0 : activeVrHeight,
                                            )}
                                        />
                                        <span aria-hidden="true" className={styles.toggle_visual} />
                                </label>
                                <label className={styles.toggle_row}>
                                    <span>{t("main_page.overlay_studio.show_only_translated")}</span>
                                    <input
                                        type="checkbox"
                                        checked={currentOverlayShowOnlyTranslatedMessages.data === true}
                                        onChange={toggleOverlayShowOnlyTranslatedMessages}
                                    />
                                    <span aria-hidden="true" className={styles.toggle_visual} />
                                </label>
                                <label className={styles.toggle_row}>
                                    <span>{t("main_page.overlay_studio.show_only_received")}</span>
                                    <input
                                        type="checkbox"
                                        checked={currentOverlayShowOnlyReceivedMessages.data === true}
                                        onChange={toggleOverlayShowOnlyReceivedMessages}
                                    />
                                    <span aria-hidden="true" className={styles.toggle_visual} />
                                </label>
                                <RangeControl
                                    key={`${vrMode}-message-size`}
                                    label={t("main_page.overlay_studio.message_text_size")}
                                    value={Math.round((activeVrSettings.message_text_scale ?? 1) * 100)}
                                    min={40}
                                    max={200}
                                    step={10}
                                    suffix="%"
                                    onChange={(value) => updateActiveVrSettings("message_text_scale", value / 100)}
                                />
                                <label className={styles.field}>
                                    <span>{t("config_page.vr.tracker")}</span>
                                    <select
                                        value={activeVrSettings.tracker ?? "HMD"}
                                        onChange={(event) => updateActiveVrSettings("tracker", event.target.value)}
                                    >
                                        <option value="HMD">{t("config_page.vr.hmd")}</option>
                                        <option value="LeftHand">{t("config_page.vr.left_hand")}</option>
                                        <option value="RightHand">{t("config_page.vr.right_hand")}</option>
                                    </select>
                                </label>
                                <section className={styles.vr_transform_controls} aria-labelledby="vr-transform-heading">
                                    <div className={styles.vr_transform_header}>
                                        <div>
                                            <p className={styles.section_kicker}>{t("main_page.overlay_studio.vr_transform_kicker")}</p>
                                            <h3 id="vr-transform-heading">{t("main_page.overlay_studio.vr_transform_title")}</h3>
                                        </div>
                                        <div className={styles.transform_tabs} role="tablist" aria-label={t("config_page.vr.position")}>
                                            {[
                                                ["position", t("config_page.vr.position")],
                                                ["rotation", t("config_page.vr.rotation")],
                                            ].map(([mode, label]) => (
                                                <button
                                                    key={mode}
                                                    type="button"
                                                    role="tab"
                                                    aria-selected={vrTransformMode === mode}
                                                    aria-controls="vr-transform-controls"
                                                    className={styles.transform_tab}
                                                    data-active={vrTransformMode === mode}
                                                    onClick={() => setVrTransformMode(mode)}
                                                >
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className={styles.transform_grid} id="vr-transform-controls" role="tabpanel">
                                        {vrTransformMode === "position" ? (
                                            <>
                                                <RangeControl
                                                    label={t("config_page.vr.x_position")}
                                                    value={activeVrSettings.x_pos}
                                                    min={ui_configs.overlay_small_log.x_pos.min}
                                                    max={ui_configs.overlay_small_log.x_pos.max}
                                                    step={ui_configs.overlay_small_log.x_pos.step}
                                                    suffix="m"
                                                    onChange={(value) => updateActiveVrSettings("x_pos", value)}
                                                />
                                                <RangeControl
                                                    label={t("config_page.vr.y_position")}
                                                    value={activeVrSettings.y_pos}
                                                    min={ui_configs.overlay_small_log.y_pos.min}
                                                    max={ui_configs.overlay_small_log.y_pos.max}
                                                    step={ui_configs.overlay_small_log.y_pos.step}
                                                    suffix="m"
                                                    onChange={(value) => updateActiveVrSettings("y_pos", value)}
                                                />
                                                <RangeControl
                                                    label={t("config_page.vr.z_position")}
                                                    value={activeVrSettings.z_pos}
                                                    min={ui_configs.overlay_small_log.z_pos.min}
                                                    max={ui_configs.overlay_small_log.z_pos.max}
                                                    step={ui_configs.overlay_small_log.z_pos.step}
                                                    suffix="m"
                                                    onChange={(value) => updateActiveVrSettings("z_pos", value)}
                                                />
                                            </>
                                        ) : (
                                            <>
                                                <RangeControl
                                                    label={t("config_page.vr.x_rotation")}
                                                    value={activeVrSettings.x_rotation}
                                                    min={ui_configs.overlay_small_log.x_rotation.min}
                                                    max={ui_configs.overlay_small_log.x_rotation.max}
                                                    step={ui_configs.overlay_small_log.x_rotation.step}
                                                    suffix="°"
                                                    onChange={(value) => updateActiveVrSettings("x_rotation", value)}
                                                />
                                                <RangeControl
                                                    label={t("config_page.vr.y_rotation")}
                                                    value={activeVrSettings.y_rotation}
                                                    min={ui_configs.overlay_small_log.y_rotation.min}
                                                    max={ui_configs.overlay_small_log.y_rotation.max}
                                                    step={ui_configs.overlay_small_log.y_rotation.step}
                                                    suffix="°"
                                                    onChange={(value) => updateActiveVrSettings("y_rotation", value)}
                                                />
                                                <RangeControl
                                                    label={t("config_page.vr.z_rotation")}
                                                    value={activeVrSettings.z_rotation}
                                                    min={ui_configs.overlay_small_log.z_rotation.min}
                                                    max={ui_configs.overlay_small_log.z_rotation.max}
                                                    step={ui_configs.overlay_small_log.z_rotation.step}
                                                    suffix="°"
                                                    onChange={(value) => updateActiveVrSettings("z_rotation", value)}
                                                />
                                            </>
                                        )}
                                    </div>
                                </section>
                                <section
                                    className={styles.sample_text_panel}
                                    data-active={isSampleTextEnabled}
                                    aria-labelledby="sample-text-heading"
                                >
                                    <div className={styles.sample_text_header}>
                                        <div>
                                            <p className={styles.section_kicker}>{t("main_page.overlay_studio.sample_text_kicker")}</p>
                                            <h3 id="sample-text-heading">{t("main_page.overlay_studio.sample_text_title")}</h3>
                                        </div>
                                        <button
                                            type="button"
                                            className={styles.sample_text_button}
                                            aria-pressed={isSampleTextEnabled}
                                            onClick={() => setIsSampleTextEnabled((current) => !current)}
                                        >
                                            {isSampleTextEnabled
                                                ? t("config_page.vr.sample_text_button.stop")
                                                : t("config_page.vr.sample_text_button.start")}
                                        </button>
                                    </div>
                                    <p className={styles.sample_text_description}>
                                        {t("main_page.overlay_studio.sample_text_description")}
                                    </p>
                                    {isSampleTextEnabled && (
                                        <p className={styles.sample_text_warning} role="alert">
                                            {t("main_page.overlay_studio.sample_text_active_warning")}
                                        </p>
                                    )}
                                </section>
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
    const [draftValue, setDraftValue] = useState(value);
    const draftValueRef = useRef(value);
    const pendingValueRef = useRef(null);
    const isDraggingRef = useRef(false);

    useEffect(() => {
        const nextValue = Number(value);
        if (pendingValueRef.current !== null) {
            if (nextValue === pendingValueRef.current) {
                pendingValueRef.current = null;
            } else {
                return;
            }
        }
        if (!isDraggingRef.current) {
            draftValueRef.current = nextValue;
            setDraftValue(nextValue);
        }
    }, [value]);

    const handleRangeChange = (event) => {
        const nextValue = Number(event.target.value);
        draftValueRef.current = nextValue;
        setDraftValue(nextValue);
    };

    const commitDraftValue = () => {
        isDraggingRef.current = false;
        const nextValue = Number(draftValueRef.current);
        if (pendingValueRef.current === nextValue) return;
        if (pendingValueRef.current === null && nextValue === Number(value)) return;
        pendingValueRef.current = nextValue;
        onChange(nextValue);
    };

    const startRangeDrag = (event) => {
        isDraggingRef.current = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
    };

    const finishRangeDrag = (event) => {
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
            event.currentTarget.releasePointerCapture?.(event.pointerId);
        }
        commitDraftValue();
    };

    const numericValue = Number(draftValue);
    const rangeProgress = max > min
        ? Math.min(100, Math.max(0, ((numericValue - min) / (max - min)) * 100))
        : 0;

    return (
        <label className={styles.range_control}>
            <span>{label}</span>
            <strong>{draftValue}{suffix}</strong>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={draftValue}
                disabled={disabled}
                style={{ "--range-progress": `${rangeProgress}%` }}
                onChange={handleRangeChange}
                onPointerDown={startRangeDrag}
                onPointerUp={finishRangeDrag}
                onPointerCancel={finishRangeDrag}
                onKeyUp={commitDraftValue}
                onBlur={commitDraftValue}
            />
        </label>
    );
};
