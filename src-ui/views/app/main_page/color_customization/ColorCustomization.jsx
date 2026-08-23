import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@useI18n";
import {
    UI_SCALE_MARKS,
    UI_SCALE_MAX,
    UI_SCALE_MIN,
    UI_SCALE_STEP,
    useAppearance,
    useSliderLogic,
} from "@logics_configs";
import { ColorRoleEditor } from "@common_components";
import {
    APP_COLOR_PALETTE_DEFAULTS,
    APP_COLOR_ROLE_GROUPS,
    getContrastRatio,
    normalizeColorPalette,
    processWallpaperFile,
    useCustomBackground,
    useWindow,
} from "@logics_common";
import { TopBar } from "../main_section/top_bar/TopBar";
import { ColorThemePreview } from "./ColorThemePreview";
import styles from "./ColorCustomization.module.scss";

const ScaleControl = ({ id, label, description, value, onChange }) => {
    const numericValue = Number(value ?? 100);
    const { ui_value, onChangeFunction } = useSliderLogic({
        variable: numericValue,
        setterFunction: onChange,
        min: UI_SCALE_MIN,
        max: UI_SCALE_MAX,
        step: UI_SCALE_STEP,
        setter_timing: "on_change",
    });
    const rangeProgress = UI_SCALE_MAX > UI_SCALE_MIN
        ? Math.min(100, Math.max(0, ((Number(ui_value) - UI_SCALE_MIN) / (UI_SCALE_MAX - UI_SCALE_MIN)) * 100))
        : 0;

    return (
        <div className={styles.scale_control}>
            <div className={styles.scale_control_header}>
                <label className={styles.scale_label} htmlFor={id}>{label}</label>
                <output className={styles.scale_value} htmlFor={id}>{ui_value}%</output>
            </div>
            <p className={styles.scale_description}>{description}</p>
            <input
                id={id}
                type="range"
                min={UI_SCALE_MIN}
                max={UI_SCALE_MAX}
                step={UI_SCALE_STEP}
                value={ui_value}
                aria-label={label}
                style={{ "--range-progress": `${rangeProgress}%` }}
                onChange={(event) => onChangeFunction(Number(event.target.value))}
            />
            <div className={styles.scale_marks} aria-hidden="true">
                {UI_SCALE_MARKS.map((mark) => <span key={mark}>{mark}%</span>)}
            </div>
        </div>
    );
};

const BackgroundSlider = ({ id, label, description, value, min, max, step, unit = "", onChange }) => {
    const numericValue = Number(value ?? min);
    const rangeProgress = max > min
        ? Math.min(100, Math.max(0, ((numericValue - min) / (max - min)) * 100))
        : 0;

    return (
        <div className={styles.scale_control}>
            <div className={styles.scale_control_header}>
                <label className={styles.scale_label} htmlFor={id}>{label}</label>
                <output className={styles.scale_value} htmlFor={id}>{numericValue}{unit}</output>
            </div>
            <p className={styles.scale_description}>{description}</p>
            <input
                id={id}
                type="range"
                min={min}
                max={max}
                step={step}
                value={numericValue}
                aria-label={label}
                style={{ "--range-progress": `${rangeProgress}%` }}
                onChange={(event) => onChange(Number(event.target.value))}
            />
        </div>
    );
};

const roleLabelKeys = {
    primary: "primary",
    secondary: "secondary",
    gradientStart: "gradient_start",
    gradientEnd: "gradient_end",
    canvas: "canvas",
    backgroundStart: "background_start",
    backgroundEnd: "background_end",
    surface1: "surface_1",
    surface2: "surface_2",
    surface3: "surface_3",
    surfaceOverlay: "surface_overlay",
    surfaceControl: "surface_control",
    textStrong: "text_strong",
    text: "text",
    textMuted: "text_muted",
    textSubtle: "text_subtle",
    border: "border",
    focus: "focus",
    success: "success",
    warning: "warning",
    error: "error",
    info: "info",
    sent: "sent",
    received: "received",
    translation: "translation",
};

const groupLabelKeys = {
    brand: "brand",
    surfaces: "surfaces",
    content: "content",
    status: "status",
};

export const ColorCustomization = () => {
    const { t } = useI18n();
    const {
        currentAppColorPalette,
        updateAppColorPalette,
        setAppColorPalette,
        currentUiScaling,
        setUiScaling,
        currentMessageLogUiScaling,
        setMessageLogUiScaling,
    } = useAppearance();
    const {
        bgImage,
        isCustom,
        blur,
        dim,
        setCustomImage,
        setBlur,
        setDim,
        resetToDefault: resetBackgroundToDefault,
    } = useCustomBackground();
    const { asyncUpdateBreakPoint } = useWindow();
    const [feedback, setFeedback] = useState("");
    const persistTimer = useRef(null);
    const fileInputRef = useRef(null);
    const palette = useMemo(
        () => normalizeColorPalette(currentAppColorPalette.data, APP_COLOR_PALETTE_DEFAULTS),
        [currentAppColorPalette.data],
    );

    useEffect(() => () => {
        if (persistTimer.current) clearTimeout(persistTimer.current);
    }, []);

    const groups = useMemo(() => APP_COLOR_ROLE_GROUPS.map((group) => ({
        id: group.id,
        label: t(`config_page.appearance.colors.groups.${groupLabelKeys[group.id]}`),
        description: t(`config_page.appearance.colors.group_descriptions.${groupLabelKeys[group.id]}`),
        roles: group.roles.map((roleId) => ({
            id: roleId,
            label: t(`config_page.appearance.colors.roles.${roleLabelKeys[roleId]}`),
            description: t(`config_page.appearance.colors.role_descriptions.${roleLabelKeys[roleId]}`),
        })),
    })), [t]);

    const persistPalette = (nextPalette) => {
        updateAppColorPalette(nextPalette);
        setFeedback(t("config_page.appearance.colors.saving"));
        if (persistTimer.current) clearTimeout(persistTimer.current);
        persistTimer.current = setTimeout(() => {
            setAppColorPalette(nextPalette);
            setFeedback(t("config_page.appearance.colors.saved"));
            persistTimer.current = null;
        }, 180);
    };

    const updateRole = (roleId, value) => {
        persistPalette(normalizeColorPalette({ ...palette, [roleId]: value }, APP_COLOR_PALETTE_DEFAULTS));
    };

    const resetRole = (roleId) => updateRole(roleId, APP_COLOR_PALETTE_DEFAULTS[roleId]);
    const resetAll = () => persistPalette({ ...APP_COLOR_PALETTE_DEFAULTS });
    const getContrastWarning = (roleId, value) => {
        if (!roleId.startsWith("text")) return null;
        const ratio = getContrastRatio(value, palette.canvas);
        return ratio < 4.5 ? t("config_page.appearance.colors.contrast_warning") : null;
    };

    const updateUiScale = (value) => {
        setUiScaling(value);
        void asyncUpdateBreakPoint(value);
    };

    const handleFileSelect = async (event) => {
        const file = event.target.files?.[0];
        if (file) {
            try {
                const optimizedDataUrl = await processWallpaperFile(file);
                setCustomImage(optimizedDataUrl);
                setFeedback(t("config_page.appearance.colors.wallpaper_updated"));
            } catch {
                // Fallback / ignore read error
            }
        }
        event.target.value = "";
    };

    return (
        <div className={styles.page}>
            <TopBar />
            <div className={styles.content} data-onboarding-target="tour-workspace">
                <header className={styles.hero}>
                    <div>
                        <p className={styles.eyebrow}>{t("config_page.appearance.colors.eyebrow")}</p>
                        <h1>{t("config_page.appearance.colors.title")}</h1>
                        <p>{t("config_page.appearance.colors.description")}</p>
                    </div>
                    <div className={styles.feedback} aria-live="polite">{feedback}</div>
                </header>
                <div className={styles.workspace_grid} data-onboarding-target="customize-workspace">
                    <section className={styles.preview_card} aria-labelledby="color-preview-title">
                        <div className={styles.card_header}>
                            <div>
                                <p className={styles.section_kicker}>{t("config_page.appearance.colors.preview_kicker")}</p>
                                <h2 id="color-preview-title">{t("config_page.appearance.colors.preview_title")}</h2>
                            </div>
                        </div>
                        <ColorThemePreview
                            palette={palette}
                            labels={{
                                live: t("main_page.live_weave.navigation.live"),
                                overlay: t("main_page.live_weave.navigation.overlay"),
                                settings: t("main_page.live_weave.navigation.settings"),
                                controls: t("main_page.live_workspace.control_rail_eyebrow"),
                                session: t("main_page.live_workspace.session_controls"),
                                translation: t("main_page.translation"),
                                ready: t("main_page.live_workspace.session_ready"),
                                speaking: t("main_page.transcription_send"),
                                listening: t("main_page.transcription_receive"),
                                conversation: t("main_page.live_weave.conversation_title"),
                                title: t("config_page.appearance.colors.preview_title"),
                                sessionLive: t("main_page.live_weave.session_live"),
                                detail: t("config_page.appearance.colors.description"),
                                received: t("config_page.appearance.colors.roles.received"),
                                sent: t("config_page.appearance.colors.roles.sent"),
                                composer: t("main_page.live_workspace.composer_placeholder"),
                            }}
                        />
                        <section className={styles.scale_controls} aria-labelledby="readability-controls-title">
                            <div className={styles.scale_header}>
                                <p className={styles.section_kicker}>{t("config_page.appearance.colors.scale_kicker")}</p>
                                <h3 id="readability-controls-title">{t("config_page.appearance.colors.scale_title")}</h3>
                                <p>{t("config_page.appearance.colors.scale_description")}</p>
                            </div>
                            <div className={styles.scale_list}>
                                <ScaleControl
                                    id="customize-ui-size"
                                    label={t("config_page.appearance.ui_size.label")}
                                    description={t("config_page.appearance.colors.ui_size_description")}
                                    value={currentUiScaling.data}
                                    onChange={updateUiScale}
                                />
                                <ScaleControl
                                    id="customize-message-log-size"
                                    label={t("config_page.appearance.textbox_ui_size.label")}
                                    description={t("config_page.appearance.colors.message_log_size_description")}
                                    value={currentMessageLogUiScaling.data}
                                    onChange={setMessageLogUiScaling}
                                />
                            </div>
                        </section>

                        <section className={styles.background_section} aria-labelledby="wallpaper-controls-title">
                            <div className={styles.scale_header}>
                                <p className={styles.section_kicker}>{t("config_page.appearance.colors.wallpaper_kicker")}</p>
                                <h3 id="wallpaper-controls-title">{t("config_page.appearance.colors.wallpaper_title")}</h3>
                                <p>{t("config_page.appearance.colors.wallpaper_description")}</p>
                            </div>

                            <div className={styles.wallpaper_card}>
                                <div
                                    className={styles.wallpaper_thumbnail}
                                    style={{
                                        backgroundImage: `url("${bgImage}")`,
                                        filter: `blur(${Math.min(8, blur / 3)}px)`,
                                    }}
                                />
                                <div className={styles.wallpaper_actions}>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        style={{ display: "none" }}
                                        onChange={handleFileSelect}
                                    />
                                    <button
                                        type="button"
                                        className={styles.wallpaper_choose_btn}
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        🖼 {t("config_page.appearance.colors.choose_wallpaper")}
                                    </button>
                                    <button
                                        type="button"
                                        className={styles.wallpaper_reset_btn}
                                        onClick={() => {
                                            resetBackgroundToDefault();
                                            setFeedback(t("config_page.appearance.colors.wallpaper_reset"));
                                        }}
                                    >
                                        ↺ {t("config_page.appearance.colors.reset_wallpaper")}
                                    </button>
                                </div>
                            </div>

                            <div className={styles.scale_list}>
                                <BackgroundSlider
                                    id="customize-bg-blur"
                                    label={t("config_page.appearance.colors.blur_label")}
                                    description={t("config_page.appearance.colors.blur_description")}
                                    value={blur}
                                    min={0}
                                    max={50}
                                    step={1}
                                    unit="px"
                                    onChange={setBlur}
                                />
                                <BackgroundSlider
                                    id="customize-bg-dim"
                                    label={t("config_page.appearance.colors.dim_label")}
                                    description={t("config_page.appearance.colors.dim_description")}
                                    value={dim}
                                    min={0}
                                    max={90}
                                    step={1}
                                    unit="%"
                                    onChange={setDim}
                                />
                            </div>
                        </section>
                    </section>
                    <section className={styles.editor_card} aria-labelledby="color-editor-title">
                        <ColorRoleEditor
                            groups={groups}
                            palette={palette}
                            onChangeRole={updateRole}
                            onResetRole={resetRole}
                            onResetAll={resetAll}
                            resetLabel={t("config_page.appearance.colors.reset_all")}
                            getContrastWarning={getContrastWarning}
                            labels={{
                                kicker: t("config_page.appearance.colors.editor_kicker"),
                                title: t("config_page.appearance.colors.editor_title"),
                                description: t("config_page.appearance.colors.editor_description"),
                                reset: t("config_page.appearance.colors.reset_role"),
                                hue: t("config_page.appearance.colors.picker_hue"),
                                saturation: t("config_page.appearance.colors.picker_saturation"),
                                brightness: t("config_page.appearance.colors.picker_brightness"),
                                hex: t("config_page.appearance.colors.picker_hex"),
                                invalid: t("config_page.appearance.colors.picker_invalid"),
                            }}
                        />
                    </section>
                </div>
            </div>
        </div>
    );
};
