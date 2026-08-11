import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@useI18n";
import { useAppearance } from "@logics_configs";
import { ColorRoleEditor } from "@common_components";
import {
    APP_COLOR_PALETTE_DEFAULTS,
    APP_COLOR_ROLE_GROUPS,
    getContrastRatio,
    normalizeColorPalette,
} from "@logics_common";
import { TopBar } from "../main_section/top_bar/TopBar";
import { ColorThemePreview } from "./ColorThemePreview";
import styles from "./ColorCustomization.module.scss";

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
    } = useAppearance();
    const [feedback, setFeedback] = useState("");
    const persistTimer = useRef(null);
    const palette = useMemo(
        () => normalizeColorPalette(currentAppColorPalette.data, APP_COLOR_PALETTE_DEFAULTS),
        [currentAppColorPalette.data],
    );

    useEffect(() => () => {
        if (persistTimer.current) clearTimeout(persistTimer.current);
    }, []);

    const groups = useMemo(() => APP_COLOR_ROLE_GROUPS.map((group) => ({
        id: group.id,
        label: t(`appearance.colors.groups.${groupLabelKeys[group.id]}`),
        description: t(`appearance.colors.group_descriptions.${groupLabelKeys[group.id]}`),
        roles: group.roles.map((roleId) => ({
            id: roleId,
            label: t(`appearance.colors.roles.${roleLabelKeys[roleId]}`),
            description: t(`appearance.colors.role_descriptions.${roleLabelKeys[roleId]}`),
        })),
    })), [t]);

    const persistPalette = (nextPalette) => {
        updateAppColorPalette(nextPalette);
        setFeedback(t("appearance.colors.saving"));
        if (persistTimer.current) clearTimeout(persistTimer.current);
        persistTimer.current = setTimeout(() => {
            setAppColorPalette(nextPalette);
            setFeedback(t("appearance.colors.saved"));
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
        return ratio < 4.5 ? t("appearance.colors.contrast_warning") : null;
    };

    return (
        <div className={styles.page}>
            <TopBar />
            <div className={styles.content}>
                <header className={styles.hero}>
                    <div>
                        <p className={styles.eyebrow}>{t("appearance.colors.eyebrow")}</p>
                        <h1>{t("appearance.colors.title")}</h1>
                        <p>{t("appearance.colors.description")}</p>
                    </div>
                    <div className={styles.feedback} aria-live="polite">{feedback}</div>
                </header>
                <div className={styles.workspace_grid}>
                    <section className={styles.preview_card} aria-labelledby="color-preview-title">
                        <div className={styles.card_header}>
                            <div>
                                <p className={styles.section_kicker}>{t("appearance.colors.preview_kicker")}</p>
                                <h2 id="color-preview-title">{t("appearance.colors.preview_title")}</h2>
                            </div>
                        </div>
                        <ColorThemePreview palette={palette} />
                    </section>
                    <section className={styles.editor_card} aria-labelledby="color-editor-title">
                        <ColorRoleEditor
                            groups={groups}
                            palette={palette}
                            onChangeRole={updateRole}
                            onResetRole={resetRole}
                            onResetAll={resetAll}
                            resetLabel={t("appearance.colors.reset_all")}
                            getContrastWarning={getContrastWarning}
                            labels={{
                                kicker: t("appearance.colors.editor_kicker"),
                                title: t("appearance.colors.editor_title"),
                                description: t("appearance.colors.editor_description"),
                                reset: t("appearance.colors.reset_role"),
                                hue: t("appearance.colors.picker_hue"),
                                saturation: t("appearance.colors.picker_saturation"),
                                brightness: t("appearance.colors.picker_brightness"),
                                hex: t("appearance.colors.picker_hex"),
                                invalid: t("appearance.colors.picker_invalid"),
                            }}
                        />
                    </section>
                </div>
            </div>
        </div>
    );
};
