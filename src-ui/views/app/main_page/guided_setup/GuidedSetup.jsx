import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import {
    beginProductTour,
    endOnboarding,
} from "@logics_common/onboardingTourState.js";
import { TopBar } from "../main_section/top_bar/TopBar";
import { LanguageFlag } from "../sidebar_section/language_settings/LanguageFlag.jsx";
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
    const { t } = useI18n();
    const selectedValue = languageOptionValue(selectedLanguage);
    const isDisabled = !Array.isArray(languages) || languages.length === 0;
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState("");
    const triggerRef = useRef(null);
    const searchInputRef = useRef(null);
    const dialogId = `${id}-dialog`;
    const searchId = `${id}-search`;

    const sortedLanguages = useMemo(() => (
        (Array.isArray(languages) ? languages : [])
            .filter((language) => language?.language && language?.country)
            .slice()
            .sort((first, second) => {
                const languageOrder = first.language.localeCompare(
                    second.language,
                    undefined,
                    { sensitivity: "base" },
                );
                return languageOrder || first.country.localeCompare(
                    second.country,
                    undefined,
                    { sensitivity: "base" },
                );
            })
    ), [languages]);

    const filteredLanguages = useMemo(() => {
        const normalizedQuery = query.trim().toLocaleLowerCase();
        if (!normalizedQuery) return sortedLanguages;
        return sortedLanguages.filter((language) => (
            `${language.language} ${language.country}`
                .toLocaleLowerCase()
                .includes(normalizedQuery)
        ));
    }, [query, sortedLanguages]);

    useEffect(() => {
        if (!isOpen) return undefined;

        setQuery("");
        const focusFrame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
        const handleKeyDown = (event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setIsOpen(false);
            triggerRef.current?.focus();
        };
        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.cancelAnimationFrame(focusFrame);
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [isOpen]);

    const closePicker = () => {
        setIsOpen(false);
        triggerRef.current?.focus();
    };

    const chooseLanguage = (language) => {
        onChange(language);
        closePicker();
    };

    const normalizedQuery = query.trim().toLocaleLowerCase();
    const showEmptyOption = (optional || selectedValue === "") && (
        normalizedQuery === "" || emptyLabel.toLocaleLowerCase().includes(normalizedQuery)
    );

    const picker = isOpen && typeof document !== "undefined" ? createPortal(
        <div
            className={styles.language_picker_backdrop}
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) closePicker();
            }}
        >
            <section
                id={dialogId}
                className={styles.language_picker_dialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby={`${dialogId}-title`}
            >
                <div className={styles.language_picker_header}>
                    <div className={styles.language_picker_title_copy}>
                        <h2 id={`${dialogId}-title`} className={styles.language_picker_title}>{label}</h2>
                        <p className={styles.language_picker_subtitle}>
                            {t("main_page.language_selector.picker_detail")}
                        </p>
                    </div>
                    <button
                        type="button"
                        className={styles.language_picker_close}
                        onClick={closePicker}
                        aria-label={t("main_page.language_selector.close")}
                    >
                        ×
                    </button>
                </div>
                <div className={styles.language_picker_toolbar}>
                    <label className={styles.language_picker_search} htmlFor={searchId}>
                        <svg className={styles.language_picker_search_icon} viewBox="0 0 24 24" aria-hidden="true">
                            <path d="m21 20-4.7-4.7a7.5 7.5 0 1 0-1 1L20 21l1-1ZM5.5 10.5a5 5 0 1 1 10 0 5 5 0 0 1-10 0Z" />
                        </svg>
                        <input
                            id={searchId}
                            ref={searchInputRef}
                            type="search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={t("main_page.language_selector.search_placeholder")}
                            aria-label={t("main_page.language_selector.search_label")}
                        />
                    </label>
                </div>
                <div className={styles.language_picker_list} role="listbox" aria-label={label}>
                    {showEmptyOption && (
                        <button
                            type="button"
                            className={styles.language_picker_option}
                            data-selected={selectedValue === ""}
                            role="option"
                            aria-selected={selectedValue === ""}
                            onClick={() => chooseLanguage(null)}
                        >
                            <span className={styles.language_picker_empty_icon} aria-hidden="true">—</span>
                            <span className={styles.language_picker_option_copy}>
                                <strong>{emptyLabel}</strong>
                            </span>
                            {selectedValue === "" && (
                                <span className={styles.language_picker_check} aria-hidden="true">✓</span>
                            )}
                        </button>
                    )}
                    {filteredLanguages.map((language) => {
                        const value = languageOptionValue(language);
                        const isSelected = value === selectedValue;
                        return (
                            <button
                                key={value}
                                type="button"
                                className={styles.language_picker_option}
                                data-selected={isSelected}
                                role="option"
                                aria-selected={isSelected}
                                onClick={() => chooseLanguage(language)}
                            >
                                <LanguageFlag country={language.country} className={styles.language_picker_flag} />
                                <span className={styles.language_picker_option_copy}>
                                    <strong>{language.language}</strong>
                                    <span>{language.country}</span>
                                </span>
                                {isSelected && (
                                    <span className={styles.language_picker_check} aria-hidden="true">✓</span>
                                )}
                            </button>
                        );
                    })}
                    {filteredLanguages.length === 0 && !showEmptyOption && (
                        <div className={styles.language_picker_empty_result} role="status">
                            <strong>{t("main_page.language_selector.no_results_title")}</strong>
                            <span>
                                {t("main_page.language_selector.no_results_detail", { query: query.trim() })}
                            </span>
                        </div>
                    )}
                </div>
            </section>
        </div>,
        document.body,
    ) : null;

    return (
        <div className={styles.field}>
            <label className={styles.field_label} htmlFor={`${id}-trigger`}>{label}</label>
            <button
                id={`${id}-trigger`}
                ref={triggerRef}
                type="button"
                className={styles.language_picker_trigger}
                onClick={() => setIsOpen(true)}
                disabled={isDisabled}
                aria-haspopup="dialog"
                aria-expanded={isOpen}
                aria-controls={dialogId}
                aria-label={label}
            >
                <span className={styles.language_picker_trigger_content}>
                    {selectedLanguage ? (
                        <>
                            <LanguageFlag country={selectedLanguage.country} className={styles.language_picker_flag} />
                            <span className={styles.language_picker_option_copy}>
                                <strong>{selectedLanguage.language}</strong>
                                <span>{selectedLanguage.country}</span>
                            </span>
                        </>
                    ) : (
                        <span className={styles.language_picker_placeholder}>{emptyLabel}</span>
                    )}
                </span>
                <span className={styles.language_picker_chevron} aria-hidden="true">⌄</span>
            </button>
            {description && <span id={`${id}-description`} className={styles.field_description}>{description}</span>}
            {picker}
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
    const [screen, setScreen] = useState("intro");
    const [step, setStep] = useState(1);
    const [stepDirection, setStepDirection] = useState("forward");
    const [completionIntent, setCompletionIntent] = useState(null);
    const [completionError, setCompletionError] = useState("");
    const [isSkipConfirmationOpen, setIsSkipConfirmationOpen] = useState(false);
    const skipCancelButtonRef = useRef(null);
    const completionRequestRef = useRef(false);
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
            completionRequestRef.current = false;
            endOnboarding();
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
            completionRequestRef.current = false;
            setCompletionIntent(null);
            setCompletionError(t("main_page.guided_setup.setup_completion_error"));
        }, SETUP_COMPLETION_TIMEOUT_MS);

        return () => window.clearTimeout(timeoutId);
    }, [completionIntent, t]);

    useEffect(() => {
        if (!isSkipConfirmationOpen) return undefined;

        const previouslyFocused = document.activeElement;
        skipCancelButtonRef.current?.focus();
        const handleDocumentKeyDown = (event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setIsSkipConfirmationOpen(false);
        };
        document.addEventListener("keydown", handleDocumentKeyDown);

        return () => {
            document.removeEventListener("keydown", handleDocumentKeyDown);
            previouslyFocused?.focus?.();
        };
    }, [isSkipConfirmationOpen]);

    const completeSetup = async ({ showSuccessNotification = false } = {}) => {
        if (completionRequestRef.current) return;
        completionRequestRef.current = true;

        setCompletionError("");
        setCompletionIntent({ showSuccessNotification });
        const transportResult = await asyncStdoutToPython("/set/data/setup_completed", true);

        if (!transportResult.ok) {
            completionRequestRef.current = false;
            setCompletionIntent(null);
            setCompletionError(t("main_page.guided_setup.setup_completion_error"));
            showNotification_Error(
                t("blocking_operation.backend_unavailable"),
                { category_id: "guided_setup_completion_failed" },
            );
        }
    };
    const skipSetup = () => completeSetup();
    const startProductTour = () => {
        beginProductTour();
        setIsOpenedConfigPage(false);
        updateExperienceRoute("live");
    };
    const moveToStep = (nextStep) => {
        const boundedStep = Math.max(1, Math.min(SETUP_STEPS.length, nextStep));
        if (boundedStep === step) return;
        setStepDirection(boundedStep > step ? "forward" : "backward");
        setStep(boundedStep);
    };
    const requestSkipSetup = () => {
        if (isCompletingSetup) return;
        setIsSkipConfirmationOpen(true);
    };
    const cancelSkipSetup = () => setIsSkipConfirmationOpen(false);
    const confirmSkipSetup = () => {
        setIsSkipConfirmationOpen(false);
        skipSetup();
    };

    return (
        <div className={styles.container}>
            <TopBar />
            <main className={styles.content} aria-labelledby="guided-setup-title">
                {screen === "intro" ? (
                    <section className={styles.landing_card}>
                        <div className={styles.landing_copy}>
                            <p className={styles.eyebrow}>{t("main_page.guided_setup.eyebrow")}</p>
                            <h1 id="guided-setup-title">{t("main_page.guided_setup.title")}</h1>
                            <p>{t("main_page.guided_setup.detail")}</p>
                        </div>
                        <div className={styles.landing_actions}>
                            <button
                                type="button"
                                className={styles.secondary_button}
                                disabled={isCompletingSetup}
                                onClick={requestSkipSetup}
                            >
                                {t("main_page.guided_setup.skip")}
                            </button>
                            <button
                                type="button"
                                className={styles.primary_button}
                                disabled={isCompletingSetup}
                                onClick={() => setScreen("setup")}
                            >
                                {t("main_page.guided_setup.continue")}
                            </button>
                        </div>
                        {completionError && (
                            <p className={styles.landing_error} role="alert">{completionError}</p>
                        )}
                    </section>
                ) : (
                <>
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
                    <div
                        key={step}
                        className={styles.step_transition}
                        data-direction={stepDirection}
                    >
                    {step === 1 && (
                        <div className={styles.step_body}>
                            <p className={styles.eyebrow}>{t("main_page.guided_setup.step_app_language")}</p>
                            <h2>{t("main_page.guided_setup.app_language_title")}</h2>
                            <p className={styles.lead}>{t("main_page.guided_setup.app_language_detail")}</p>
                            <div className={styles.app_language_picker}>
                                <span id="guided-setup-app-language-label" className={styles.field_label}>
                                    {t("main_page.guided_setup.app_language")}
                                </span>
                                <div
                                    className={styles.app_language_grid}
                                    role="radiogroup"
                                    aria-labelledby="guided-setup-app-language-label"
                                >
                                    {ui_configs.selectable_ui_languages.map((option) => {
                                        const isSelected = currentUiLanguage.data === option.id;
                                        return (
                                            <button
                                                key={option.id}
                                                type="button"
                                                className={styles.app_language_option}
                                                role="radio"
                                                aria-checked={isSelected}
                                                aria-label={option.label}
                                                data-selected={isSelected}
                                                disabled={currentUiLanguage.state === "pending"}
                                                onClick={() => setUiLanguage(option.id)}
                                            >
                                                <span className={styles.app_language_flag} aria-hidden="true">
                                                    <span className={`fi fi-${option.flag}`} />
                                                </span>
                                                <span className={styles.app_language_name}>{option.label}</span>
                                                {isSelected && (
                                                    <span className={styles.app_language_check} aria-hidden="true">
                                                        ✓
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
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
                    </div>

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
                            onClick={() => moveToStep(step - 1)}
                        >
                            {t("main_page.guided_setup.back")}
                        </button>
                        <div className={styles.footer_actions}>
                            <button
                                type="button"
                                className={styles.secondary_button}
                                disabled={isCompletingSetup}
                                onClick={requestSkipSetup}
                            >
                                {t("main_page.guided_setup.skip")}
                            </button>
                            {step === 6 ? (
                                <button
                                    type="button"
                                    className={styles.primary_button}
                                    onClick={startProductTour}
                                >
                                    {t("main_page.guided_setup.continue")}
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className={styles.primary_button}
                                    disabled={isCompletingSetup}
                                    onClick={() => moveToStep(step + 1)}
                                >
                                    {t("main_page.guided_setup.continue")}
                                </button>
                            )}
                        </div>
                    </footer>
                </section>
                </>
                )}
            </main>
            {isSkipConfirmationOpen && (
                <div
                    className={styles.skip_backdrop}
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) cancelSkipSetup();
                    }}
                >
                    <section
                        className={styles.skip_dialog}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="guided-setup-skip-title"
                        aria-describedby="guided-setup-skip-detail"
                    >
                        <p className={styles.skip_dialog_eyebrow}>
                            {t("main_page.guided_setup.skip_confirmation_eyebrow")}
                        </p>
                        <h2 className={styles.skip_dialog_title} id="guided-setup-skip-title">
                            {t("main_page.guided_setup.skip_confirmation_title")}
                        </h2>
                        <p className={styles.skip_dialog_detail} id="guided-setup-skip-detail">
                            {t("main_page.guided_setup.skip_confirmation_detail")}
                        </p>
                        <div className={styles.skip_dialog_actions}>
                            <button
                                ref={skipCancelButtonRef}
                                type="button"
                                className={styles.secondary_button}
                                onClick={cancelSkipSetup}
                            >
                                {t("main_page.guided_setup.skip_confirmation_cancel")}
                            </button>
                            <button
                                type="button"
                                className={styles.primary_button}
                                onClick={confirmSkipSetup}
                            >
                                {t("main_page.guided_setup.skip_confirmation_confirm")}
                            </button>
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
};
