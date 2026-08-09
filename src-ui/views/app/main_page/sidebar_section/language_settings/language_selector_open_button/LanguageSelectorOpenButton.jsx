import { useI18n } from "@useI18n";
import clsx from "clsx";
import styles from "./LanguageSelectorOpenButton.module.scss";
import ArrowLeftSvg from "@images/arrow_left.svg?react";
import { useStore_IsOpenedLanguageSelector } from "@store";
import {
    useLanguageSettings,
} from "@logics_main";
import { LanguageFlag } from "../LanguageFlag.jsx";

export const LanguageSelectorOpenButton = ({
    TurnedOnSvgComponent,
    is_turned_on,
    selector_key,
    target_key,
    variant = "settings",
    show_title = true,
    selected_group,
    recognition_engine = "",
}) => {
    const { t } = useI18n();
    const { updateIsOpenedLanguageSelector, currentIsOpenedLanguageSelector } = useStore_IsOpenedLanguageSelector();

    const {
        currentSelectedPresetTabNumber,
        currentSelectedYourLanguages,
        currentSelectedYourTranslationLanguages,
        currentSelectedTargetLanguages,
        getCurrentYourLanguages,
        getCurrentTargetLanguages,
    } = useLanguageSettings();

    const toggleSelector = () => {
        if (isThaiRecognitionSelector) return;
        if (currentIsOpenedLanguageSelector.data[selector_key] === true && currentIsOpenedLanguageSelector.data.target_key === target_key) { // Close Language Selector
            updateIsOpenedLanguageSelector({ your_language: false, your_translation_language: false, target_language: false, target_key: "1" });
        } else { // Open Language Selector
            updateIsOpenedLanguageSelector({
                your_language: selector_key === "your_language",
                your_translation_language: selector_key === "your_translation_language",
                target_language: selector_key === "target_language",
                target_key: target_key,
            });
        }
    };

    const arrow_class_names = clsx(styles.arrow_left_svg, {
        [styles.reverse]: (currentIsOpenedLanguageSelector.data[selector_key] === true && currentIsOpenedLanguageSelector.data.target_key === target_key),
    });

    const category_class_names = clsx(styles.category_svg, {
        [styles.is_turned_on]: is_turned_on,
    });

    const getVariable = (target_selector_key) => {
        if (selected_group) return selected_group;
        const presetKey = currentSelectedPresetTabNumber.data ?? "1";
        if (target_selector_key === "your_language") return {
            ...getCurrentYourLanguages(),
            ...(currentSelectedYourLanguages.data?.[presetKey] ?? {}),
        };
        if (target_selector_key === "your_translation_language") return currentSelectedYourTranslationLanguages.data?.[presetKey] ?? {};
        if (target_selector_key === "target_language") return currentSelectedTargetLanguages.data?.[presetKey] ?? getCurrentTargetLanguages();
        return {};
    };

    const getTitle = (target_selector_key) => {
        if (target_selector_key === "your_language") {
            return target_key === "1"
                ? t("main_page.language_panels.your_speaking_language")
                : t("main_page.language_panels.your_speaking_language_indexed", { index: target_key });
        }
        if (target_selector_key === "your_translation_language") return t("main_page.language_panels.your_translation_language");
        if (target_selector_key === "target_language") {
            const targetLanguages = getCurrentTargetLanguages();
            if (targetLanguages?.["2"]?.enable === false) return t("main_page.target_language");
            return `${t("main_page.target_language")} ${target_key}`;
        }
    };

    const title = getTitle(selector_key);
    const selectedGroup = getVariable(selector_key);
    const selectedEntry = selectedGroup?.[target_key];
    const isThaiRecognitionSelector = (
        recognition_engine === "Whisper Thai"
        && (selector_key === "your_language" || selector_key === "target_language")
    );
    const displayEntry = isThaiRecognitionSelector
        ? { language: "Thai", country: "Thailand", enable: true }
        : selectedEntry;

    if (displayEntry?.enable === false) return null;

    const language_text = displayEntry?.language ?? t("main_page.language_panels.loading");
    const country_text = displayEntry?.country ?? t("main_page.language_panels.loading");

    return (
        <div data-selector-key={selector_key} className={clsx(styles.container, styles[`variant_${variant}`])}>
            {show_title && (
                <div className={styles.title_container}>
                    <TurnedOnSvgComponent className={category_class_names} />
                    <p className={styles.title}>{title}</p>
                </div>
            )}
            <button
                type="button"
                className={styles.dropdown_menu_container}
                onClick={toggleSelector}
                disabled={isThaiRecognitionSelector}
                aria-disabled={isThaiRecognitionSelector}
                aria-haspopup="dialog"
                aria-expanded={
                    currentIsOpenedLanguageSelector.data[selector_key] === true &&
                    currentIsOpenedLanguageSelector.data.target_key === target_key
                }
                aria-label={t("main_page.language_panels.edit_language", {
                    language: language_text,
                    country: country_text,
                })}
            >
                <div className={styles.language_details}>
                    <LanguageFlag country={country_text} className={styles.flag_badge} />
                    <div className={styles.language_copy}>
                        <p className={styles.selected_language}>{language_text}</p>
                        <p className={styles.selected_country}>{country_text}</p>
                    </div>
                </div>
                <ArrowLeftSvg className={arrow_class_names} />
            </button>
        </div>
    );
};
