import { useI18n } from "@useI18n";
import { useIsOscAvailable } from "@logics_common";
import { useLanguageSettings, useMainFunction } from "@logics_main";
import { useOthers, useTranscription } from "@logics_configs";

import MicSvg from "@images/mic.svg?react";
import HeadphonesSvg from "@images/headphones.svg?react";
import { MainFunctionSwitch } from "../../sidebar_section/main_function_switch/MainFunctionSwitch";
import { LanguageProfileGroup } from "../../sidebar_section/language_settings/language_profile_group/LanguageProfileGroup";
import { LanguageSelectorOpenButton } from "../../sidebar_section/language_settings/language_selector_open_button/LanguageSelectorOpenButton";
import { TranscriptionEngineLabel } from "../../sidebar_section/language_settings/transcription_engine_label/TranscriptionEngineLabel";
import { TranslatorSelectorOpenButton } from "../../sidebar_section/language_settings/translator_selector_open_button/TranslatorSelectorOpenButton";
import { PipelineStatus } from "../pipeline_status/PipelineStatus";
import { SessionPrimaryAction } from "./SessionPrimaryAction";
import styles from "./LiveControlRail.module.scss";

export const LiveControlRail = () => {
    const { t } = useI18n();
    const {
        currentTranslationStatus,
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
    const { currentIsOscAvailable } = useIsOscAvailable();
    const {
        currentEnableSendMessageToVrc,
        currentEnableSendReceivedMessageToVrc,
    } = useOthers();
    const transcriptionEngine = currentSelectedTranscriptionEngine?.data ?? "";
    const capability = currentTranscriptionLanguageCapabilities.data?.[transcriptionEngine] ?? {
        microphone_max: 1,
        received_max: 1,
        parallel_candidates: false,
    };
    const isSessionActive = [
        currentTranslationStatus.data,
        currentTranscriptionSendStatus.data,
        currentTranscriptionReceiveStatus.data,
    ].some(Boolean);
    const oscReady = currentIsOscAvailable.data === true;

    return (
        <aside className={styles.container} aria-label={t("main_page.live_workspace.session_controls")}>
            <header className={styles.header}>
                <div>
                    <p className={styles.eyebrow}>{t("main_page.live_workspace.control_rail_eyebrow")}</p>
                    <h2 className={styles.title}>{t("main_page.live_workspace.session_controls")}</h2>
                </div>
                <span className={styles.session_state} data-active={isSessionActive}>
                    {isSessionActive
                        ? t("main_page.live_workspace.session_active")
                        : t("main_page.live_workspace.session_ready")}
                </span>
            </header>

            <SessionPrimaryAction />
            <MainFunctionSwitch layout="control_rail" includeForeground={false} />

            <section className={styles.section} aria-labelledby="live-language-routing-title">
                <p id="live-language-routing-title" className={styles.section_label}>
                    {t("main_page.live_workspace.language_routing")}
                </p>
                <LanguageProfileGroup
                    variant="live_rail"
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
                <LanguageSelectorOpenButton
                    variant="live_rail"
                    TurnedOnSvgComponent={HeadphonesSvg}
                    is_turned_on={currentTranscriptionReceiveStatus.data}
                    selector_key="your_translation_language"
                    target_key="1"
                />
                <LanguageProfileGroup
                    variant="live_rail"
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
            </section>

            <section className={styles.section} aria-labelledby="live-vr-output-title">
                <p id="live-vr-output-title" className={styles.section_label}>
                    {t("main_page.live_workspace.vrchat_output")}
                </p>
                <div className={styles.output_statuses}>
                    <span className={styles.output_status} data-ready={oscReady}>
                        {oscReady
                            ? t("main_page.live_workspace.osc_ready")
                            : t("main_page.live_workspace.osc_unavailable")}
                    </span>
                    <span className={styles.output_status} data-ready={currentEnableSendMessageToVrc.data === true}>
                        {currentEnableSendMessageToVrc.data === true
                            ? t("main_page.live_workspace.chatbox_sending")
                            : t("main_page.live_workspace.chatbox_off")}
                    </span>
                    {currentEnableSendReceivedMessageToVrc.data === true && (
                        <span className={styles.output_status} data-ready>
                            {t("main_page.live_workspace.incoming_chatbox_sending")}
                        </span>
                    )}
                </div>
            </section>

            <section className={styles.section} aria-labelledby="live-engine-title">
                <p id="live-engine-title" className={styles.section_label}>
                    {t("main_page.live_workspace.engine_and_translation")}
                </p>
                <div className={styles.engine_controls}>
                    <TranscriptionEngineLabel variant="live_compact" />
                    <TranslatorSelectorOpenButton variant="live_compact" />
                </div>
            </section>

            <details className={styles.diagnostics}>
                <summary>
                    <span>{t("main_page.live_workspace.advanced_diagnostics")}</span>
                    <span className={styles.summary_hint}>{t("main_page.live_workspace.advanced_diagnostics_hint")}</span>
                </summary>
                <div className={styles.diagnostics_body}>
                    <PipelineStatus />
                </div>
            </details>
        </aside>
    );
};
