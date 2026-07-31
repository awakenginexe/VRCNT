import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@useI18n";

import { useLanguageSettings } from "@logics_main";
import { useTranscription } from "@logics_configs";
import { useStore_IsOpenedLanguageSelector } from "@store";
import styles from "./LanguageSelector.module.scss";
import {
    getLanguageDisplayLabel,
} from "../../sidebar_section/language_settings/languageDisplayUtils.js";
import { findDuplicateSlot } from "@logics_common/languageProfileUtils.js";
import { LanguageFlag } from "../../sidebar_section/language_settings/LanguageFlag.jsx";

import { LanguageSelectorTopBar } from "./language_selector_top_bar/LanguageSelectorTopBar";

const LANGUAGE_CODES = {
    "Arabic": "ar",
    "Bulgarian": "bg",
    "Catalan": "ca",
    "Chinese Simplified": "zh",
    "Chinese Traditional": "zh",
    "Croatian": "hr",
    "Czech": "cs",
    "Danish": "da",
    "Dutch": "nl",
    "English": "en",
    "Estonian": "et",
    "Filipino": "tl",
    "Finnish": "fi",
    "French": "fr",
    "Georgian": "ka",
    "German": "de",
    "Greek": "el",
    "Gujarati": "gu",
    "Hebrew": "he",
    "Hindi": "hi",
    "Hungarian": "hu",
    "Italian": "it",
    "Japanese": "ja",
    "Kazakh": "kk",
    "Korean": "ko",
    "Latvian": "lv",
    "Lithuanian": "lt",
    "Norwegian": "nb",
    "Persian": "fa",
    "Polish": "pl",
    "Portuguese": "pt",
    "Romanian": "ro",
    "Russian": "ru",
    "Slovak": "sk",
    "Slovenian": "sl",
    "Spanish": "es",
    "Swedish": "sv",
    "Telugu": "te",
    "Thai": "th",
    "Turkish": "tr",
    "Ukrainian": "uk",
    "Uzbek": "uz",
    "Vietnamese": "vi",
};

const VOSK_MODEL_LANGUAGES = {
    "small-en": ["en"],
    "large-en": ["en"],
    "small-ja": ["ja"],
    "small-zh": ["zh"],
    "small-ko": ["ko"],
    "small-fr": ["fr"],
    "small-en-in": ["en"],
    "small-de": ["de"],
    "small-es": ["es"],
    "small-pt": ["pt"],
    "small-ru": ["ru"],
    "small-tr": ["tr"],
    "small-vn": ["vi"],
    "small-it": ["it"],
    "small-nl": ["nl"],
    "small-ca": ["ca"],
    "ar-mgb2": ["ar"],
    "el-gr": ["el"],
    "small-fa": ["fa"],
    "tl-ph-generic": ["tl"],
    "small-uk": ["uk"],
    "small-kz": ["kk"],
    "small-sv": ["sv"],
    "small-eo": ["eo"],
    "small-hi": ["hi"],
    "small-cs": ["cs"],
    "small-pl": ["pl"],
    "small-uz": ["uz"],
    "br": ["br"],
    "small-gu": ["gu"],
    "small-tg": ["tg"],
    "small-te": ["te"],
    "small-ky": ["ky"],
    "small-ka": ["ka"],
};

const PARAKEET_MODEL_LANGUAGES = {
    "parakeet-tdt-0.6b-v3": [
        "bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el", "hu", "it",
        "lv", "lt", "mt", "pl", "pt", "ro", "sk", "sl", "es", "sv", "ru", "uk",
    ],
    "parakeet-tdt-0.6b": ["en"],
    "parakeet-tdt-ctc-0.6b": ["ja"],
    "parakeet-tdt-1.1b": ["en"],
    "canary-1b": ["en", "de", "es", "fr"],
};

const SENSEVOICE_MODEL_LANGUAGES = {
    "sensevoice-small-int8": ["zh", "yue", "en", "ja", "ko"],
    "sensevoice-small-fp32": ["zh", "yue", "en", "ja", "ko"],
};

const getLanguageCode = ({ language, country }, engine) => {
    if (engine === "Vosk" && language === "Chinese Traditional" && country === "Hong Kong") return "";
    if (engine === "SenseVoice") {
        if (language === "Chinese Simplified") return "zh";
        if (language === "Chinese Traditional") return country === "Hong Kong" ? "yue" : "zh";
        if (language === "English") return "en";
        if (language === "Japanese") return "ja";
        if (language === "Korean") return "ko";
        return "";
    }
    return LANGUAGE_CODES[language] ?? "";
};

const buildSupportGuard = ({ selectorType, targetKey, engine, voskWeightType, parakeetWeightType, sensevoiceWeightType }) => {
    const isEngineLimited = engine === "Vosk" || engine === "Parakeet" || engine === "SenseVoice";
    const isPausedSingleEngineSlot = (
        (engine === "Vosk" || engine === "Parakeet")
        && targetKey !== "1"
    );
    const shouldRestrict = isEngineLimited && !isPausedSingleEngineSlot && (
        selectorType === "your_language" ||
        selectorType === "target_language"
    );

    if (shouldRestrict === false) {
        return { isActive: false, engine, isSupported: () => true };
    }

    const supportedCodes = new Set(
        engine === "Vosk" ? (VOSK_MODEL_LANGUAGES[voskWeightType] ?? []) :
        engine === "SenseVoice" ? (SENSEVOICE_MODEL_LANGUAGES[sensevoiceWeightType] ?? []) :
        (PARAKEET_MODEL_LANGUAGES[parakeetWeightType] ?? [])
    );

    return {
        isActive: true,
        engine,
        isSupported: (languageData) => {
            const languageCode = getLanguageCode(languageData, engine);
            return languageCode !== "" && supportedCodes.has(languageCode);
        },
    };
};

export const LanguageSelector = ({ title, onClickFunction, selectorType }) => {
    const { t } = useI18n();
    const { currentIsOpenedLanguageSelector, updateIsOpenedLanguageSelector } = useStore_IsOpenedLanguageSelector();
    const {
        currentSelectableLanguageList,
        currentSelectedPresetTabNumber,
        currentSelectedYourLanguages,
        currentSelectedTargetLanguages,
    } = useLanguageSettings();
    const [query, setQuery] = useState("");
    const [isLegacyLayout, setIsLegacyLayout] = useState(false);
    const searchInputRef = useRef(null);
    const {
        currentSelectedTranscriptionEngine,
        currentSelectedVoskWeightType,
        currentSelectedParakeetWeightType,
        currentSelectedSenseVoiceWeightType,
    } = useTranscription();

    const supportGuard = buildSupportGuard({
        selectorType,
        targetKey: currentIsOpenedLanguageSelector.data.target_key,
        engine: currentSelectedTranscriptionEngine?.data,
        voskWeightType: currentSelectedVoskWeightType?.data,
        parakeetWeightType: currentSelectedParakeetWeightType?.data,
        sensevoiceWeightType: currentSelectedSenseVoiceWeightType?.data,
    });
    const presetKey = currentSelectedPresetTabNumber.data ?? "1";
    const selectedGroup = selectorType === "your_language"
        ? currentSelectedYourLanguages.data?.[presetKey]
        : selectorType === "target_language"
            ? currentSelectedTargetLanguages.data?.[presetKey]
            : null;

    const getAvailability = (languageData) => {
        const unsupported = supportGuard.isSupported(languageData) === false;
        const duplicate = selectedGroup
            ? findDuplicateSlot(
                selectedGroup,
                languageData,
                currentIsOpenedLanguageSelector.data.target_key,
            )
            : null;
        if (duplicate) {
            return {
                isDisabled: true,
                reason: t("main_page.language_panels.duplicate_language"),
            };
        }
        if (unsupported) {
            return {
                isDisabled: true,
                reason: t("main_page.language_selector.unsupported_by_model", {
                    engine: supportGuard.engine,
                }),
            };
        }
        return { isDisabled: false, reason: undefined };
    };

    const closeLanguageSelector = () => {
        updateIsOpenedLanguageSelector({
            your_language: false,
            your_translation_language: false,
            target_language: false,
            target_key: "1",
        });
    };

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === "Escape") closeLanguageSelector();
        };

        window.addEventListener("keydown", handleKeyDown);
        searchInputRef.current?.focus();
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    const filteredLanguages = useMemo(() => {
        const normalizedQuery = query.trim().toLocaleLowerCase();
        if (normalizedQuery === "") return currentSelectableLanguageList.data;

        return currentSelectableLanguageList.data.filter((languageData) => (
            [
                languageData.language,
                languageData.country,
                getLanguageDisplayLabel(languageData),
            ]
                .filter(Boolean)
                .some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
        ));
    }, [currentSelectableLanguageList.data, query]);

    const groupLanguagesByFirstLetter = (languages) => {
        return languages.reduce((acc, { language, country }) => {
            const firstLetter = language[0].toUpperCase();
            if (!acc[firstLetter]) {
                acc[firstLetter] = [];
            }
            acc[firstLetter].push({ language, country });
            return acc;
        }, {});
    };

    const groupedLanguages = groupLanguagesByFirstLetter(filteredLanguages);

    return (
        <div
            className={styles.backdrop}
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeLanguageSelector();
            }}
        >
            <section
                className={clsx(styles.dialog, {
                    [styles.is_legacy_layout]: isLegacyLayout,
                })}
                role="dialog"
                aria-modal="true"
                aria-labelledby="language-selector-title"
            >
                <LanguageSelectorTopBar title={title} titleId="language-selector-title" />
                <div className={styles.toolbar}>
                    <label className={styles.search_box}>
                        <svg className={styles.search_icon} viewBox="0 0 24 24" aria-hidden="true">
                            <path d="m21 20-4.7-4.7a7.5 7.5 0 1 0-1 1L20 21l1-1ZM5.5 10.5a5 5 0 1 1 10 0 5 5 0 0 1-10 0Z" />
                        </svg>
                        <input
                            ref={searchInputRef}
                            type="search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={t("main_page.language_selector.search_placeholder")}
                            aria-label={t("main_page.language_selector.search_label")}
                        />
                    </label>
                    <button
                        type="button"
                        className={styles.layout_toggle}
                        onClick={() => setIsLegacyLayout((current) => !current)}
                    >
                        {isLegacyLayout
                            ? t("main_page.language_selector.open_compact_layout")
                            : t("main_page.language_selector.open_legacy_layout")}
                    </button>
                </div>
                {supportGuard.isActive && (
                    <p className={styles.language_support_hint}>
                        {t("main_page.language_selector.model_support_hint", { engine: supportGuard.engine })}
                    </p>
                )}
                <div className={styles.language_list_scroll_wrapper}>
                    {filteredLanguages.length === 0 ? (
                        <div className={styles.empty_result} role="status">
                            <strong>{t("main_page.language_selector.no_results_title")}</strong>
                            <span>
                                {query.trim() === ""
                                    ? t("main_page.language_selector.language_list_unavailable")
                                    : t("main_page.language_selector.no_results_detail", { query: query.trim() })}
                            </span>
                        </div>
                    ) : isLegacyLayout ? (
                        <div className={styles.language_list_legacy}>
                            {Object.entries(groupedLanguages).map(([letter, languages]) => (
                                <LanguageGroup
                                    key={letter}
                                    onClickFunction={onClickFunction}
                                    letter={letter}
                                    languages={languages}
                                    getAvailability={getAvailability}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className={styles.language_list_compact}>
                            {filteredLanguages.map((languageData) => (
                                <LanguageButtonWithAvailability
                                    key={`${languageData.language}-${languageData.country}`}
                                    onClickFunction={onClickFunction}
                                    languageData={languageData}
                                    getAvailability={getAvailability}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
};

const LanguageGroup = ({ onClickFunction, letter, languages, getAvailability }) => {
    return (
        <div className={styles.language_each_letter_box}>
            <div className={styles.language_letter_header}>
                <p className={styles.language_latter}>{letter}</p>
                <div className={styles.language_letter_divider}></div>
            </div>
            {languages.map((languageData) => (
                <LanguageButtonWithAvailability
                    key={`${languageData.language}-${languageData.country}`}
                    onClickFunction={onClickFunction}
                    languageData={languageData}
                    getAvailability={getAvailability}
                />
            ))}
        </div>
    );
};

const LanguageButtonWithAvailability = ({ onClickFunction, languageData, getAvailability }) => {
    const availability = getAvailability(languageData);
    return (
        <LanguageButton
            onClickFunction={onClickFunction}
            language_data={languageData}
            isDisabled={availability.isDisabled}
            disabledReason={availability.reason}
        />
    );
};

const LanguageButton = ({ onClickFunction, language_data, isDisabled, disabledReason }) => {

    const adjustedOnClickFunction = () => {
        if (isDisabled === true) return;
        onClickFunction({
            language: language_data.language,
            country: language_data.country,
        });
    };

    const languageButtonClass = clsx(styles.language_button, {
        [styles.is_disabled]: isDisabled === true,
    });

    return (
        <button
            type="button"
            className={languageButtonClass}
            onClick={adjustedOnClickFunction}
            aria-disabled={isDisabled === true}
            title={isDisabled === true ? disabledReason : undefined}
            aria-label={isDisabled === true
                ? `${getLanguageDisplayLabel(language_data)}. ${disabledReason}`
                : getLanguageDisplayLabel(language_data)}
        >
            <div className={styles.language_identity}>
                <LanguageFlag country={language_data.country} className={styles.language_flag} />
                <div className={styles.language_copy}>
                    <p className={styles.language_label}>{language_data.language}</p>
                    <p className={styles.country_label}>{language_data.country}</p>
                </div>
            </div>
            <p className={styles.language_chip}>{getLanguageDisplayLabel(language_data)}</p>
        </button>
    );
};
