import clsx from "clsx";
import AddSvg from "@images/add.svg?react";
import RemoveSvg from "@images/remove.svg?react";
import { useI18n } from "@useI18n";
import { useStore_IsOpenedLanguageSelector } from "@store";
import {
    canAddLanguage,
    canRemoveLanguage,
    enabledSlotKeys,
    nextDisabledSlotKey,
    recognitionState,
} from "@logics_common/languageProfileUtils.js";
import { LanguageFlag } from "../LanguageFlag.jsx";
import styles from "./LanguageProfileGroup.module.scss";


const helperText = ({ t, group, engine, capability, count }) => {
    if (group === "speaking") {
        if (capability?.parallel_candidates && count > 1) {
            return t("main_page.language_panels.google_parallel_hint", { count });
        }
        if (engine === "Google") return t("main_page.language_panels.google_single_hint");
        if (engine === "Whisper") return t("main_page.language_panels.whisper_profile_hint");
        if (engine === "SenseVoice") return t("main_page.language_panels.sensevoice_profile_hint");
        if ((capability?.microphone_max ?? 1) === 1 && count > 1) {
            return t("main_page.language_panels.single_engine_speaking_hint", { engine });
        }
        return t("main_page.language_panels.recognition_active");
    }

    if ((capability?.received_max ?? 1) === 1 && count > 1) {
        return t("main_page.language_panels.single_engine_target_hint", { engine });
    }
    return t("main_page.language_panels.target_profile_hint");
};

export const LanguageProfileGroup = ({
    group,
    title,
    description,
    languages,
    selectorKey,
    engine,
    capability,
    Icon,
    isActive,
    onRemove,
}) => {
    const { t } = useI18n();
    const { updateIsOpenedLanguageSelector } = useStore_IsOpenedLanguageSelector();
    const activeKeys = enabledSlotKeys(languages);
    const count = activeKeys.length;
    const titleId = `language-profile-${group}-title`;
    const helperId = `language-profile-${group}-helper`;

    const openSelector = (targetKey) => {
        updateIsOpenedLanguageSelector({
            your_language: selectorKey === "your_language",
            your_translation_language: false,
            target_language: selectorKey === "target_language",
            target_key: targetKey,
        });
    };

    const addLanguage = () => {
        const targetKey = nextDisabledSlotKey(languages);
        if (targetKey) openSelector(targetKey);
    };

    return (
        <section className={styles.role_card} aria-labelledby={titleId} aria-describedby={helperId}>
            <header className={styles.role_header}>
                <div className={styles.role_identity}>
                    <Icon
                        className={clsx(styles.role_icon, { [styles.is_active]: isActive })}
                        aria-hidden="true"
                    />
                    <h3 id={titleId} className={styles.role_title}>{title}</h3>
                </div>
                <span className={styles.language_count} aria-live="polite">
                    {t("main_page.language_panels.language_count", { count })}
                </span>
            </header>

            <p className={styles.role_description}>{description}</p>

            <div className={styles.chip_list}>
                {activeKeys.map((targetKey) => {
                    const entry = languages[targetKey];
                    const state = recognitionState(capability, targetKey, group);
                    const removable = canRemoveLanguage(languages, targetKey);
                    const stateLabel = state === "paused"
                        ? t("main_page.language_panels.recognition_paused")
                        : state === "outgoing-only"
                            ? t("main_page.language_panels.outgoing_only")
                            : t("main_page.language_panels.recognition_active");
                    return (
                        <div
                            key={targetKey}
                            className={clsx(styles.language_chip, styles[`state_${state}`])}
                        >
                            <button
                                type="button"
                                className={styles.language_button}
                                onClick={() => openSelector(targetKey)}
                                aria-label={t("main_page.language_panels.edit_language", {
                                    language: entry.language,
                                    country: entry.country,
                                })}
                            >
                                <LanguageFlag country={entry.country} className={styles.flag} />
                                <span className={styles.language_copy}>
                                    <strong>{entry.language}</strong>
                                    <span>{entry.country}</span>
                                </span>
                            </button>
                            <span className={styles.state_label}>{stateLabel}</span>
                            <button
                                type="button"
                                className={styles.remove_button}
                                onClick={() => onRemove(targetKey)}
                                disabled={!removable}
                                aria-label={removable
                                    ? t("main_page.language_panels.remove_language", { language: entry.language })
                                    : t("main_page.language_panels.minimum_one_language")}
                                title={removable
                                    ? t("main_page.language_panels.remove_language", { language: entry.language })
                                    : t("main_page.language_panels.minimum_one_language")}
                            >
                                <RemoveSvg aria-hidden="true" />
                            </button>
                        </div>
                    );
                })}
            </div>

            {canAddLanguage(languages) && (
                <button type="button" className={styles.add_button} onClick={addLanguage}>
                    <AddSvg aria-hidden="true" />
                    <span>{t("main_page.language_panels.add_language")}</span>
                </button>
            )}

            <p id={helperId} className={styles.helper_text}>
                {helperText({ t, group, engine, capability, count })}
            </p>
        </section>
    );
};
