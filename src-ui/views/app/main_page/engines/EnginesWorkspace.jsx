import { useEffect, useMemo } from "react";
import { useI18n } from "@useI18n";
import { useLanguageSettings } from "@logics_main";
import { useTranscription } from "@logics_configs";
import {
    useComputeMode,
    useIsOpenedConfigPage,
    useResourceUsage,
} from "@logics_common";
import {
    useStore_ExperienceRoute,
    useStore_SelectedConfigTabId,
} from "@store";
import { TopBar } from "../main_section/top_bar/TopBar";
import styles from "./EnginesWorkspace.module.scss";

const toArray = (value) => (
    Array.isArray(value) ? value : Object.values(value ?? {})
);

const deviceValue = (device) => JSON.stringify({
    device: device?.device,
    device_index: device?.device_index,
});

const findDevice = (devices, value) => devices.find((device) => (
    deviceValue(device) === value
));

const metricValue = (metric, unavailableLabel) => {
    if (metric?.available !== true || metric.percent === null || metric.percent === undefined) {
        return unavailableLabel;
    }
    return `${Math.round(Number(metric.percent))}%`;
};

const SourceRuntimeCard = ({
    accent,
    badge,
    title,
    detail,
    engineLabel,
    deviceLabel,
    computeTypeLabel,
    engine,
    device,
    computeType,
    engines,
    devices,
    pending,
    onEngineChange,
    onDeviceChange,
    onComputeTypeChange,
    flow,
    emptyLabel,
}) => {
    const deviceOptions = toArray(devices).filter((item) => item && typeof item === "object");
    const engineOptions = Array.isArray(engines) ? engines : [];
    const selectedDeviceValue = device?.device ? deviceValue(device) : "";
    const hasSelectedEngine = engine && !engineOptions.includes(engine);
    const hasSelectedDevice = selectedDeviceValue && !deviceOptions.some((item) => (
        deviceValue(item) === selectedDeviceValue
    ));
    const computeTypes = Array.isArray(device?.compute_types) ? device.compute_types : [];
    const hasSelectedComputeType = computeType && !computeTypes.includes(computeType);

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
                <label className={styles.field}>
                    <span>{engineLabel}</span>
                    <select
                        value={engine ?? ""}
                        disabled={pending || engineOptions.length === 0}
                        onChange={(event) => onEngineChange(event.target.value)}
                    >
                        {hasSelectedEngine && <option value={engine}>{engine}</option>}
                        {engineOptions.length === 0 && <option value="">{emptyLabel}</option>}
                        {engineOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                </label>
                <label className={styles.field}>
                    <span>{deviceLabel}</span>
                    <select
                        value={selectedDeviceValue}
                        disabled={pending || deviceOptions.length === 0}
                        onChange={(event) => {
                            const next = findDevice(deviceOptions, event.target.value);
                            if (next) onDeviceChange(next);
                        }}
                    >
                        {hasSelectedDevice && <option value={selectedDeviceValue}>{device?.device_name ?? device?.device}</option>}
                        {deviceOptions.length === 0 && <option value="">{emptyLabel}</option>}
                        {deviceOptions.map((item) => (
                            <option key={deviceValue(item)} value={deviceValue(item)}>
                                {item.device_name ?? item.device}
                            </option>
                        ))}
                    </select>
                </label>
                <label className={styles.field}>
                    <span>{computeTypeLabel}</span>
                    <select
                        value={computeType ?? ""}
                        disabled={pending || computeTypes.length === 0}
                        onChange={(event) => onComputeTypeChange(event.target.value)}
                    >
                        {hasSelectedComputeType && <option value={computeType}>{computeType}</option>}
                        {computeTypes.length === 0 && <option value="">{emptyLabel}</option>}
                        {computeTypes.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                </label>
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
        currentSelectedTranscriptionEngineSend,
        currentSelectedTranscriptionEngineReceive,
        setSelectedTranscriptionEngineSend,
        setSelectedTranscriptionEngineReceive,
        currentSelectedTranscriptionComputeDeviceSend,
        currentSelectedTranscriptionComputeDeviceReceive,
        setSelectedTranscriptionComputeDeviceSend,
        setSelectedTranscriptionComputeDeviceReceive,
        currentSelectedTranscriptionComputeTypeSend,
        currentSelectedTranscriptionComputeTypeReceive,
        setSelectedTranscriptionComputeTypeSend,
        setSelectedTranscriptionComputeTypeReceive,
    } = useTranscription();

    useEffect(() => {
        getSelectableTranscriptionEngineList?.();
        getSelectableTranscriptionComputeDeviceList?.();
    // The configuration hooks rebuild their command wrappers on each render;
    // requesting this static capability data once avoids a request loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const presetKey = currentSelectedPresetTabNumber.data ?? "1";
    const availableEngines = useMemo(
        () => toArray(currentSelectableTranscriptionEngineList.data).filter((item) => typeof item === "string"),
        [currentSelectableTranscriptionEngineList.data],
    );
    const computeDevices = currentSelectableTranscriptionComputeDeviceList.data ?? [];
    const sourcePending = [
        currentSelectedTranscriptionEngineSend,
        currentSelectedTranscriptionEngineReceive,
        currentSelectedTranscriptionComputeDeviceSend,
        currentSelectedTranscriptionComputeDeviceReceive,
        currentSelectedTranscriptionComputeTypeSend,
        currentSelectedTranscriptionComputeTypeReceive,
    ].some((state) => state?.state === "pending");
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
    const selectedDevice = currentSelectedTranscriptionComputeDeviceSend.data;
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
                        engine={currentSelectedTranscriptionEngineSend.data}
                        device={currentSelectedTranscriptionComputeDeviceSend.data}
                        computeType={currentSelectedTranscriptionComputeTypeSend.data}
                        engines={availableEngines}
                        devices={computeDevices}
                        pending={sourcePending}
                        onEngineChange={setSelectedTranscriptionEngineSend}
                        onDeviceChange={setSelectedTranscriptionComputeDeviceSend}
                        onComputeTypeChange={setSelectedTranscriptionComputeTypeSend}
                        flow={t("main_page.engines_workspace.outgoing_flow", { engine: currentSelectedTranscriptionEngineSend.data || emptyLabel })}
                        emptyLabel={emptyLabel}
                    />
                    <SourceRuntimeCard
                        accent="teal"
                        badge={t("main_page.engines_workspace.desktop_badge")}
                        title={t("main_page.engines_workspace.incoming_title")}
                        detail={t("main_page.engines_workspace.incoming_detail")}
                        engineLabel={t("main_page.engines_workspace.engine_label")}
                        deviceLabel={t("main_page.engines_workspace.device_label")}
                        computeTypeLabel={t("main_page.engines_workspace.compute_type_label")}
                        engine={currentSelectedTranscriptionEngineReceive.data}
                        device={currentSelectedTranscriptionComputeDeviceReceive.data}
                        computeType={currentSelectedTranscriptionComputeTypeReceive.data}
                        engines={availableEngines}
                        devices={computeDevices}
                        pending={sourcePending}
                        onEngineChange={setSelectedTranscriptionEngineReceive}
                        onDeviceChange={setSelectedTranscriptionComputeDeviceReceive}
                        onComputeTypeChange={setSelectedTranscriptionComputeTypeReceive}
                        flow={t("main_page.engines_workspace.incoming_flow", { engine: currentSelectedTranscriptionEngineReceive.data || emptyLabel })}
                        emptyLabel={emptyLabel}
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
                        <label className={styles.field}>
                            <span>{t("main_page.engines_workspace.primary_provider")}</span>
                            <select
                                value={primaryProvider}
                                disabled={translationProviders.length === 0 || currentSelectedTranslationEngines.state === "pending"}
                                onChange={(event) => updateProvider(0, event.target.value)}
                            >
                                {primaryProvider && !translationProviders.some((item) => item.id === primaryProvider) && (
                                    <option value={primaryProvider}>{primaryProvider}</option>
                                )}
                                {translationProviders.length === 0 && <option value="">{emptyLabel}</option>}
                                {translationProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.label ?? provider.id}</option>)}
                            </select>
                        </label>
                        <label className={styles.field}>
                            <span>{t("main_page.engines_workspace.secondary_provider")}</span>
                            <select
                                value={secondaryProvider}
                                disabled={translationProviders.length === 0 || currentSelectedTranslationEngines.state === "pending"}
                                onChange={(event) => updateProvider(1, event.target.value)}
                            >
                                <option value="">{t("main_page.engines_workspace.no_secondary_provider")}</option>
                                {secondaryProvider && !translationProviders.some((item) => item.id === secondaryProvider) && (
                                    <option value={secondaryProvider}>{secondaryProvider}</option>
                                )}
                                {translationProviders.filter((provider) => provider.id !== primaryProvider).map((provider) => (
                                    <option key={provider.id} value={provider.id}>{provider.label ?? provider.id}</option>
                                ))}
                            </select>
                        </label>
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
