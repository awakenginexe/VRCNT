import styles from "./LiveLanguageBar.module.scss";

import MicSvg from "@images/mic.svg?react";
import HeadphonesSvg from "@images/headphones.svg?react";
import { useI18n } from "@useI18n";
import { useMainFunction, useLanguageSettings } from "@logics_main";
import { useTranscription } from "@logics_configs";
import { LanguageSelectorOpenButton } from "../../sidebar_section/language_settings/language_selector_open_button/LanguageSelectorOpenButton";
import { LanguageProfileGroup } from "../../sidebar_section/language_settings/language_profile_group/LanguageProfileGroup";
import { TranslatorSelectorOpenButton } from "../../sidebar_section/language_settings/translator_selector_open_button/TranslatorSelectorOpenButton";
import { TranscriptionEngineLabel } from "../../sidebar_section/language_settings/transcription_engine_label/TranscriptionEngineLabel";

export const LiveLanguageBar = () => {
    const { t } = useI18n();
    const {
        currentTranscriptionSendStatus,
        currentTranscriptionReceiveStatus,
    } = useMainFunction();
    const { currentSelectedTranscriptionEngine } = useTranscription();
    const {
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

    return (
        <section className={styles.container} aria-label="Live language routes">
            <div className={styles.language_routes}>
                <LanguageProfileGroup
                    variant="live_route"
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
                <span className={styles.route_arrow} aria-hidden="true">→</span>
                <div className={styles.preferred_route}>
                    <LanguageSelectorOpenButton
                        variant="live_route"
                        TurnedOnSvgComponent={HeadphonesSvg}
                        is_turned_on={currentTranscriptionReceiveStatus.data}
                        selector_key="your_translation_language"
                        target_key="1"
                    />
                </div>
                <span className={styles.route_arrow} aria-hidden="true">→</span>
                <LanguageProfileGroup
                    variant="live_route"
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
            </div>
            <div className={styles.engine_controls}>
                <TranscriptionEngineLabel variant="live_compact" />
                <TranslatorSelectorOpenButton variant="live_compact" />
            </div>
        </section>
    );
};
