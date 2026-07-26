import { useMemo } from "react";
import { useI18n } from "@useI18n";
import { useStore_SelectedConfigTabId } from "@store";
import { getSidebarTabMeta, sidebarTabOrder } from "../sidebar_section/sidebarTabMeta.js";
import { buildSettingsSearchResults } from "./settingsSearch.js";
import styles from "./SettingsSearchResults.module.scss";

export const SettingsSearchResults = ({ query, onSelectResult }) => {
    const { t, i18n } = useI18n();
    const { updateSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const language = i18n.resolvedLanguage ?? i18n.language;
    const resourceBundle = i18n.getResourceBundle(language, "translation");

    const tabMeta = useMemo(
        () => Object.fromEntries(
            sidebarTabOrder.map((tabId) => [tabId, getSidebarTabMeta(tabId, t)]),
        ),
        [language, t],
    );

    const results = useMemo(
        () => buildSettingsSearchResults({ resourceBundle, query, tabMeta }),
        [query, resourceBundle, tabMeta],
    );

    if (results.length === 0) {
        return (
            <div className={styles.empty}>
                <strong>{t("config_page.focus_settings.no_results")}</strong>
                <span>{t("config_page.focus_settings.no_results_detail")}</span>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.summary}>
                <strong>{t("config_page.focus_settings.results_found", { count: results.length })}</strong>
                <span>{t("config_page.focus_settings.result_help")}</span>
            </div>
            <div className={styles.results}>
                {results.map((result) => (
                    <button
                        key={`${result.tabId}:${result.path}:${result.label}`}
                        type="button"
                        className={styles.result}
                        data-settings-result={result.tabId}
                        onClick={() => {
                            updateSelectedConfigTabId(result.tabId);
                            onSelectResult?.();
                        }}
                    >
                        <span className={styles.section}>{result.sectionLabel}</span>
                        <span className={styles.label}>{result.label}</span>
                        <span className={styles.arrow} aria-hidden="true">›</span>
                    </button>
                ))}
            </div>
        </div>
    );
};
