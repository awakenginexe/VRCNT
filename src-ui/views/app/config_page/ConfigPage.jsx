import { useEffect, useState } from "react";
import styles from "./ConfigPage.module.scss";

import { Topbar } from "./topbar/Topbar.jsx";
import { SidebarSection } from "./sidebar_section/SidebarSection.jsx";
import { SettingSection } from "./setting_section/SettingSection.jsx";
import { SectionContext } from "./section_context/SectionContext.jsx";
import { useIsOpenedConfigPage } from "@logics_common";

export const ConfigPage = () => {
    const { currentIsOpenedConfigPage, setIsOpenedConfigPage } = useIsOpenedConfigPage();
    const [searchQuery, setSearchQuery] = useState("");

    useEffect(() => {
        if (!currentIsOpenedConfigPage.data) return undefined;
        const closeOnEscape = (event) => {
            if (event.key === "Escape") setIsOpenedConfigPage(false);
        };
        window.addEventListener("keydown", closeOnEscape);
        return () => window.removeEventListener("keydown", closeOnEscape);
    }, [currentIsOpenedConfigPage.data, setIsOpenedConfigPage]);

    if (!currentIsOpenedConfigPage.data) return null;

    return (
        <div
            className={styles.page}
            role="dialog"
            aria-modal="true"
            aria-labelledby="config-page-title"
        >
            <div className={styles.scrim} onClick={() => setIsOpenedConfigPage(false)} />
            <div className={styles.container}>
                <Topbar searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
                <SidebarSection searchQuery={searchQuery} onSelect={() => setSearchQuery("")} />
                <div className={styles.main_container}>
                    <SectionContext isSearching={searchQuery.trim().length >= 2} />
                    <SettingSection searchQuery={searchQuery} onClearSearch={() => setSearchQuery("")} />
                </div>
            </div>
        </div>
    );
};
