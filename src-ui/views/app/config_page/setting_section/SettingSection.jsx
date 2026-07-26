import { useRef, useLayoutEffect, useEffect } from "react";
import clsx from "clsx";

import styles from "./SettingSection.module.scss";
import { SettingBox } from "./setting_box/SettingBox";
import { SettingsSearchResults } from "./SettingsSearchResults.jsx";
import { store, useStore_SelectedConfigTabId } from "@store";
import { useSettingBoxScrollPosition } from "@logics_configs";

export const SettingSection = ({ searchQuery = "", onClearSearch }) => {
    const { currentSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const { resetScrollPosition } = useSettingBoxScrollPosition();
    const scrollContainerRef = useRef(null);

    useLayoutEffect(() => {
        store.setting_box_scroll_container = scrollContainerRef;
    }, []);

    useEffect(() => {
        resetScrollPosition();
    }, [currentSelectedConfigTabId.data, searchQuery]);

    const isSearching = searchQuery.trim().length >= 2;

    return (
        <div ref={scrollContainerRef} className={styles.scroll_container}>
            <div className={clsx(styles.container, {
                [styles.is_model_workspace]: currentSelectedConfigTabId.data === "model_and_provider",
            })}>
                <div
                    key={isSearching ? "search-results" : currentSelectedConfigTabId.data}
                    className={styles.content_surface}
                >
                    {isSearching
                        ? <SettingsSearchResults query={searchQuery} onSelectResult={onClearSearch} />
                        : <SettingBox />}
                </div>
            </div>
        </div>
    );
};
