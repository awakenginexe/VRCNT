import { useRef, useEffect, useMemo } from "react";
import { useI18n } from "@useI18n";
import { useLanguageSettings } from "@logics_main";
import { useTranscription, useTranslation } from "@logics_configs";
import {
    useComputeMode,
    useIsBackendReady,
    useIsOpenedConfigPage,
    useResourceUsage,
} from "@logics_common";
import { CustomModernSelect } from "@common_components";
import {
    useStore_ExperienceRoute,
    useStore_SelectedConfigTabId,
} from "@store";
import { TopBar } from "../main_section/top_bar/TopBar";
import {
    filterDeviceMapByEngine,
    getAllowedTranscriptionComputeTypes,
} from "../sidebar_section/language_settings/transcriptionRuntimeUtils.js";
import {
    getActiveModel,
    getActiveModelAvailability,
    getProfileControlVisibility,
} from "./transcriptionProfileUi.js";
import { WHISPER_CLOUD_MODELS } from "./engineModelUtils.js";
import styles from "./EnginesWorkspace.module.scss";

const toArray = (value) => (
    Array.isArray(value) ? value : Object.values(value ?? {})
);

const deviceValue = (device) => JSON.stringify({
    device: device?.device,
    device_index: device?.device_index,
});

const findDevice = (devices, value) => {
    if (!value) return null;
    return devices.find((item) => deviceValue(item) === value) ?? null;
};

const metricValue = (metric, unavailableLabel) => {
    if (metric?.available !== true || metric.percent === null || metric.percent === undefined) {
        return unavailableLabel;
    }
    return `${Math.round(Number(metric.percent))}%`;
};

export const SourceRuntimeCard = ({
    accent,
    badge,
    title,
    detail,
    engineLabel,
    deviceLabel,
    computeTypeLabel,
    profile,
    engines,
    devices,
    modelStatuses,
    pending,
    onProfileChange,
    onManageModels,
    flow,
    emptyLabel,
    labels,
    cloudConfigured,
    onOpenAdvanced,
    engineLabelFor,
}) => {
    const engine = profile?.engine ?? "";
    const visibility = getProfileControlVisibility(engine);
    const filteredDevices = filterDeviceMapByEngine(devices ?? {}, engine);
    const deviceOptions = toArray(filteredDevices).filter((item) => item && typeof item === "object");
    const engineOptionsList = Array.isArray(engines) ? engines : [];
    const selectedDeviceValue = profile?.device?.device ? deviceValue(profile.device) : "";
    const selectedDevice = findDevice(deviceOptions, selectedDeviceValue) ?? profile?.device;
    const computeTypes = getAllowedTranscriptionComputeTypes({
        engine,
        device: selectedDevice,
    });
    const activeModel = getActiveModel(profile);
    const activeStatuses = modelStatuses?.[engine] ?? [];
    const modelOptions = activeStatuses
        .filter((item) => item?.is_downloaded === true || item?.id === activeModel)
        .map((item) => ({ id: item.id, title: item.label ?? item.id }));
    const availability = profile?.engine === "Whisper Cloud" && !cloudConfigured
        ? "auth_required"
        : getActiveModelAvailability(profile, modelStatuses);

    const parsedEngineOptions = useMemo(() => {
        if (engineOptionsList.length === 0) return [{ id: "", title: emptyLabel }];
        return engineOptionsList.map((e) => ({ id: e, title: engineLabelFor(e) }));
    }, [emptyLabel, engineLabelFor, engineOptionsList]);

    const parsedDeviceOptions = useMemo(() => {
        if (deviceOptions.length === 0) return [{ id: "", title: emptyLabel }];
        return deviceOptions.map((item) => ({
            id: deviceValue(item),
            title: item.device_name ?? item.device,
        }));
    }, [deviceOptions, emptyLabel]);

    const parsedComputeTypeOptions = useMemo(() => {
        if (computeTypes.length === 0) return [{ id: "", title: emptyLabel }];
        return computeTypes.map((item) => ({ id: item, title: item }));
    }, [computeTypes, emptyLabel]);

    return (
        <article className={styles.source_card} data-accent={accent}>
            <header className={styles.card_header}>
                <div>
                    <p className={styles.card_title}>{title}</p>
                    <p className={styles.card_detail}>{detail}</p>
                </div>
                <span className={styles.source_badge}>{badge}</span>
            </header>

            <div className={styles.form_grid}>
                <div className={styles.field}>
                    <CustomModernSelect
                        label={engineLabel}
                        value={engine ?? ""}
                        options={parsedEngineOptions}
                        disabled={pending || engineOptionsList.length === 0}
                        placeholder={emptyLabel}
                        onChange={(value) => {
                            if (value === "Whisper Cloud" && !cloudConfigured) {
                                onOpenAdvanced();
                                return;
                            }
                            onProfileChange({ engine: value });
                        }}
                    />
                </div>
                {visibility.model && <div className={styles.field}>
                    <CustomModernSelect
                        label={labels.model}
                        value={activeModel}
                        options={modelOptions.length > 0 ? modelOptions : [{ id: activeModel, title: activeModel || emptyLabel }]}
                        disabled={pending || modelOptions.length === 0 || (engine === "Whisper Cloud" && !cloudConfigured)}
                        placeholder={emptyLabel}
                        onChange={(value) => {
                            if (engine === "Whisper Cloud" && !cloudConfigured) {
                                onOpenAdvanced();
                                return;
                            }
                            onProfileChange({ models: { [engine]: value } });
                        }}
                    />
                </div>}
                {visibility.device && <div className={styles.field}>
                    <CustomModernSelect
                        label={deviceLabel}
                        value={selectedDeviceValue}
                        options={parsedDeviceOptions}
                        disabled={pending || deviceOptions.length === 0}
                        placeholder={emptyLabel}
                        onChange={(val) => {
                            const next = findDevice(deviceOptions, val);
                            if (next) onProfileChange({ device: next });
                        }}
                    />
                </div>}
                {visibility.computeType && <div className={styles.field}>
                    <CustomModernSelect
                        label={computeTypeLabel}
                        value={profile?.compute_type ?? ""}
                        options={parsedComputeTypeOptions}
                        disabled={pending || computeTypes.length === 0}
                        placeholder={emptyLabel}
                        onChange={(value) => onProfileChange({ compute_type: value })}
                    />
                </div>}
                {visibility.whisperDecoding && <div className={styles.field}>
                    <CustomModernSelect
                        label={labels.decoding}
                        value={profile?.whisper_decoding_profile ?? "balanced"}
                        options={[
                            { id: "fast", title: labels.fast },
                            { id: "balanced", title: labels.balanced },
                            { id: "accurate", title: labels.accurate },
                        ]}
                        disabled={pending}
                        onChange={(value) => onProfileChange({ whisper_decoding_profile: value })}
                    />
                </div>}
            </div>
            <div className={styles.model_status_row}>
                <span data-status={availability}>{labels.availability[availability] ?? availability}</span>
                {visibility.model && (
                    <button type="button" onClick={onManageModels}>{labels.manageModels}</button>
                )}
            </div>
            <p className={styles.pipeline_flow}>{flow}</p>
        </article>
    );
};

export const EnginesWorkspace = () => {
    const { t } = useI18n();
    const { updateExperienceRoute } = useStore_ExperienceRoute();
    const { setIsOpenedConfigPage } = useIsOpenedConfigPage();
    const { updateSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const { currentResourceUsage } = useResourceUsage();
    const { currentComputeMode } = useComputeMode();
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
    } = useTranscription();
    const { currentGroqAuthKey } = useTranslation();

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

    const presetKey = currentSelectedPresetTabNumber.data ?? "1";
    const availableEngines = useMemo(
        () => toArray(currentSelectableTranscriptionEngineList.data).filter((item) => typeof item === "string"),
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
    const translationProviders = useMemo(() => (
        toArray(currentTranslationEngines.data).filter((provider) => provider?.is_available === true)
    ), [currentTranslationEngines.data]);
    const translationSelection = currentSelectedTranslationEngines.data?.[presetKey] ?? "";
    const selectedProviders = Array.isArray(translationSelection)
        ? translationSelection
        : translationSelection ? [translationSelection] : [];
    const primaryProvider = selectedProviders[0] ?? "";
    const secondaryProvider = selectedProviders[1] ?? "";
    const resourceUsage = currentResourceUsage.data ?? {};
    const selectedDevice = currentTranscriptionProfileSend.data?.device;
    const selectedGpu = resourceUsage.gpu_devices?.find((gpu) => (
        gpu.device_index === resourceUsage.selected_gpu_index
    ));
    const deviceName = selectedDevice?.device_name
        ?? selectedGpu?.device_name
        ?? t("main_page.engines_workspace.device_not_detected");
    const emptyLabel = t("main_page.engines_workspace.loading_options");

    const updateProvider = (index, providerId) => {
        const next = [...selectedProviders];
        if (providerId) next[index] = providerId;
        else next.splice(index, 1);
        const unique = [...new Set(next.filter(Boolean))].slice(0, 2);
        setSelectedTranslationEngines(unique.length > 1 ? unique : unique[0] ?? "");
    };

    const openAdvanced = () => {
        updateSelectedConfigTabId("model_and_provider");
        setIsOpenedConfigPage(true);
    };
    const openModels = () => updateExperienceRoute("models");
    const cloudConfigured = currentUseSplitGroqApiKey.data === true
        ? Boolean(currentGroqWhisperAuthKey.data)
        : Boolean(currentGroqAuthKey.data);
    const engineLabelFor = (engine) => engine === "Whisper Cloud"
        ? t("main_page.engines_workspace.whisper_cloud_engine")
        : engine;
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

    return (
        <div className={styles.container}>
            <TopBar />
            <main className={styles.content}>
                <section className={styles.hero}>
                    <div>
                        <p className={styles.eyebrow}>{t("main_page.engines_workspace.eyebrow")}</p>
                        <h1>{t("main_page.engines_workspace.title")}</h1>
                        <p>{t("main_page.engines_workspace.detail")}</p>
                    </div>
                    <button type="button" className={styles.back_button} onClick={() => updateExperienceRoute("live")}>
                        {t("main_page.engines_workspace.back_to_live")}
                    </button>
                </section>

                <section className={styles.source_grid} aria-label={t("main_page.engines_workspace.source_paths")}>
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
                        onProfileChange={handleProfileChange(setTranscriptionProfileSend)}
                        onManageModels={openModels}
                        flow={t("main_page.engines_workspace.outgoing_flow", { engine: currentTranscriptionProfileSend.data?.engine || emptyLabel })}
                        emptyLabel={emptyLabel}
                        labels={profileLabels}
                        cloudConfigured={cloudConfigured}
                        onOpenAdvanced={openAdvanced}
                        engineLabelFor={engineLabelFor}
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
                        onProfileChange={handleProfileChange(setTranscriptionProfileReceive)}
                        onManageModels={openModels}
                        flow={t("main_page.engines_workspace.incoming_flow", { engine: currentTranscriptionProfileReceive.data?.engine || emptyLabel })}
                        emptyLabel={emptyLabel}
                        labels={profileLabels}
                        cloudConfigured={cloudConfigured}
                        onOpenAdvanced={openAdvanced}
                        engineLabelFor={engineLabelFor}
                    />
                </section>

                <section className={styles.provider_card}>
                    <div className={styles.section_heading}>
                        <div>
                            <p className={styles.section_kicker}>{t("main_page.engines_workspace.translation_kicker")}</p>
                            <h2>{t("main_page.engines_workspace.translation_title")}</h2>
                            <p>{t("main_page.engines_workspace.translation_detail")}</p>
                        </div>
                        <label className={styles.switch_label}>
                            <span>{t("main_page.engines_workspace.fallback_label")}</span>
                            <input
                                type="checkbox"
                                checked={currentCTranslate2AutoFallback.data === true}
                                disabled={currentCTranslate2AutoFallback.state === "pending"}
                                onChange={(event) => setCTranslate2AutoFallback(event.target.checked)}
                            />
                            <span className={styles.switch_control} aria-hidden="true" />
                        </label>
                    </div>
                    <div className={styles.provider_grid}>
                        <div className={styles.field}>
                            <CustomModernSelect
                                label={t("main_page.engines_workspace.primary_provider")}
                                value={primaryProvider}
                                options={translationProviders.length === 0 ? [{ id: "", title: emptyLabel }] : translationProviders.map((p) => ({ id: p.id, title: p.label ?? p.id }))}
                                disabled={translationProviders.length === 0 || currentSelectedTranslationEngines.state === "pending"}
                                placeholder={emptyLabel}
                                onChange={(val) => updateProvider(0, val)}
                            />
                        </div>
                        <div className={styles.field}>
                            <CustomModernSelect
                                label={t("main_page.engines_workspace.secondary_provider")}
                                value={secondaryProvider}
                                options={[
                                    { id: "", title: t("main_page.engines_workspace.no_secondary_provider") },
                                    ...translationProviders
                                        .filter((p) => p.id !== primaryProvider)
                                        .map((p) => ({ id: p.id, title: p.label ?? p.id })),
                                ]}
                                disabled={translationProviders.length === 0 || currentSelectedTranslationEngines.state === "pending"}
                                placeholder={t("main_page.engines_workspace.no_secondary_provider")}
                                onChange={(val) => updateProvider(1, val)}
                            />
                        </div>
                    </div>
                </section>

                <section className={styles.hardware_card} aria-label={t("main_page.engines_workspace.hardware_title")}>
                    <div>
                        <p className={styles.section_kicker}>{t("main_page.engines_workspace.hardware_kicker")}</p>
                        <h2>{t("main_page.engines_workspace.hardware_title")}</h2>
                        <p>{t("main_page.engines_workspace.hardware_detail")}</p>
                    </div>
                    <dl className={styles.hardware_metrics}>
                        <div><dt>{t("main_page.engines_workspace.active_device")}</dt><dd>{deviceName}</dd></div>
                        <div><dt>{t("main_page.engines_workspace.compute_mode")}</dt><dd>{currentComputeMode.data ?? t("main_page.engines_workspace.device_not_detected")}</dd></div>
                        <div><dt>CPU</dt><dd>{metricValue(resourceUsage.cpu, t("main_page.engines_workspace.metric_unavailable"))}</dd></div>
                        <div><dt>GPU</dt><dd>{metricValue(resourceUsage.gpu, t("main_page.engines_workspace.metric_unavailable"))}</dd></div>
                    </dl>
                    <button type="button" className={styles.advanced_button} onClick={openAdvanced}>
                        {t("main_page.engines_workspace.open_advanced")}
                    </button>
                </section>
            </main>
        </div>
    );
};
