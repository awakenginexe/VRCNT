import styles from "./LiveLanguageBar.module.scss";

import MicSvg from "@images/mic.svg?react";
import HeadphonesSvg from "@images/headphones.svg?react";
import { useMainFunction } from "@logics_main";
import { LanguageSelectorOpenButton } from "../../sidebar_section/language_settings/language_selector_open_button/LanguageSelectorOpenButton";
import { TranslatorSelectorOpenButton } from "../../sidebar_section/language_settings/translator_selector_open_button/TranslatorSelectorOpenButton";
import { TranscriptionEngineLabel } from "../../sidebar_section/language_settings/transcription_engine_label/TranscriptionEngineLabel";

export const LiveLanguageBar = () => {
    const {
        currentTranscriptionSendStatus,
        currentTranscriptionReceiveStatus,
    } = useMainFunction();

    return (
        <section className={styles.container} aria-label="Live language routes">
            <div className={styles.language_routes}>
                <LanguageSelectorOpenButton
                    variant="live_route"
                    TurnedOnSvgComponent={MicSvg}
                    is_turned_on={currentTranscriptionSendStatus.data}
                    selector_key="your_language"
                    target_key="1"
                />
                <span className={styles.route_arrow} aria-hidden="true">→</span>
                <LanguageSelectorOpenButton
                    variant="live_route"
                    TurnedOnSvgComponent={HeadphonesSvg}
                    is_turned_on={currentTranscriptionReceiveStatus.data}
                    selector_key="your_translation_language"
                    target_key="1"
                />
                <span className={styles.route_arrow} aria-hidden="true">→</span>
                <LanguageSelectorOpenButton
                    variant="live_route"
                    TurnedOnSvgComponent={HeadphonesSvg}
                    is_turned_on={currentTranscriptionReceiveStatus.data}
                    selector_key="target_language"
                    target_key="1"
                />
            </div>
            <div className={styles.engine_controls}>
                <TranscriptionEngineLabel variant="live_compact" />
                <TranslatorSelectorOpenButton variant="live_compact" />
            </div>
        </section>
    );
};
