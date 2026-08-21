import { useMemo } from "react";
import { useI18n } from "@useI18n";
import { useLanguageSettings } from "@logics_main";
import { CustomModernSelect } from "@common_components";
import styles from "./EnginesWorkspace.module.scss";

const toArray = (value) => (
    Array.isArray(value) ? value : Object.values(value ?? {})
);

export const TranslationRoutingCard = () => {
    const { t } = useI18n();
    const {
        currentSelectedPresetTabNumber,
        currentTranslationEngines,
        currentSelectedTranslationEngines,
        currentCTranslate2AutoFallback,
        setSelectedTranslationEngines,
        setCTranslate2AutoFallback,
    } = useLanguageSettings();

    const presetKey = currentSelectedPresetTabNumber.data ?? "1";
    const translationProviders = useMemo(
        () => toArray(currentTranslationEngines.data)
            .filter((provider) => provider?.is_available === true),
        [currentTranslationEngines.data],
    );
    const translationSelection = currentSelectedTranslationEngines.data?.[presetKey] ?? "";
    const selectedProviders = Array.isArray(translationSelection)
        ? translationSelection
        : translationSelection ? [translationSelection] : [];
    const primaryProvider = selectedProviders[0] ?? "";
    const secondaryProvider = selectedProviders[1] ?? "";
    const emptyLabel = t("main_page.engines_workspace.loading_options");

    const updateProvider = (index, providerId) => {
        const next = [...selectedProviders];
        if (providerId) next[index] = providerId;
        else next.splice(index, 1);
        const unique = [...new Set(next.filter(Boolean))].slice(0, 2);
        setSelectedTranslationEngines(unique.length > 1 ? unique : unique[0] ?? "");
    };

    return (
        <section className={styles.provider_card} aria-label={t("main_page.engines_workspace.translation_title")}>
            <div className={styles.section_heading}>
                <div>
                    <p className={styles.section_kicker}>{t("main_page.engines_workspace.translation_kicker")}</p>
                    <h2>{t("main_page.engines_workspace.translation_title")}</h2>
                    <p>{t("main_page.engines_workspace.translation_detail")}</p>
                </div>
                <label className={styles.switch_label}>
                    <span>{t("main_page.engines_workspace.fallback_label")}</span>
                    <input
                        type="checkbox"
                        checked={currentCTranslate2AutoFallback.data === true}
                        disabled={currentCTranslate2AutoFallback.state === "pending"}
                        onChange={(event) => setCTranslate2AutoFallback(event.target.checked)}
                    />
                    <span className={styles.switch_control} aria-hidden="true" />
                </label>
            </div>
            <div className={styles.provider_grid}>
                <div className={styles.field}>
                    <CustomModernSelect
                        label={t("main_page.engines_workspace.primary_provider")}
                        value={primaryProvider}
                        options={translationProviders.length === 0
                            ? [{ id: "", title: emptyLabel }]
                            : translationProviders.map((provider) => ({
                                id: provider.id,
                                title: provider.label ?? provider.id,
                            }))}
                        disabled={translationProviders.length === 0 || currentSelectedTranslationEngines.state === "pending"}
                        placeholder={emptyLabel}
                        onChange={(value) => updateProvider(0, value)}
                    />
                </div>
                <div className={styles.field}>
                    <CustomModernSelect
                        label={t("main_page.engines_workspace.secondary_provider")}
                        value={secondaryProvider}
                        options={[
                            { id: "", title: t("main_page.engines_workspace.no_secondary_provider") },
                            ...translationProviders
                                .filter((provider) => provider.id !== primaryProvider)
                                .map((provider) => ({
                                    id: provider.id,
                                    title: provider.label ?? provider.id,
                                })),
                        ]}
                        disabled={translationProviders.length === 0 || currentSelectedTranslationEngines.state === "pending"}
                        placeholder={t("main_page.engines_workspace.no_secondary_provider")}
                        onChange={(value) => updateProvider(1, value)}
                    />
                </div>
            </div>
        </section>
    );
};
