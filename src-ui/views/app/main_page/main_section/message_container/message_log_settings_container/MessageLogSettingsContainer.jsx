import { useState, useRef, useEffect } from "react";
import styles from "./MessageLogSettingsContainer.module.scss";
import clsx from "clsx";
import { useI18n } from "@useI18n";

import { MessageLogUiScalingContainer } from "@setting_box";
import ConfigSvg from "@images/configuration.svg?react";

export const MessageLogSettingsContainer = ({ to_visible_toggle_bar = false }) => {
    const { t } = useI18n();
    const [is_opened, setIsOpened] = useState(false);
    const containerRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (is_opened && containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpened(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [is_opened]);

    const isVisible = to_visible_toggle_bar || is_opened;

    return (
        <div
            ref={containerRef}
            className={clsx(styles.quick_settings_root, {
                [styles.is_visible]: isVisible,
                [styles.is_opened]: is_opened,
            })}
        >
            <button
                type="button"
                className={styles.gear_button}
                onClick={() => setIsOpened((prev) => !prev)}
                aria-label={t("config_page.appearance.textbox_ui_size.label") || "Quick text size settings"}
                aria-expanded={is_opened}
            >
                <ConfigSvg className={styles.gear_svg} />
            </button>

            {is_opened && (
                <div className={styles.settings_card}>
                    <div className={styles.card_header}>
                        <span className={styles.card_title}>
                            {t("config_page.appearance.textbox_ui_size.label") || "Text Size"}
                        </span>
                        <button
                            type="button"
                            className={styles.card_close_btn}
                            onClick={() => setIsOpened(false)}
                            aria-label="Close"
                        >
                            ✕
                        </button>
                    </div>
                    <div className={styles.card_content}>
                        <MessageLogUiScalingContainer />
                    </div>
                </div>
            )}
        </div>
    );
};