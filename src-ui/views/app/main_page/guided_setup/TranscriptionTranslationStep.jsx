import { useMemo, useState } from "react";
import { useI18n } from "@useI18n";
import { useLanguageSettings, useMainFunction } from "@logics_main";
import { useTranscription, useTranslation } from "@logics_configs";
import { getTranslationModelStatus, useNotificationStatus } from "@logics_common";
import { getPresetTranslationModels } from "@logics_common/translationModelCatalog.js";
import { CustomModernSelect } from "@common_components";
import {
    applyDefaultTranscriptionEngine,
    getActiveProfileModelOptions,
    getAdvancedOfflineModelOptions,
    getOfflinePresetOptions,
    getSetupEngineOptions,
    getSetupTranslationSelection,
    getSetupTranslationProviderOptions,
    isWhisperTinyProfile,
    normalizeSetupTranslationSelection,
} from "./transcriptionTranslationSetupUtils.js";
import {
    getActiveModel,
    getProfileControlVisibility,
} from "../engines/transcriptionProfileUi.js";
import { WHISPER_CLOUD_MODELS } from "../engines/engineModelUtils.js";
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
    advancedProps,
}) => {
    const { t } = useI18n();
    const [parallelEnabled, setParallelEnabled] = useState(
        normalizeSetupTranslationSelection(advancedProps.translationSelection).length > 1,
    );
    if (!showAdvanced) return null;

    const {
        engineOptions,
        emptyLabel,
        transcriptionProfileSend,
        transcriptionProfileReceive,
        setTranscriptionProfileSend,
        setTranscriptionProfileReceive,
        transcriptionModelStatuses,
        transcriptionPendingSend,
        transcriptionPendingReceive,
        providerOptions,
        translationSelection,
        translationProvidersPending,
        setSelectedTranslationEngines,
        ctranslate2Fallback,
        ctranslate2FallbackPending,
        setCTranslate2AutoFallback,
        advancedOfflineOptions,
        offlineModel,
        offlineModelPending,
        selectAdvancedOfflineModel,
    } = advancedProps;
    const selectedProviders = normalizeSetupTranslationSelection(translationSelection);
    const primaryProvider = selectedProviders[0] ?? "";
    const secondaryProvider = selectedProviders[1] ?? "";
    const secondaryOptions = [
        { id: "", title: t("main_page.engines_workspace.no_secondary_provider") },
        ...providerOptions.filter((option) => option.id !== primaryProvider),
    ];
    const updateProvider = (index, providerId) => {
        setSelectedTranslationEngines(
            getSetupTranslationSelection(selectedProviders, index, providerId),
        );
    };
    const toggleParallel = (event) => {
        const enabled = event.target.checked;
        setParallelEnabled(enabled);
        if (!enabled && selectedProviders.length > 1) {
            setSelectedTranslationEngines(primaryProvider);
        }
    };

    const ProfileControls = ({
        engineId,
        modelId,
        title,
        detail,
        profile,
        pending,
        onProfileChange,
    }) => {
        const engine = profile?.engine ?? "";
        const visibility = getProfileControlVisibility(engine);
        const activeModel = getActiveModel(profile);
        const modelOptions = getActiveProfileModelOptions(profile, transcriptionModelStatuses);
        return (
            <section className={styles.advanced_card}>
                <div className={styles.advanced_card_header}>
                    <div>
                        <p className={styles.advanced_summary}>{title}</p>
                        <p>{detail}</p>
                    </div>
                </div>
                <div className={styles.advanced_grid}>
                    <CustomModernSelect
                        id={engineId}
                        label={t("main_page.engines_workspace.engine_label")}
                        value={engine}
                        options={engineOptions.length > 0 ? engineOptions : [{ id: "", title: emptyLabel }]}
                        disabled={pending || engineOptions.length === 0}
                        placeholder={emptyLabel}
                        onChange={(value) => onProfileChange({ engine: value })}
                    />
                    {visibility.model && (
                        <CustomModernSelect
                            id={modelId}
                            label={t("main_page.engines_workspace.model_label")}
                            value={activeModel}
                            options={modelOptions.length > 0 ? modelOptions : [{ id: activeModel, title: activeModel || emptyLabel }]}
                            disabled={pending || modelOptions.length === 0}
                            placeholder={emptyLabel}
                            onChange={(value) => onProfileChange({ models: { [engine]: value } })}
                        />
                    )}
                </div>
                {isWhisperTinyProfile(profile) && (
                    <p className={styles.warning_notice} role="status">
                        {t("main_page.engines_workspace.whisper_tiny_warning")}
                    </p>
                )}
            </section>
        );
    };

    return (
        <section className={styles.advanced_panel}>
            <ProfileControls
                engineId="guided-setup-advanced-outgoing-engine"
                modelId="guided-setup-advanced-outgoing-model"
                title={t("main_page.engines_workspace.outgoing_title")}
                detail={t("main_page.engines_workspace.outgoing_detail")}
                profile={transcriptionProfileSend}
                pending={transcriptionPendingSend}
                onProfileChange={setTranscriptionProfileSend}
            />
            <ProfileControls
                engineId="guided-setup-advanced-incoming-engine"
                modelId="guided-setup-advanced-incoming-model"
                title={t("main_page.engines_workspace.incoming_title")}
                detail={t("main_page.engines_workspace.incoming_detail")}
                profile={transcriptionProfileReceive}
                pending={transcriptionPendingReceive}
                onProfileChange={setTranscriptionProfileReceive}
            />

            <section className={styles.advanced_card}>
                <p className={styles.advanced_summary}>{t("main_page.engines_workspace.translation_title")}</p>
                <div className={styles.advanced_grid}>
                    <CustomModernSelect
                        id="guided-setup-advanced-primary-provider"
                        label={t("main_page.engines_workspace.primary_provider")}
                        value={primaryProvider}
                        options={providerOptions.length > 0 ? providerOptions : [{ id: "", title: emptyLabel }]}
                        disabled={translationProvidersPending || providerOptions.length === 0}
                        placeholder={emptyLabel}
                        onChange={(value) => updateProvider(0, value)}
                    />
                    <label className={styles.switch_label}>
                        <span>{t("main_page.engines_workspace.use_parallel_service")}</span>
                        <input
                            type="checkbox"
                            checked={parallelEnabled}
                            disabled={translationProvidersPending || providerOptions.length < 2}
                            onChange={toggleParallel}
                        />
                        <span className={styles.switch_control} aria-hidden="true" />
                    </label>
                    {parallelEnabled && (
                        <CustomModernSelect
                            id="guided-setup-advanced-secondary-provider"
                            label={t("main_page.engines_workspace.secondary_provider")}
                            value={secondaryProvider}
                            options={secondaryOptions}
                            disabled={translationProvidersPending || providerOptions.length === 0}
                            placeholder={t("main_page.engines_workspace.no_secondary_provider")}
                            onChange={(value) => updateProvider(1, value)}
                        />
                    )}
                    <label className={styles.switch_label}>
                        <span>{t("main_page.engines_workspace.fallback_label")}</span>
                        <input
                            type="checkbox"
                            checked={ctranslate2Fallback === true}
                            disabled={ctranslate2FallbackPending}
                            onChange={(event) => setCTranslate2AutoFallback(event.target.checked)}
                        />
                        <span className={styles.switch_control} aria-hidden="true" />
                    </label>
                    <CustomModernSelect
                        id="guided-setup-advanced-offline-model"
                        label={t("main_page.translation_models.advanced_models")}
                        value={offlineModel ?? ""}
                        options={advancedOfflineOptions.length > 0 ? advancedOfflineOptions : [{ id: "", title: emptyLabel }]}
                        disabled={offlineModelPending || advancedOfflineOptions.length === 0}
                        placeholder={emptyLabel}
                        onChange={selectAdvancedOfflineModel}
                    />
                </div>
            </section>
        </section>
    );
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
        setCTranslate2AutoFallback,
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
    const translationSelection = currentSelectedTranslationEngines.data?.[presetKey] ?? "";
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
    const advancedOfflineOptions = useMemo(() => (
        getAdvancedOfflineModelOptions(allModels).map((model) => ({
            ...model,
            subtitle: model.id,
        }))
    ), [allModels]);
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
        "Whisper Cloud": WHISPER_CLOUD_MODELS.map((id) => ({
            id,
            label: id,
            is_downloaded: true,
            downloadable: false,
        })),
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

    const selectAdvancedOfflineModel = (modelId) => {
        if (!modelId) return;
        if (translationActive) {
            showNotification_Error(
                t("config_page.translation_models.model_active_translation_change"),
                { category_id: "TRANSLATION_MODEL_CHANGE_ACTIVE" },
            );
            return;
        }
        setSelectedCTranslate2WeightType(modelId);
    };

    const downloadSelectedModel = () => {
        if (!selectedOfflineOption?.modelId || modelBusy || selectedOfflineStatus.ready) return;
        pendingCTranslate2WeightTypeStatus(selectedOfflineOption.modelId);
        downloadCTranslate2WeightTypeStatus(selectedOfflineOption.modelId);
    };

    const advancedProps = {
        engineOptions,
        emptyLabel,
        transcriptionProfileSend: currentTranscriptionProfileSend.data,
        transcriptionProfileReceive: currentTranscriptionProfileReceive.data,
        setTranscriptionProfileSend,
        setTranscriptionProfileReceive,
        transcriptionModelStatuses,
        transcriptionPendingSend: currentTranscriptionProfileSend.state === "pending",
        transcriptionPendingReceive: currentTranscriptionProfileReceive.state === "pending",
        translationSelection,
        providerOptions,
        translationProvidersPending: currentSelectedTranslationEngines.state === "pending",
        setSelectedTranslationEngines,
        advancedOfflineOptions,
        offlineModel: selectedWeightType,
        offlineModelPending: currentSelectedCTranslate2WeightType?.state === "pending",
        selectAdvancedOfflineModel,
        ctranslate2Fallback: currentCTranslate2AutoFallback.data,
        ctranslate2FallbackPending: currentCTranslate2AutoFallback.state === "pending",
        setCTranslate2AutoFallback,
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
            {showAdvanced && (
                <AdvancedSetupDetails
                    showAdvanced={showAdvanced}
                    advancedProps={advancedProps}
                />
            )}
        </div>
    );
};
