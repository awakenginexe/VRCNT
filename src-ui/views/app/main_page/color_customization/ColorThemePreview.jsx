import { getAppCssVariables } from "@logics_common";
import styles from "./ColorThemePreview.module.scss";

export const ColorThemePreview = ({ palette = {} }) => (
    <div className={styles.preview} data-primary-color={palette.primary} style={getAppCssVariables(palette)}>
        <div className={styles.preview_topbar}>
            <span className={styles.preview_mark}>VRCNT</span>
            <span className={styles.preview_nav_active}>Live</span>
            <span>Overlay Studio</span>
            <span>Settings</span>
        </div>
        <div className={styles.preview_body}>
            <aside className={styles.preview_rail}>
                <span className={styles.preview_kicker}>Live controls</span>
                <strong>Session controls</strong>
                <div className={styles.preview_status}><span /> Translation <b>Ready</b></div>
                <div className={styles.preview_status}><span /> Speaking <b>Enabled</b></div>
                <div className={styles.preview_status}><span /> Listening <b>Ready</b></div>
            </aside>
            <main className={styles.preview_main}>
                <div className={styles.preview_heading}>
                    <div><span className={styles.preview_kicker}>Live conversation</span><h3>Personal color preview</h3></div>
                    <span className={styles.preview_live}>Session live</span>
                </div>
                <div className={styles.preview_empty}>Your palette appears across navigation, controls, messages, and status feedback.</div>
                <div className={styles.preview_messages}>
                    <div className={styles.preview_received}>Received translation</div>
                    <div className={styles.preview_sent}>Sent message</div>
                </div>
                <div className={styles.preview_composer}><span>Type a message to translate...</span><button type="button">Send</button></div>
            </main>
        </div>
    </div>
);
