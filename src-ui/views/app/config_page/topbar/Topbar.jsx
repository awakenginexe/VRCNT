import { useEffect, useRef } from "react";
import { useI18n } from "@useI18n";
import clsx from "clsx";

import styles from "./Topbar.module.scss";
import ArrowLeftSvg from "@images/arrow_left.svg?react";

import { TitleBox } from "./title_box/TitleBox";
import { VersionLabel } from "../version_label/VersionLabel.jsx";

export const Topbar = ({ searchQuery, setSearchQuery, onClose }) => {
    const { t } = useI18n();
    const searchInputRef = useRef(null);

    useEffect(() => {
        const focusSearch = (event) => {
            if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== "k") return;
            event.preventDefault();
            searchInputRef.current?.focus();
        };
        window.addEventListener("keydown", focusSearch);
        return () => window.removeEventListener("keydown", focusSearch);
    }, []);

    return (
        <header className={clsx(styles.container, styles.show_config)}>
            <div className={styles.wrapper}>
                <button
                    type="button"
                    className={styles.go_back_button}
                    onClick={onClose}
                    aria-label={t("common.go_back_button_label")}
                >
                    <ArrowLeftSvg className={styles.arrow_left_svg} />
                </button>
                <TitleBox />
                <label className={styles.search}>
                    <span className={styles.search_icon} aria-hidden="true">⌕</span>
                    <input
                        ref={searchInputRef}
                        type="search"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder={t("config_page.focus_settings.search_placeholder")}
                        aria-label={t("config_page.focus_settings.search_label")}
                    />
                    {searchQuery && (
                        <button
                            type="button"
                            className={styles.clear_search}
                            onClick={() => setSearchQuery("")}
                            aria-label={t("config_page.focus_settings.clear_search")}
                        >
                            ×
                        </button>
                    )}
                    <kbd>Ctrl K</kbd>
                </label>
                <VersionLabel />
            </div>
        </header>
    );
};
