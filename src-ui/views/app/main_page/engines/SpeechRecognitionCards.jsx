import { useEffect, useMemo, useRef } from "react";
import { useI18n } from "@useI18n";
import { useLanguageSettings } from "@logics_main";
import { useTranscription, useTranslation } from "@logics_configs";
import {
    useIsBackendReady,
    useIsOpenedConfigPage,
    useNotificationStatus,
} from "@logics_common";
import {
    useStore_ExperienceRoute,
    useStore_SelectedConfigTabId,
} from "@store";
import { WHISPER_CLOUD_MODELS } from "./engineModelUtils.js";
import { getUnsupportedBingLanguageSlots } from "@logics_common/bingLanguageSupport.js";
import { SourceRuntimeCard } from "./EnginesWorkspace.jsx";
import styles from "./EnginesWorkspace.module.scss";

const toArray = (value) => (
    Array.isArray(value) ? value : Object.values(value ?? {})
);

export const SpeechRecognitionCards = () => {
    const { t } = useI18n();
    const { updateExperienceRoute } = useStore_ExperienceRoute();
    const { setIsOpenedConfigPage } = useIsOpenedConfigPage();
    const { updateSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const {
        currentSelectableTranscriptionEngineList,
        getSelectableTranscriptionEngineList,
        currentSelectableTranscriptionComputeDeviceList,
        getSelectableTranscriptionComputeDeviceList,
        currentTranscriptionProfileSend,
        currentTranscriptionProfileReceive,
        setTranscriptionProfileSend,
        setTranscriptionProfileReceive,
        currentWhisperWeightTypeStatus,
        currentWhisperThaiWeightTypeStatus,
        currentVoskWeightTypeStatus,
        currentParakeetWeightTypeStatus,
        currentSenseVoiceWeightTypeStatus,
        currentUseSplitGroqApiKey,
        currentGroqWhisperAuthKey,
        currentMicRecordTimeout,
        setMicRecordTimeout,
        currentMicPhraseTimeout,
        setMicPhraseTimeout,
        currentMicMaxWords,
        setMicMaxWords,
        currentSpeakerRecordTimeout,
        setSpeakerRecordTimeout,
        currentSpeakerPhraseTimeout,
        setSpeakerPhraseTimeout,
        currentSpeakerMaxWords,
        setSpeakerMaxWords,
    } = useTranscription();
    const { currentGroqAuthKey } = useTranslation();
    const {
        currentSelectableLanguageList,
        getCurrentYourLanguages,
        getCurrentTargetLanguages,
    } = useLanguageSettings();
    const { showNotification_Warning } = useNotificationStatus();
    const { currentIsBackendReady } = useIsBackendReady();
    const isBackendReady = currentIsBackendReady?.data === true;
    const hasHydratedRef = useRef(false);

    useEffect(() => {
        if (!isBackendReady) return;
        const enginesEmpty = toArray(currentSelectableTranscriptionEngineList?.data).length === 0;
        const devicesEmpty = toArray(currentSelectableTranscriptionComputeDeviceList?.data).length === 0;
        if (!hasHydratedRef.current || enginesEmpty || devicesEmpty) {
            hasHydratedRef.current = true;
            getSelectableTranscriptionEngineList?.();
            getSelectableTranscriptionComputeDeviceList?.();
        }
    }, [
        isBackendReady,
        currentSelectableTranscriptionEngineList?.data,
        currentSelectableTranscriptionComputeDeviceList?.data,
        getSelectableTranscriptionEngineList,
        getSelectableTranscriptionComputeDeviceList,
    ]);

    const availableEngines = useMemo(
        () => toArray(currentSelectableTranscriptionEngineList.data)
            .filter((item) => typeof item === "string"),
        [currentSelectableTranscriptionEngineList.data],
    );
    const computeDevices = currentSelectableTranscriptionComputeDeviceList.data ?? [];
    const modelStatuses = useMemo(() => ({
        Whisper: currentWhisperWeightTypeStatus.data ?? [],
        "Whisper Thai": currentWhisperThaiWeightTypeStatus.data ?? [],
        "Whisper Cloud": WHISPER_CLOUD_MODELS.map((id) => ({
            id,
            label: id,
            is_downloaded: true,
            downloadable: false,
        })),
        Vosk: currentVoskWeightTypeStatus.data ?? [],
        Parakeet: currentParakeetWeightTypeStatus.data ?? [],
        SenseVoice: currentSenseVoiceWeightTypeStatus.data ?? [],
    }), [
        currentWhisperWeightTypeStatus.data,
        currentWhisperThaiWeightTypeStatus.data,
        currentVoskWeightTypeStatus.data,
        currentParakeetWeightTypeStatus.data,
        currentSenseVoiceWeightTypeStatus.data,
    ]);
    const cloudConfigured = currentUseSplitGroqApiKey.data === true
        ? Boolean(currentGroqWhisperAuthKey.data)
        : Boolean(currentGroqAuthKey.data);
    const emptyLabel = t("main_page.engines_workspace.loading_options");
    const engineLabelFor = (engine) => engine === "Whisper Cloud"
        ? t("main_page.engines_workspace.whisper_cloud_engine")
        : engine;
    const profileLabels = {
        model: t("main_page.engines_workspace.model_label"),
        decoding: t("main_page.engines_workspace.decoding_label"),
        fast: t("main_page.engines_workspace.decoding_fast"),
        balanced: t("main_page.engines_workspace.decoding_balanced"),
        accurate: t("main_page.engines_workspace.decoding_accurate"),
        manageModels: t("main_page.engines_workspace.manage_models"),
        availability: {
            cloud: t("main_page.engines_workspace.availability_cloud"),
            installed: t("main_page.engines_workspace.availability_installed"),
            downloading: t("main_page.engines_workspace.availability_downloading"),
            download_required: t("main_page.engines_workspace.availability_download_required"),
            unavailable: t("main_page.engines_workspace.availability_unavailable"),
            auth_required: t("main_page.engines_workspace.availability_auth_required"),
        },
    };

    const openAdvanced = () => {
        updateSelectedConfigTabId("model_and_provider");
        setIsOpenedConfigPage(true);
    };
    const handleProfileChange = (setter) => (patch) => {
        if (
            (patch?.engine === "Whisper Cloud" || patch?.models?.["Whisper Cloud"])
            && !cloudConfigured
        ) {
            openAdvanced();
            return;
        }
        setter(patch);
    };
    const timeoutOptions = useMemo(
        () => Array.from({ length: 31 }, (_, id) => ({ id, title: String(id) })),
        [],
    );
    const micMaxWordsOptions = useMemo(
        () => Array.from({ length: 31 }, (_, id) => ({ id, title: String(id) })),
        [],
    );
    const speakerMaxWordsOptions = useMemo(
        () => Array.from({ length: 61 }, (_, id) => ({ id, title: String(id) })),
        [],
    );
    const guardBingProfileChange = (patch, slots, sourceLabel) => {
        if (patch?.engine !== "Bing") return true;
        const unsupported = getUnsupportedBingLanguageSlots({
            engine: "Bing",
            slots,
            languageCatalog: currentSelectableLanguageList.data,
        });
        if (unsupported.length === 0) return true;
        showNotification_Warning(
            t("common_error.transcription_language_unsupported", {
                engine: "Bing",
                source: sourceLabel,
                languages: unsupported.map(({ language, country }) => `${language} (${country})`).join(", "),
            }),
            { category_id: "TRANSCRIPTION_LANGUAGE_UNSUPPORTED", hide_duration: 10000 },
        );
        return false;
    };
    const outgoingRuntimeSettings = [
        {
            id: "mic-record-timeout",
            label: t("config_page.transcription.mic_record_timeout.label"),
            value: currentMicRecordTimeout.data,
            options: timeoutOptions,
            onChange: setMicRecordTimeout,
        },
        {
            id: "mic-phrase-timeout",
            label: t("config_page.transcription.mic_phrase_timeout.label"),
            value: currentMicPhraseTimeout.data,
            options: timeoutOptions,
            onChange: setMicPhraseTimeout,
        },
        {
            id: "mic-max-words",
            label: t("config_page.transcription.mic_max_phrase.label"),
            value: currentMicMaxWords.data,
            options: micMaxWordsOptions,
            onChange: setMicMaxWords,
        },
    ];
    const incomingRuntimeSettings = [
        {
            id: "speaker-record-timeout",
            label: t("config_page.transcription.speaker_record_timeout.label"),
            value: currentSpeakerRecordTimeout.data,
            options: timeoutOptions,
            onChange: setSpeakerRecordTimeout,
        },
        {
            id: "speaker-phrase-timeout",
            label: t("config_page.transcription.speaker_phrase_timeout.label"),
            value: currentSpeakerPhraseTimeout.data,
            options: timeoutOptions,
            onChange: setSpeakerPhraseTimeout,
        },
        {
            id: "speaker-max-words",
            label: t("config_page.transcription.speaker_max_phrase.label"),
            value: currentSpeakerMaxWords.data,
            options: speakerMaxWordsOptions,
            onChange: setSpeakerMaxWords,
        },
    ];

    return (
        <section
            className={styles.runtime_section}
            aria-label={t("main_page.engines_workspace.source_paths")}
        >
            <div className={styles.source_grid}>
                <SourceRuntimeCard
                    accent="violet"
                    badge={t("main_page.engines_workspace.microphone_badge")}
                    title={t("main_page.engines_workspace.outgoing_title")}
                    detail={t("main_page.engines_workspace.outgoing_detail")}
                    engineLabel={t("main_page.engines_workspace.engine_label")}
                    deviceLabel={t("main_page.engines_workspace.device_label")}
                    computeTypeLabel={t("main_page.engines_workspace.compute_type_label")}
                    profile={currentTranscriptionProfileSend.data}
                    engines={availableEngines}
                    devices={computeDevices}
                    modelStatuses={modelStatuses}
                    pending={currentTranscriptionProfileSend.state === "pending"}
                    onProfileChange={(patch) => {
                        if (!guardBingProfileChange(patch, getCurrentYourLanguages(), t("main_page.transcription_send"))) return;
                        handleProfileChange(setTranscriptionProfileSend)(patch);
                    }}
                    onManageModels={() => updateExperienceRoute("models")}
                    flow={t("main_page.engines_workspace.outgoing_flow", {
                        engine: currentTranscriptionProfileSend.data?.engine || emptyLabel,
                    })}
                    emptyLabel={emptyLabel}
                    labels={profileLabels}
                    cloudConfigured={cloudConfigured}
                    onOpenAdvanced={openAdvanced}
                    engineLabelFor={engineLabelFor}
                    runtimeSettings={outgoingRuntimeSettings}
                    runtimeNote={currentTranscriptionProfileSend.data?.engine === "Bing"
                        ? t("main_page.engines_workspace.bing_runtime_note")
                        : t("main_page.engines_workspace.runtime_settings_note")}
                />
                <SourceRuntimeCard
                    accent="teal"
                    badge={t("main_page.engines_workspace.desktop_badge")}
                    title={t("main_page.engines_workspace.incoming_title")}
                    detail={t("main_page.engines_workspace.incoming_detail")}
                    engineLabel={t("main_page.engines_workspace.engine_label")}
                    deviceLabel={t("main_page.engines_workspace.device_label")}
                    computeTypeLabel={t("main_page.engines_workspace.compute_type_label")}
                    profile={currentTranscriptionProfileReceive.data}
                    engines={availableEngines}
                    devices={computeDevices}
                    modelStatuses={modelStatuses}
                    pending={currentTranscriptionProfileReceive.state === "pending"}
                    onProfileChange={(patch) => {
                        if (!guardBingProfileChange(patch, getCurrentTargetLanguages(), t("main_page.transcription_receive"))) return;
                        handleProfileChange(setTranscriptionProfileReceive)(patch);
                    }}
                    onManageModels={() => updateExperienceRoute("models")}
                    flow={t("main_page.engines_workspace.incoming_flow", {
                        engine: currentTranscriptionProfileReceive.data?.engine || emptyLabel,
                    })}
                    emptyLabel={emptyLabel}
                    labels={profileLabels}
                    cloudConfigured={cloudConfigured}
                    onOpenAdvanced={openAdvanced}
                    engineLabelFor={engineLabelFor}
                    runtimeSettings={incomingRuntimeSettings}
                    runtimeNote={currentTranscriptionProfileReceive.data?.engine === "Bing"
                        ? t("main_page.engines_workspace.bing_runtime_note")
                        : t("main_page.engines_workspace.runtime_settings_note")}
                />
            </div>
        </section>
    );
};
