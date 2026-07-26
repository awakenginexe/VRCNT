import styles from "./SidebarSection.module.scss";
import { useStore_IsOpenedLanguageSelector } from "@store";

import { Logo } from "./logo/Logo";
import { OpenSettings } from "./open_settings/OpenSettings";
import { DesktopOverlayButton } from "./desktop_overlay_button/DesktopOverlayButton";

export const SidebarSection = () => {
    const sidebar_width = "7.2rem";
    const container_style = {
        width: sidebar_width,
        minWidth: sidebar_width,
        maxWidth: sidebar_width,
        flex: `0 0 ${sidebar_width}`,
    };

    const { currentIsOpenedLanguageSelector } = useStore_IsOpenedLanguageSelector();
    const is_language_selector_open = (
        currentIsOpenedLanguageSelector.data.your_language === true ||
        currentIsOpenedLanguageSelector.data.your_translation_language === true ||
        currentIsOpenedLanguageSelector.data.target_language === true
    );
    const scroll_container_class_names = is_language_selector_open
        ? `${styles.scroll_container} ${styles.is_opened}`
        : styles.scroll_container;

    return (
        <div className={styles.container} style={container_style}>
            <Logo />
            <div className={scroll_container_class_names}>
                <div className={styles.utility_actions}>
                    <DesktopOverlayButton forceCompact />
                </div>
            </div>
            <OpenSettings />
        </div>
    );
};
