import { useMemo, useState } from "react";
import { useI18n } from "@useI18n";
import { useLanguageSettings, useMainFunction } from "@logics_main";
import { useTranscription, useTranslation } from "@logics_configs";
import { getTranslationModelStatus, useNotificationStatus } from "@logics_common";
import { getPresetTranslationModels } from "@logics_common/translationModelCatalog.js";
import { CustomModernSelect } from "@common_components";
import {
    applyDefaultTranscriptionEngine,
    getOfflinePresetOptions,
    getSetupEngineOptions,
    getSetupTranslationProviderOptions,
} from "./transcriptionTranslationSetupUtils.js";
import styles from "./TranscriptionTranslationStep.module.scss";

const PRESET_LABEL_KEYS = {
    fast: "main_page.preset.fast",
    balanced: "main_page.preset.balanced",
    good: "main_page.preset.good",
    precise: "main_page.preset.precise",
};

const statusLabel = (t, status) => {
    switch (status.state) {
        case "preparing":
            return t("config_page.translation_models.preparing");
        case "downloading":
            return t("config_page.translation_models.downloading", {
                progress: Math.round(status.progress),
            });
        case "failed":
            return t("config_page.model_download_error.weight_type_verification");
        case "ready":
            return t("config_page.translation_models.ready");
        default:
            return t("config_page.common.model_download.required");
    }
};

const selectedProviderValue = (selection) => {
    if (Array.isArray(selection)) return selection[0] ?? "";
    return selection ?? "";
};

const mergeCurrentOption = (options, value) => {
    if (!value || options.some((option) => option.id === value)) return options;
    return [{ id: value, title: value }, ...options];
};

const AdvancedSetupDetails = ({
    showAdvanced,
    setShowAdvanced,
    advancedProps,
}) => {
    void showAdvanced;
    void setShowAdvanced;
    void advancedProps;
    return null;
};

export const TranscriptionTranslationStep = () => {
    const { t } = useI18n();
    const [showAdvanced, setShowAdvanced] = useState(false);
    const { showNotification_Error } = useNotificationStatus();
    const {
        currentSelectedPresetTabNumber,
        currentTranslationEngines,
        currentSelectedTranslationEngines,
        currentCTranslate2AutoFallback,
        setSelectedTranslationEngines,
    } = useLanguageSettings();
    const {
        currentSelectableTranscriptionEngineList,
        currentTranscriptionProfileSend,
        currentTranscriptionProfileReceive,
        setTranscriptionProfileSend,
        setTranscriptionProfileReceive,
        currentWhisperWeightTypeStatus,
        currentWhisperThaiWeightTypeStatus,
        currentVoskWeightTypeStatus,
        currentParakeetWeightTypeStatus,
        currentSenseVoiceWeightTypeStatus,
    } = useTranscription();
    const {
        currentCTranslate2WeightTypeStatus,
        pendingCTranslate2WeightTypeStatus,
        downloadCTranslate2WeightTypeStatus,
        currentSelectedCTranslate2WeightType,
        setSelectedCTranslate2WeightType,
    } = useTranslation();
    const { currentTranslationStatus } = useMainFunction();

    const presetKey = currentSelectedPresetTabNumber.data ?? "1";
    const currentProvider = selectedProviderValue(
        currentSelectedTranslationEngines.data?.[presetKey],
    );
    const engineOptions = useMemo(() => (
        getSetupEngineOptions(currentSelectableTranscriptionEngineList.data)
    ), [currentSelectableTranscriptionEngineList.data]);
    const providerOptions = useMemo(() => (
        mergeCurrentOption(
            getSetupTranslationProviderOptions(currentTranslationEngines.data),
            currentProvider,
        )
    ), [currentProvider, currentTranslationEngines.data]);
    const allModels = currentCTranslate2WeightTypeStatus.data || [];
    const presetEntries = useMemo(() => (
        getPresetTranslationModels(allModels)
    ), [allModels]);
    const offlineOptions = useMemo(() => (
        getOfflinePresetOptions(allModels, t).map((option) => {
            const model = presetEntries.find((entry) => entry.preset === option.id)?.model ?? {};
            const status = getTranslationModelStatus(model);
            return {
                ...option,
                title: t(PRESET_LABEL_KEYS[option.id]),
                subtitle: statusLabel(t, status),
                badge: status.ready ? t("config_page.translation_models.ready") : undefined,
                isDownloaded: status.ready,
            };
        })
    ), [allModels, presetEntries, t]);
    const selectedWeightType = currentSelectedCTranslate2WeightType?.data;
    const selectedPreset = presetEntries.find((entry) => entry.model?.id === selectedWeightType)?.preset ?? "";
    const selectedOfflineOption = offlineOptions.find((option) => option.id === selectedPreset)
        ?? offlineOptions[0]
        ?? null;
    const selectedOfflineModel = presetEntries.find((entry) => (
        entry.preset === selectedOfflineOption?.id
    ))?.model;
    const selectedOfflineStatus = getTranslationModelStatus(selectedOfflineModel);
    const translationActive = currentTranslationStatus?.data === true;
    const modelBusy = selectedOfflineStatus.state === "preparing" || selectedOfflineStatus.state === "downloading";
    const engineValue = currentTranscriptionProfileSend.data?.engine ?? "";
    const emptyLabel = t("main_page.engines_workspace.loading_options");
    const transcriptionModelStatuses = {
        Whisper: currentWhisperWeightTypeStatus.data ?? [],
        "Whisper Thai": currentWhisperThaiWeightTypeStatus.data ?? [],
        Vosk: currentVoskWeightTypeStatus.data ?? [],
        Parakeet: currentParakeetWeightTypeStatus.data ?? [],
        SenseVoice: currentSenseVoiceWeightTypeStatus.data ?? [],
    };

    const selectOfflinePreset = (presetId) => {
        const option = offlineOptions.find((item) => item.id === presetId);
        if (!option?.modelId) return;
        if (translationActive) {
            showNotification_Error(
                t("config_page.translation_models.model_active_translation_change"),
                { category_id: "TRANSLATION_MODEL_CHANGE_ACTIVE" },
            );
            return;
        }
        setSelectedCTranslate2WeightType(option.modelId);
    };

    const downloadSelectedModel = () => {
        if (!selectedOfflineOption?.modelId || modelBusy || selectedOfflineStatus.ready) return;
        pendingCTranslate2WeightTypeStatus(selectedOfflineOption.modelId);
        downloadCTranslate2WeightTypeStatus(selectedOfflineOption.modelId);
    };

    const advancedProps = {
        transcriptionEngine: engineValue,
        transcriptionProfileSend: currentTranscriptionProfileSend.data,
        transcriptionProfileReceive: currentTranscriptionProfileReceive.data,
        setTranscriptionProfileSend,
        setTranscriptionProfileReceive,
        transcriptionModelStatuses,
        translationProvider: currentProvider,
        setSelectedTranslationEngines,
        offlineModel: selectedWeightType,
        setSelectedCTranslate2WeightType,
        translationActive,
        ctranslate2Fallback: currentCTranslate2AutoFallback.data,
    };

    return (
        <div className={styles.container}>
            <div className={styles.field_grid}>
                <div className={styles.field}>
                    <CustomModernSelect
                        id="guided-setup-transcription-engine"
                        label={t("main_page.engines_workspace.engine_label")}
                        value={engineValue}
                        options={engineOptions.length > 0 ? engineOptions : [{ id: "", title: emptyLabel }]}
                        disabled={currentTranscriptionProfileSend.state === "pending" || engineOptions.length === 0}
                        placeholder={emptyLabel}
                        onChange={(engine) => applyDefaultTranscriptionEngine(
                            engine,
                            setTranscriptionProfileSend,
                            setTranscriptionProfileReceive,
                        )}
                    />
                    <span className={styles.field_description}>
                        {t("main_page.engines_workspace.outgoing_flow", { engine: engineValue || emptyLabel })}
                    </span>
                </div>

                <div className={styles.field}>
                    <CustomModernSelect
                        id="guided-setup-translation-provider"
                        label={t("main_page.engines_workspace.primary_provider")}
                        value={currentProvider}
                        options={providerOptions.length > 0 ? providerOptions : [{ id: "", title: emptyLabel }]}
                        disabled={currentSelectedTranslationEngines.state === "pending" || providerOptions.length === 0}
                        placeholder={emptyLabel}
                        onChange={setSelectedTranslationEngines}
                    />
                    <span className={styles.field_description}>
                        {t("main_page.engines_workspace.translation_detail")}
                    </span>
                </div>

                <div className={`${styles.field} ${styles.offline_field}`}>
                    <CustomModernSelect
                        id="guided-setup-offline-model"
                        label={t("main_page.translation_models.title")}
                        value={selectedOfflineOption?.id ?? ""}
                        options={offlineOptions.length > 0 ? offlineOptions : [{ id: "", title: emptyLabel }]}
                        disabled={currentSelectedCTranslate2WeightType?.state === "pending" || offlineOptions.length === 0}
                        placeholder={emptyLabel}
                        onChange={selectOfflinePreset}
                    />
                    <span className={styles.field_description}>
                        {t("main_page.translation_models.detail")} {t("main_page.engines_workspace.fallback_label")}
                        {currentCTranslate2AutoFallback.data === true ? " ✓" : ""}
                    </span>
                    <div className={styles.model_status} data-status={selectedOfflineStatus.state}>
                        <span>{statusLabel(t, selectedOfflineStatus)}</span>
                        {!selectedOfflineStatus.ready && (
                            <button
                                type="button"
                                className={styles.inline_button}
                                disabled={modelBusy || !selectedOfflineOption?.modelId}
                                onClick={downloadSelectedModel}
                            >
                                {selectedOfflineStatus.failed
                                    ? t("config_page.translation_models.retry")
                                    : t("config_page.translation_models.download_model")}
                            </button>
                        )}
                    </div>
                    {translationActive && (
                        <p className={styles.notice} role="status">
                            {t("config_page.translation_models.model_active_translation_change")}
                        </p>
                    )}
                </div>
            </div>

            <button
                type="button"
                className={styles.advanced_toggle}
                aria-expanded={showAdvanced}
                onClick={() => setShowAdvanced((current) => !current)}
            >
                {t("main_page.engines_workspace.open_advanced")}
            </button>
            <AdvancedSetupDetails
                showAdvanced={showAdvanced}
                setShowAdvanced={setShowAdvanced}
                advancedProps={advancedProps}
            />
        </div>
    );
};
