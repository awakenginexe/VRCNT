import { useCallback, useEffect, useState } from "react";
import styles from "./ConfigPage.module.scss";

import { Topbar } from "./topbar/Topbar.jsx";
import { SidebarSection } from "./sidebar_section/SidebarSection.jsx";
import { SettingSection } from "./setting_section/SettingSection.jsx";
import { SectionContext } from "./section_context/SectionContext.jsx";
import { useIsOpenedConfigPage } from "@logics_common";
import { useStore_ExperienceRoute } from "@store";

export const ConfigPage = () => {
    const { currentIsOpenedConfigPage, setIsOpenedConfigPage } = useIsOpenedConfigPage();
    const { updateExperienceRoute } = useStore_ExperienceRoute();
    const [searchQuery, setSearchQuery] = useState("");

    const closeConfigPage = useCallback(() => {
        setIsOpenedConfigPage(false);
        updateExperienceRoute("live");
    }, [setIsOpenedConfigPage, updateExperienceRoute]);

    useEffect(() => {
        if (!currentIsOpenedConfigPage.data) return undefined;
        const closeOnEscape = (event) => {
            if (event.key === "Escape") closeConfigPage();
        };
        window.addEventListener("keydown", closeOnEscape);
        return () => window.removeEventListener("keydown", closeOnEscape);
    }, [closeConfigPage, currentIsOpenedConfigPage.data]);

    if (!currentIsOpenedConfigPage.data) return null;

    return (
        <div
            className={styles.page}
            role="dialog"
            aria-modal="true"
            aria-labelledby="config-page-title"
        >
            <div className={styles.scrim} onClick={closeConfigPage} />
            <div className={styles.container}>
                <Topbar
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    onClose={closeConfigPage}
                />
                <SidebarSection searchQuery={searchQuery} onSelect={() => setSearchQuery("")} />
                <div className={styles.main_container}>
                    <SectionContext isSearching={searchQuery.trim().length >= 2} />
                    <SettingSection searchQuery={searchQuery} onClearSearch={() => setSearchQuery("")} />
                </div>
            </div>
        </div>
    );
};
