import MicSvg from "@images/mic.svg?react";
import HeadphonesSvg from "@images/headphones.svg?react";
import { useI18n } from "@useI18n";
import {
    useStore_IsOpenedTranscriptionEngineSelector,
    useStore_IsOpenedTranslatorSelector,
} from "@store";
import { useMainFunction, useLanguageSettings } from "@logics_main";
import { useTranscription } from "@logics_configs";
import { PresetTabSelector } from "./preset_tab_selector/PresetTabSelector";
import { LanguageSelectorOpenButton } from "./language_selector_open_button/LanguageSelectorOpenButton";
import { LanguageSwapButton } from "./language_swap_button/LanguageSwapButton";
import { LanguageProfileGroup } from "./language_profile_group/LanguageProfileGroup";
import { TranslatorSelectorOpenButton } from "./translator_selector_open_button/TranslatorSelectorOpenButton";
import { TranscriptionEngineLabel } from "./transcription_engine_label/TranscriptionEngineLabel";
import styles from "./LanguageSettings.module.scss";


export const LanguageSettings = () => {
    const { t } = useI18n();
    const { updateIsOpenedTranslatorSelector } = useStore_IsOpenedTranslatorSelector();
    const { updateIsOpenedTranscriptionEngineSelector } = useStore_IsOpenedTranscriptionEngineSelector();
    const closeSelectors = () => {
        updateIsOpenedTranslatorSelector(false);
        updateIsOpenedTranscriptionEngineSelector(false);
    };

    return (
        <div className={styles.container} onMouseLeave={closeSelectors}>
            <p className={styles.title}>{t("main_page.language_settings")}</p>
            <PresetTabSelector />
            <PresetContainer />
        </div>
    );
};

const PresetContainer = () => {
    const { t } = useI18n();
    const { currentTranscriptionSendStatus, currentTranscriptionReceiveStatus } = useMainFunction();
    const { currentSelectedTranscriptionEngine } = useTranscription();
    const {
        currentSelectedPresetTabNumber,
        currentSelectedYourTranslationLanguages,
        currentTranscriptionLanguageCapabilities,
        getCurrentYourLanguages,
        getCurrentTargetLanguages,
        removeYourLanguage,
        removeTargetLanguage,
    } = useLanguageSettings();
    const transcriptionEngine = currentSelectedTranscriptionEngine?.data ?? "Google";
    const capability = currentTranscriptionLanguageCapabilities.data?.[transcriptionEngine] ?? {
        microphone_max: 1,
        received_max: 1,
        parallel_candidates: false,
    };
    const presetKey = currentSelectedPresetTabNumber.data ?? "1";
    const preferredLanguages = currentSelectedYourTranslationLanguages.data?.[presetKey] ?? {};

    return (
        <div className={styles.preset_container}>
            <LanguageProfileGroup
                group="speaking"
                title={t("main_page.language_panels.speaking_title")}
                description={t("main_page.language_panels.speaking_desc")}
                languages={getCurrentYourLanguages()}
                selectorKey="your_language"
                engine={transcriptionEngine}
                capability={capability}
                Icon={MicSvg}
                isActive={currentTranscriptionSendStatus.data}
                onRemove={removeYourLanguage}
            />

            <LanguageSwapButton />

            <LanguageProfileGroup
                group="target"
                title={t("main_page.language_panels.targets_title")}
                description={t("main_page.language_panels.targets_desc")}
                languages={getCurrentTargetLanguages()}
                selectorKey="target_language"
                engine={transcriptionEngine}
                capability={capability}
                Icon={HeadphonesSvg}
                isActive={currentTranscriptionReceiveStatus.data}
                onRemove={removeTargetLanguage}
            />

            <section className={styles.preferred_panel} aria-labelledby="preferred-language-title">
                <div className={styles.section_header}>
                    <div className={styles.preferred_title_row}>
                        <HeadphonesSvg
                            className={currentTranscriptionReceiveStatus.data
                                ? styles.active_role_icon
                                : styles.role_icon}
                            aria-hidden="true"
                        />
                        <h3 id="preferred-language-title" className={styles.section_title}>
                            {t("main_page.language_panels.preferred_title")}
                        </h3>
                    </div>
                    <p className={styles.section_hint}>
                        {t("main_page.language_panels.preferred_desc")}
                    </p>
                </div>
                <LanguageSelectorOpenButton
                    TurnedOnSvgComponent={HeadphonesSvg}
                    is_turned_on={currentTranscriptionReceiveStatus.data}
                    selector_key="your_translation_language"
                    target_key="1"
                    variant="profile"
                    show_title={false}
                    selected_group={preferredLanguages}
                />
            </section>

            <div className={styles.engine_panel}>
                <div className={styles.section_header}>
                    <h3 className={styles.section_title}>{t("main_page.language_panels.engines_title")}</h3>
                    <p className={styles.section_hint}>{t("main_page.language_panels.engines_desc")}</p>
                </div>
                <div className={styles.engine_controls}>
                    <TranslatorSelectorOpenButton />
                    <TranscriptionEngineLabel />
                </div>
            </div>
        </div>
    );
};
