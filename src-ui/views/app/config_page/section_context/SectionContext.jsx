import { useI18n } from "@useI18n";
import { useStore_SelectedConfigTabId } from "@store";
import { getSidebarTabMeta } from "../sidebar_section/sidebarTabMeta.js";
import styles from "./SectionContext.module.scss";

export const SectionContext = ({ isSearching = false }) => {
    const { t } = useI18n();
    const { currentSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const meta = getSidebarTabMeta(currentSelectedConfigTabId.data, t);

    return (
        <aside className={styles.container}>
            <span className={styles.context_label}>
                {isSearching
                    ? t("config_page.focus_settings.search_results")
                    : t("config_page.focus_settings.current_section")}
            </span>
            <h1>
                {isSearching
                    ? t("config_page.focus_settings.search_label")
                    : meta.label}
            </h1>
            <p>
                {isSearching
                    ? t("config_page.focus_settings.search_hint")
                    : meta.tooltipDetail}
            </p>
            <div className={styles.note}>
                <span className={styles.note_dot} aria-hidden="true" />
                {t("config_page.focus_settings.applies_immediately")}
            </div>
        </aside>
    );
};
