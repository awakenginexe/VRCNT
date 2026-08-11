import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@useI18n";
import { useLanguageSettings } from "@logics_main";
import { useAppearance, useDevice, useOnboarding, useOthers } from "@logics_configs";
import { ui_configs } from "@ui_configs";
import {
    useIsOscAvailable,
    useIsOpenedConfigPage,
    useNotificationStatus,
} from "@logics_common";
import { useStdoutToPython } from "@useStdoutToPython";
import { CustomModernSelect } from "@common_components";
import { useStore_ExperienceRoute } from "@store";
import { TopBar } from "../main_section/top_bar/TopBar";
import { TranscriptionTranslationStep } from "./TranscriptionTranslationStep.jsx";
import styles from "./GuidedSetup.module.scss";

const SETUP_COMPLETION_TIMEOUT_MS = 8000;

const SETUP_STEPS = [
    { id: 1, labelKey: "main_page.guided_setup.step_app_language" },
    { id: 2, labelKey: "main_page.guided_setup.step_language" },
    { id: 3, labelKey: "main_page.guided_setup.step_translation" },
    { id: 4, labelKey: "main_page.guided_setup.step_audio" },
    { id: 5, labelKey: "main_page.guided_setup.step_transcription_translation" },
    { id: 6, labelKey: "main_page.guided_setup.step_vrchat" },
];

const languageOptionValue = (language) => {
    if (!language?.language || !language?.country) return "";
    return JSON.stringify({ language: language.language, country: language.country });
};

const decodeLanguageOption = (value) => {
    if (!value) return null;
    try {
        const language = JSON.parse(value);
        return typeof language?.language === "string" && typeof language?.country === "string"
            ? language
            : null;
    } catch {
        return null;
    }
};

const getLanguageLabel = (language, fallback) => (
    language?.language && language?.country
        ? `${language.language} · ${language.country}`
        : fallback
);

const toSelectableValues = (data) => {
    if (Array.isArray(data)) return data.filter((value) => typeof value === "string");
    return Object.values(data ?? {}).filter((value) => typeof value === "string");
};

const LanguageSelect = ({
    id,
    label,
    description,
    languages,
    selectedLanguage,
    emptyLabel,
    onChange,
    optional = false,
}) => {
    const selectedValue = languageOptionValue(selectedLanguage);
    const isDisabled = languages.length === 0;

    const selectOptions = useMemo(() => {
        const list = [];
        if (optional || selectedValue === "") {
            list.push({ id: "", title: emptyLabel });
        }
        languages.forEach((lang) => {
            const val = languageOptionValue(lang);
            list.push({
                id: val,
                title: lang.language,
                subtitle: lang.country,
                country: lang.country,
            });
        });
        return list;
    }, [emptyLabel, languages, optional, selectedValue]);

    return (
        <div className={styles.field}>
            <CustomModernSelect
                id={id}
                label={label}
                value={selectedValue}
                options={selectOptions}
                disabled={isDisabled}
                placeholder={emptyLabel}
                onChange={(val) => onChange(decodeLanguageOption(val))}
            />
            {description && <span className={styles.field_description}>{description}</span>}
        </div>
    );
};

const DeviceSelect = ({ id, label, values, selectedValue, emptyLabel, disabled, onChange }) => {
    const selectOptions = useMemo(() => {
        const nextValues = [...new Set(values)];
        if (selectedValue && !nextValues.includes(selectedValue)) nextValues.unshift(selectedValue);
        if (nextValues.length === 0) return [{ id: "", title: emptyLabel }];
        return nextValues.map((val) => ({ id: val, title: val }));
    }, [emptyLabel, selectedValue, values]);

    return (
        <div className={styles.field}>
            <CustomModernSelect
                id={id}
                label={label}
                value={selectedValue ?? ""}
                options={selectOptions}
                disabled={disabled || values.length === 0}
                placeholder={emptyLabel}
                onChange={onChange}
            />
        </div>
    );
};

const SetupToggle = ({ id, label, description, checked, disabled, onChange }) => (
    <label className={styles.toggle} htmlFor={id}>
        <span className={styles.toggle_copy}>
            <span className={styles.field_label}>{label}</span>
            {description && <span className={styles.field_description}>{description}</span>}
        </span>
        <input
            id={id}
            type="checkbox"
            checked={checked === true}
            disabled={disabled}
            onChange={onChange}
        />
        <span className={styles.toggle_control} aria-hidden="true" />
    </label>
);

export const GuidedSetup = () => {
    const { t } = useI18n();
    const [step, setStep] = useState(1);
    const [completionIntent, setCompletionIntent] = useState(null);
    const [completionError, setCompletionError] = useState("");
    const { updateExperienceRoute } = useStore_ExperienceRoute();
    const { setIsOpenedConfigPage } = useIsOpenedConfigPage();
    const { showNotification_Success, showNotification_Error } = useNotificationStatus();
    const { asyncStdoutToPython } = useStdoutToPython();
    const { currentIsOscAvailable } = useIsOscAvailable();
    const { currentUiLanguage, setUiLanguage } = useAppearance();
    const { currentSetupCompleted } = useOnboarding();
    const {
        currentSelectableLanguageList,
        currentSelectedPresetTabNumber,
        currentSelectedYourTranslationLanguages,
        getCurrentYourLanguages,
        getCurrentTargetLanguages,
        setSelectedYourLanguages,
        setSelectedYourTranslationLanguages,
        setSelectedTargetLanguages,
        removeTargetLanguage,
    } = useLanguageSettings();
    const {
        currentEnableAutoMicSelect,
        toggleEnableAutoMicSelect,
        currentMicHostList,
        currentMicDeviceList,
        currentSelectedMicHost,
        currentSelectedMicDevice,
        setSelectedMicHost,
        setSelectedMicDevice,
        currentEnableAutoSpeakerSelect,
        toggleEnableAutoSpeakerSelect,
        currentSpeakerDeviceList,
        currentSelectedSpeakerDevice,
        setSelectedSpeakerDevice,
    } = useDevice();
    const {
        currentEnableSendMessageToVrc,
        toggleEnableSendMessageToVrc,
        currentEnableSendReceivedMessageToVrc,
        toggleEnableSendReceivedMessageToVrc,
    } = useOthers();

    const presetKey = currentSelectedPresetTabNumber.data ?? "1";
    const selectableLanguages = currentSelectableLanguageList.data ?? [];
    const speakingLanguage = getCurrentYourLanguages()?.["1"];
    const translationLanguage = currentSelectedYourTranslationLanguages.data?.[presetKey]?.["1"];
    const targetLanguages = getCurrentTargetLanguages();
    const micHosts = toSelectableValues(currentMicHostList.data);
    const micDevices = toSelectableValues(currentMicDeviceList.data);
    const speakerDevices = toSelectableValues(currentSpeakerDeviceList.data);
    const isAutoMic = currentEnableAutoMicSelect.data === true;
    const isAutoSpeaker = currentEnableAutoSpeakerSelect.data === true;
    const isDevicePending = (
        currentEnableAutoMicSelect.state === "pending"
        || currentEnableAutoSpeakerSelect.state === "pending"
        || currentSelectedMicHost.state === "pending"
        || currentSelectedMicDevice.state === "pending"
        || currentSelectedSpeakerDevice.state === "pending"
    );

    const chooseSpeakingLanguage = (language) => {
        if (!language) return;
        setSelectedYourLanguages({ ...language, target_key: "1" });
    };
    const chooseTranslationLanguage = (language) => {
        if (!language) return;
        setSelectedYourTranslationLanguages({ ...language, target_key: "1" });
    };
    const chooseTargetLanguage = (targetKey, language) => {
        if (!language) {
            if (targetKey !== "1" && targetLanguages?.[targetKey]?.enable === true) {
                removeTargetLanguage(targetKey);
            }
            return;
        }
        setSelectedTargetLanguages({ ...language, target_key: targetKey });
    };
    const isCompletingSetup = completionIntent !== null;

    useEffect(() => {
        if (!completionIntent) return;
        if (currentSetupCompleted.data === true) {
            if (completionIntent.showSuccessNotification) {
                showNotification_Success(
                    t("main_page.guided_setup.complete_notification"),
                    { category_id: "guided_setup_complete" },
                );
            }
            setCompletionIntent(null);
            setCompletionError("");
            setIsOpenedConfigPage(false);
            updateExperienceRoute("live");
        }
    }, [
        completionIntent,
        currentSetupCompleted.data,
        setIsOpenedConfigPage,
        showNotification_Success,
        t,
        updateExperienceRoute,
    ]);

    useEffect(() => {
        if (!completionIntent) return undefined;

        const timeoutId = window.setTimeout(() => {
            setCompletionIntent(null);
            setCompletionError(t("main_page.guided_setup.setup_completion_error"));
        }, SETUP_COMPLETION_TIMEOUT_MS);

        return () => window.clearTimeout(timeoutId);
    }, [completionIntent, t]);

    const completeSetup = async ({ showSuccessNotification = false } = {}) => {
        if (isCompletingSetup) return;

        setCompletionError("");
        setCompletionIntent({ showSuccessNotification });
        const transportResult = await asyncStdoutToPython("/set/data/setup_completed", true);

        if (!transportResult.ok) {
            setCompletionIntent(null);
            setCompletionError(t("main_page.guided_setup.setup_completion_error"));
            showNotification_Error(
                t("blocking_operation.backend_unavailable"),
                { category_id: "guided_setup_completion_failed" },
            );
        }
    };
    const finishSetup = () => completeSetup({ showSuccessNotification: true });
    const skipSetup = () => completeSetup();

    return (
        <div className={styles.container}>
            <TopBar />
            <main className={styles.content} aria-labelledby="guided-setup-title">
                <section className={styles.intro_card}>
                    <div>
                        <p className={styles.eyebrow}>{t("main_page.guided_setup.eyebrow")}</p>
                        <h1 id="guided-setup-title">{t("main_page.guided_setup.title")}</h1>
                        <p>{t("main_page.guided_setup.detail")}</p>
                    </div>
                    <span className={styles.step_badge}>
                        {t("main_page.guided_setup.step_count", { current: step, total: SETUP_STEPS.length })}
                    </span>
                </section>

                <ol className={styles.progress} aria-label={t("main_page.guided_setup.progress_label")}>
                    {SETUP_STEPS.map((setupStep) => (
                        <li
                            key={setupStep.id}
                            data-active={setupStep.id === step}
                            data-complete={setupStep.id < step}
                            aria-current={setupStep.id === step ? "step" : undefined}
                        >
                            <span>{setupStep.id}</span>
                            <strong>{t(setupStep.labelKey)}</strong>
                        </li>
                    ))}
                </ol>

                <section className={styles.setup_card} aria-live="polite">
                    {step === 1 && (
                        <div className={styles.step_body}>
                            <p className={styles.eyebrow}>{t("main_page.guided_setup.step_app_language")}</p>
                            <h2>{t("main_page.guided_setup.app_language_title")}</h2>
                            <p className={styles.lead}>{t("main_page.guided_setup.app_language_detail")}</p>
                            <div className={styles.app_language_field}>
                                <CustomModernSelect
                                    id="guided-setup-app-language"
                                    label={t("main_page.guided_setup.app_language")}
                                    value={currentUiLanguage.data ?? ""}
                                    options={ui_configs.selectable_ui_languages}
                                    disabled={currentUiLanguage.state === "pending"}
                                    placeholder={t("main_page.guided_setup.app_language")}
                                    onChange={setUiLanguage}
                                />
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className={styles.step_body}>
                            <p className={styles.eyebrow}>{t("main_page.guided_setup.step_language")}</p>
                            <h2>{t("main_page.guided_setup.language_title")}</h2>
                            <p className={styles.lead}>{t("main_page.guided_setup.languages_detail")}</p>
                            <div className={styles.step_stack}>
                                <LanguageSelect
                                    id="guided-setup-speaking-language"
                                    label={t("main_page.guided_setup.speaking_language")}
                                    description={t("main_page.guided_setup.speaking_language_detail")}
                                    languages={selectableLanguages}
                                    selectedLanguage={speakingLanguage}
                                    emptyLabel={t("main_page.guided_setup.language_unavailable")}
                                    onChange={chooseSpeakingLanguage}
                                />
                                <div className={styles.field_grid}>
                                    <LanguageSelect
                                        id="guided-setup-target-language-1"
                                        label={t("main_page.guided_setup.target_language")}
                                        description={t("main_page.guided_setup.target_language_detail")}
                                        languages={selectableLanguages}
                                        selectedLanguage={targetLanguages?.["1"]}
                                        emptyLabel={t("main_page.guided_setup.language_unavailable")}
                                        onChange={(language) => chooseTargetLanguage("1", language)}
                                    />
                                    {["2", "3"].map((targetKey) => (
                                        <LanguageSelect
                                            key={targetKey}
                                            id={`guided-setup-target-language-${targetKey}`}
                                            label={t("main_page.guided_setup.additional_target", { index: targetKey })}
                                            languages={selectableLanguages}
                                            selectedLanguage={targetLanguages?.[targetKey]?.enable ? targetLanguages[targetKey] : null}
                                            emptyLabel={t("main_page.guided_setup.no_additional_target")}
                                            optional
                                            onChange={(language) => chooseTargetLanguage(targetKey, language)}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className={styles.step_body}>
                            <p className={styles.eyebrow}>{t("main_page.guided_setup.step_translation")}</p>
                            <h2>{t("main_page.guided_setup.translation_title")}</h2>
                            <p className={styles.lead}>{t("main_page.guided_setup.understanding_language_detail")}</p>
                            <div className={styles.app_language_field}>
                                <LanguageSelect
                                    id="guided-setup-translation-language"
                                    label={t("main_page.guided_setup.understanding_language")}
                                    description={t("main_page.guided_setup.understanding_language_detail")}
                                    languages={selectableLanguages}
                                    selectedLanguage={translationLanguage}
                                    emptyLabel={t("main_page.guided_setup.language_unavailable")}
                                    onChange={chooseTranslationLanguage}
                                />
                            </div>
                        </div>
                    )}

                    {step === 4 && (
                        <div className={styles.step_body}>
                            <p className={styles.eyebrow}>{t("main_page.guided_setup.step_audio")}</p>
                            <h2>{t("main_page.guided_setup.audio_title")}</h2>
                            <p className={styles.lead}>{t("main_page.guided_setup.audio_detail")}</p>
                            <div className={styles.device_group}>
                                <h3>{t("main_page.guided_setup.microphone")}</h3>
                                <SetupToggle
                                    id="guided-setup-auto-mic"
                                    label={t("main_page.guided_setup.auto_detect")}
                                    description={t("main_page.guided_setup.auto_detect_mic_detail")}
                                    checked={isAutoMic}
                                    disabled={currentEnableAutoMicSelect.state === "pending"}
                                    onChange={toggleEnableAutoMicSelect}
                                />
                                <div className={styles.field_grid}>
                                    <DeviceSelect
                                        id="guided-setup-mic-host"
                                        label={t("main_page.guided_setup.microphone_host")}
                                        values={micHosts}
                                        selectedValue={currentSelectedMicHost.data}
                                        emptyLabel={t("main_page.guided_setup.device_unavailable")}
                                        disabled={isAutoMic || isDevicePending}
                                        onChange={setSelectedMicHost}
                                    />
                                    <DeviceSelect
                                        id="guided-setup-mic-device"
                                        label={t("main_page.guided_setup.microphone_device")}
                                        values={micDevices}
                                        selectedValue={currentSelectedMicDevice.data}
                                        emptyLabel={t("main_page.guided_setup.device_unavailable")}
                                        disabled={isAutoMic || isDevicePending}
                                        onChange={setSelectedMicDevice}
                                    />
                                </div>
                            </div>
                            <div className={styles.device_group}>
                                <h3>{t("main_page.guided_setup.desktop_audio")}</h3>
                                <SetupToggle
                                    id="guided-setup-auto-speaker"
                                    label={t("main_page.guided_setup.auto_detect")}
                                    description={t("main_page.guided_setup.auto_detect_speaker_detail")}
                                    checked={isAutoSpeaker}
                                    disabled={currentEnableAutoSpeakerSelect.state === "pending"}
                                    onChange={toggleEnableAutoSpeakerSelect}
                                />
                                <DeviceSelect
                                    id="guided-setup-speaker-device"
                                    label={t("main_page.guided_setup.desktop_audio_device")}
                                    values={speakerDevices}
                                    selectedValue={currentSelectedSpeakerDevice.data}
                                    emptyLabel={t("main_page.guided_setup.device_unavailable")}
                                    disabled={isAutoSpeaker || isDevicePending}
                                    onChange={setSelectedSpeakerDevice}
                                />
                            </div>
                        </div>
                    )}

                    {step === 5 && (
                        <div className={styles.step_body}>
                            <p className={styles.eyebrow}>{t("main_page.guided_setup.step_transcription_translation")}</p>
                            <h2>{t("main_page.guided_setup.transcription_translation_title")}</h2>
                            <p className={styles.lead}>{t("main_page.guided_setup.detail")}</p>
                            <TranscriptionTranslationStep />
                        </div>
                    )}

                    {step === 6 && (
                        <div className={styles.step_body}>
                            <p className={styles.eyebrow}>{t("main_page.guided_setup.step_vrchat")}</p>
                            <h2>{t("main_page.guided_setup.finish_title")}</h2>
                            <p className={styles.lead}>{t("main_page.guided_setup.finish_detail")}</p>
                            <div className={styles.output_group}>
                                <span className={styles.osc_status} data-ready={currentIsOscAvailable.data === true}>
                                    {currentIsOscAvailable.data === true
                                        ? t("main_page.guided_setup.osc_ready")
                                        : t("main_page.guided_setup.osc_unavailable")}
                                </span>
                                <SetupToggle
                                    id="guided-setup-send-chatbox"
                                    label={t("main_page.guided_setup.send_chatbox")}
                                    description={t("main_page.guided_setup.send_chatbox_detail")}
                                    checked={currentEnableSendMessageToVrc.data}
                                    disabled={currentEnableSendMessageToVrc.state === "pending"}
                                    onChange={toggleEnableSendMessageToVrc}
                                />
                                <SetupToggle
                                    id="guided-setup-send-received-chatbox"
                                    label={t("main_page.guided_setup.send_received_chatbox")}
                                    description={t("main_page.guided_setup.send_received_chatbox_detail")}
                                    checked={currentEnableSendReceivedMessageToVrc.data}
                                    disabled={currentEnableSendReceivedMessageToVrc.state === "pending"}
                                    onChange={toggleEnableSendReceivedMessageToVrc}
                                />
                            </div>
                            <aside className={styles.summary}>
                                <strong>{t("main_page.guided_setup.summary_title")}</strong>
                                <span>{t("main_page.guided_setup.summary_detail")}</span>
                            </aside>
                        </div>
                    )}

                    {completionError && (
                        <p className={styles.completion_error} role="alert">
                            {completionError}
                        </p>
                    )}

                    <footer className={styles.footer}>
                        <button
                            type="button"
                            className={styles.secondary_button}
                            disabled={step === 1 || isCompletingSetup}
                            onClick={() => setStep((current) => Math.max(1, current - 1))}
                        >
                            {t("main_page.guided_setup.back")}
                        </button>
                        <div className={styles.footer_actions}>
                            <button
                                type="button"
                                className={styles.secondary_button}
                                disabled={isCompletingSetup}
                                onClick={skipSetup}
                            >
                                {t("main_page.guided_setup.skip")}
                            </button>
                            {step === 6 ? (
                                <button
                                    type="button"
                                    className={styles.primary_button}
                                    disabled={isCompletingSetup}
                                    onClick={finishSetup}
                                >
                                    {t("main_page.guided_setup.finish")}
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className={styles.primary_button}
                                    disabled={isCompletingSetup}
                                    onClick={() => setStep((current) => Math.min(SETUP_STEPS.length, current + 1))}
                                >
                                    {t("main_page.guided_setup.continue")}
                                </button>
                            )}
                        </div>
                    </footer>
                </section>
            </main>
        </div>
    );
};
