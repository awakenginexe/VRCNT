import clsx from "clsx";
import { useI18n } from "@useI18n";
import {
    DESKTOP_OVERLAY_MAX_MESSAGE_LOGS,
    getOverlayCssVariables,
    normalizeDesktopOverlaySettings,
} from "@logics_common";
import styles from "./DesktopOverlayPreview.module.scss";

export const createDesktopOverlayStyle = (settings, overlayColorPalette) => {
    const normalized = normalizeDesktopOverlaySettings(settings);
    const overlayVariables = getOverlayCssVariables(
        overlayColorPalette ?? normalized.overlayColorPalette,
    );

    return {
        ...overlayVariables,
        "--desktop-overlay-opacity": `${normalized.opacity / 100}`,
        "--desktop-overlay-scale": `${normalized.scale / 100}`,
        "--desktop-overlay-message-text-scale": `${normalized.messageTextScale / 100}`,
        "--desktop-overlay-accent-color": overlayVariables["--overlay_primary_color"],
        "--desktop-overlay-accent-rgb": overlayVariables["--overlay_primary_color_rgb"],
        "--accent_color": overlayVariables["--overlay_primary_color"],
        "--accent_color_rgb": overlayVariables["--overlay_primary_color_rgb"],
    };
};

const visibleMessageLogs = (payload, settings) => {
    const logs = payload?.messageLogs ?? [];
    return settings.expanded
        ? logs.slice(-DESKTOP_OVERLAY_MAX_MESSAGE_LOGS)
        : logs.slice(-1);
};

export const DesktopOverlayStatusStrip = ({ statuses = {} }) => {
    const { t } = useI18n();
    const statusItems = [
        ["translationEnabled", t("main_page.translation")],
        ["speakingEnabled", t("main_page.transcription_send")],
        ["listeningEnabled", t("main_page.transcription_receive")],
    ];

    return (
        <div className={styles.status_strip}>
            {statusItems.map(([key, label]) => (
                <div
                    key={key}
                    className={clsx(styles.status_pill, {
                        [styles.is_active]: statuses[key] === true,
                    })}
                >
                    <span className={styles.status_dot} />
                    <span>{label}</span>
                </div>
            ))}
        </div>
    );
};

const OverlayMessage = ({ log, translationsOnly }) => {
    const { t } = useI18n();
    const originalMessage = log?.messages?.original?.message ?? "";
    const translations = (log?.messages?.translations ?? [])
        .map((translation) => translation.message)
        .filter(Boolean);
    const shouldShowOriginal = translationsOnly !== true && originalMessage;

    return (
        <article className={clsx(styles.message_card, styles[log.category] ?? styles.system)}>
            <div className={styles.message_meta}>
                <span>{t(`main_page.message_log.${log.category}`, { defaultValue: log.category })}</span>
                {log.created_at && <span>{log.created_at}</span>}
            </div>
            {shouldShowOriginal && <p className={styles.original_message}>{originalMessage}</p>}
            {translations.length > 0 ? (
                translations.map((message, index) => (
                    <p key={`${log.id}-translation-${index}`} className={styles.translated_message}>{message}</p>
                ))
            ) : (
                <p className={styles.no_translation}>{t("main_page.desktop_overlay.no_translation")}</p>
            )}
        </article>
    );
};

export const DesktopOverlayMessageStack = ({ payload, settings, className }) => {
    const { t } = useI18n();
    const logs = visibleMessageLogs(payload, settings);

    return (
        <div className={clsx(styles.log_stack, className)}>
            {logs.length > 0 ? logs.map((log) => (
                <OverlayMessage
                    key={log.id ?? `${log.category}-${log.created_at}`}
                    log={log}
                    translationsOnly={settings.translationsOnly}
                />
            )) : (
                <div className={styles.empty_state}>{t("main_page.desktop_overlay.waiting")}</div>
            )}
        </div>
    );
};

export const DesktopOverlayPreview = ({ payload, settings, overlayColorPalette, className }) => {
    const { t } = useI18n();
    const normalizedSettings = normalizeDesktopOverlaySettings(settings);
    const { width, height } = normalizedSettings.geometry;

    return (
        <section
            className={clsx(styles.preview, className)}
            style={{
                ...createDesktopOverlayStyle(normalizedSettings, overlayColorPalette ?? payload?.overlayColorPalette),
                "--desktop-overlay-preview-width": `${width}px`,
                "--desktop-overlay-preview-height": `${height}px`,
            }}
            aria-label={t("main_page.overlay_studio.desktop_preview")}
        >
            <header className={styles.preview_header}>
                <span>VRCNT DESKTOP OVERLAY</span>
                <span>{width} × {height}px</span>
            </header>
            <DesktopOverlayStatusStrip statuses={payload?.statuses} />
            <DesktopOverlayMessageStack payload={payload} settings={normalizedSettings} />
        </section>
    );
};
