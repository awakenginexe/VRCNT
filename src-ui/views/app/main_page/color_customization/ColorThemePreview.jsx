import { getAppCssVariables } from "@logics_common";
import styles from "./ColorThemePreview.module.scss";

export const ColorThemePreview = ({ palette = {}, labels = {} }) => {
    const copy = {
        live: "Live",
        overlay: "Overlay Studio",
        settings: "Settings",
        controls: "Live controls",
        session: "Session controls",
        translation: "Translation",
        ready: "Ready",
        speaking: "Speaking",
        listening: "Listening",
        conversation: "Live conversation",
        title: "Personal color preview",
        sessionLive: "Session live",
        detail: "Your palette appears across navigation, controls, messages, and status feedback.",
        received: "Received translation",
        sent: "Sent message",
        composer: "Type a message to translate…",
        send: "Send",
        ...labels,
    };

    return (
    <div className={styles.preview} data-primary-color={palette.primary} style={getAppCssVariables(palette)}>
        <div className={styles.preview_topbar}>
            <span className={styles.preview_mark}>VRCNT</span>
            <span className={styles.preview_nav_active}>{copy.live}</span>
            <span>{copy.overlay}</span>
            <span>{copy.settings}</span>
        </div>
        <div className={styles.preview_body}>
            <aside className={styles.preview_rail}>
                <span className={styles.preview_kicker}>{copy.controls}</span>
                <strong>{copy.session}</strong>
                <div className={styles.preview_status}><span /> {copy.translation} <b>{copy.ready}</b></div>
                <div className={styles.preview_status}><span /> {copy.speaking} <b>{copy.ready}</b></div>
                <div className={styles.preview_status}><span /> {copy.listening} <b>{copy.ready}</b></div>
            </aside>
            <main className={styles.preview_main}>
                <div className={styles.preview_heading}>
                    <div><span className={styles.preview_kicker}>{copy.conversation}</span><h3>{copy.title}</h3></div>
                    <span className={styles.preview_live}>{copy.sessionLive}</span>
                </div>
                <div className={styles.preview_empty}>{copy.detail}</div>
                <div className={styles.preview_messages}>
                    <div className={styles.preview_received}>{copy.received}</div>
                    <div className={styles.preview_sent}>{copy.sent}</div>
                </div>
                <div className={styles.preview_composer}><span>{copy.composer}</span><button type="button">{copy.send}</button></div>
            </main>
        </div>
    </div>
    );
};
