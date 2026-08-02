import { useMemo } from "react";
import { useI18n } from "@useI18n";
import { useTranscription } from "@logics_configs";
import { useResourceUsage } from "@logics_common";
import { useStore_ExperienceRoute } from "@store";
import { TopBar } from "../main_section/top_bar/TopBar";
import { CustomModernSelect } from "@common_components";
import {
    findPresetCandidate,
    getPresetForModel,
    resolveWhisperRecommendation,
    WHISPER_PRESETS,
} from "../engines/engineModelUtils";
import styles from "./ModelsHub.module.scss";

const PRESET_COPY = {
    fast: {
        title: "main_page.models_hub.fast_title",
        detail: "main_page.models_hub.fast_detail",
    },
    balanced: {
        title: "main_page.models_hub.balanced_title",
        detail: "main_page.models_hub.balanced_detail",
    },
    best_accuracy: {
        title: "main_page.models_hub.accuracy_title",
        detail: "main_page.models_hub.accuracy_detail",
    },
};

const getProgress = (status) => {
    const progress = Number(status?.progress);
    return Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : null;
};

export const ModelsHub = () => {
    const { t } = useI18n();
    const { updateExperienceRoute } = useStore_ExperienceRoute();
    const { currentResourceUsage } = useResourceUsage();
    const {
        currentWhisperWeightTypeStatus,
        downloadWhisperWeightTypeStatus,
        currentSelectedWhisperWeightType,
        setSelectedWhisperWeightType,
        currentWhisperDecodingProfile,
        setWhisperDecodingProfile,
        currentSelectedTranscriptionComputeDeviceSend,
    } = useTranscription();

    const statuses = currentWhisperWeightTypeStatus.data ?? [];
    const selectedDevice = currentSelectedTranscriptionComputeDeviceSend.data ?? {};
    const recommendation = useMemo(() => resolveWhisperRecommendation({
        statuses,
        selectedDevice,
    }), [selectedDevice, statuses]);
    const selectedModelId = currentSelectedWhisperWeightType.data;
    const selectedPreset = getPresetForModel(selectedModelId);
    const selectedGpu = currentResourceUsage.data?.gpu_devices?.find((gpu) => (
        gpu.device_index === currentResourceUsage.data?.selected_gpu_index
    ));
    const hardwareName = selectedDevice.device_name
        ?? selectedGpu?.device_name
        ?? t("main_page.models_hub.hardware_not_detected");
    const controlsPending = currentSelectedWhisperWeightType.state === "pending"
        || currentWhisperDecodingProfile.state === "pending";

    const applyInstalledPreset = (preset, status) => {
        if (status?.is_downloaded !== true || controlsPending) return;
        setWhisperDecodingProfile(preset.decodingProfile);
        setSelectedWhisperWeightType(status.id);
    };

    const handlePresetAction = (preset) => {
        const candidate = findPresetCandidate({
            presetId: preset.id,
            statuses,
            installedOnly: false,
        });
        if (!candidate) return;
        if (candidate.is_downloaded === true) {
            applyInstalledPreset(preset, candidate);
            return;
        }
        if (candidate.is_pending !== true) downloadWhisperWeightTypeStatus(candidate.id);
    };

    const useRecommendation = () => {
        if (!recommendation.presetId || !recommendation.modelId) return;
        const preset = WHISPER_PRESETS.find((item) => item.id === recommendation.presetId);
        const status = statuses.find((item) => item.id === recommendation.modelId);
        if (preset && status) applyInstalledPreset(preset, status);
    };

const modelOptions = useMemo(() => {
        const options = [
            {
                id: "auto",
                title: `⚡ Automatic / Recommended (${recommendation.modelId || "Auto"})`,
                subtitle: `Optimal for ${hardwareName}`,
                badge: "Auto",
                badgeType: "teal",
                isRecommended: true,
                size: recommendation.modelId ? (statuses.find((s) => s.id === recommendation.modelId)?.capacity) : undefined,
                computeTarget: selectedDevice.device === "cuda" ? "GPU (CUDA)" : "CPU",
            },
        ];

        WHISPER_PRESETS.forEach((preset) => {
            const candidate = findPresetCandidate({ presetId: preset.id, statuses, installedOnly: false });
            if (!candidate) return;
            const copy = PRESET_COPY[preset.id];

            options.push({
                id: candidate.id,
                title: `${preset.id === "fast" ? "⚡ Fast" : preset.id === "balanced" ? "⚖️ Balanced" : "🎯 Best Accuracy"} (${candidate.id})`,
                subtitle: `${candidate.capacity || ""} · ${t(copy.title)}`,
                badge: preset.id === "fast" ? "Fast" : preset.id === "balanced" ? "Balanced" : "Accurate",
                badgeType: preset.id === "fast" ? "teal" : preset.id === "balanced" ? "gold" : "purple",
                isRecommended: recommendation.presetId === preset.id,
                isDownloaded: candidate.is_downloaded === true,
                size: candidate.capacity,
                computeTarget: "GPU / CPU",
                presetId: preset.id,
                decodingProfile: preset.decodingProfile,
            });
        });

        statuses.forEach((item) => {
            if (!options.some((opt) => opt.id === item.id)) {
                options.push({
                    id: item.id,
                    title: `Whisper ${item.id}`,
                    subtitle: item.capacity ? `Size: ${item.capacity}` : undefined,
                    isDownloaded: item.is_downloaded === true,
                    size: item.capacity,
                    computeTarget: "GPU / CPU",
                });
            }
        });

        return options;
    }, [statuses, recommendation, hardwareName, selectedDevice, t]);

    const handleModelSelectChange = (selectedId) => {
        if (selectedId === "auto") {
            useRecommendation();
            return;
        }
        const selectedOpt = modelOptions.find((opt) => opt.id === selectedId);
        if (selectedOpt && selectedOpt.decodingProfile) {
            setWhisperDecodingProfile(selectedOpt.decodingProfile);
        }
        const statusItem = statuses.find((s) => s.id === selectedId);
        if (statusItem?.is_downloaded === true) {
            setSelectedWhisperWeightType(selectedId);
        } else if (statusItem) {
            downloadWhisperWeightTypeStatus(selectedId);
        }
    };

    return (
        <div className={styles.container}>
            <TopBar />
            <main className={styles.content}>
                <section className={styles.hero}>
                    <div>
                        <p className={styles.eyebrow}>{t("main_page.models_hub.eyebrow")}</p>
                        <h1>{t("main_page.models_hub.title")}</h1>
                        <p>{t("main_page.models_hub.detail")}</p>
                    </div>
                    <button type="button" className={styles.back_button} onClick={() => updateExperienceRoute("live")}>
                        {t("main_page.models_hub.back_to_live")}
                    </button>
                </section>

                <section className={styles.recommendation}>
                    <div>
                        <p className={styles.eyebrow}>{t("main_page.models_hub.automatic_label")}</p>
                        <h2>{t("main_page.models_hub.recommendation_title")}</h2>
                        <p>{t("main_page.models_hub.hardware_summary", { hardware: hardwareName })}</p>
                        <p className={styles.recommendation_reason}>
                            {recommendation.reason === "cuda"
                                ? t("main_page.models_hub.cuda_reason")
                                : recommendation.reason === "cpu"
                                    ? t("main_page.models_hub.cpu_reason")
                                    : t("main_page.models_hub.no_installed_reason")}
                        </p>
                    </div>
                    <div style={{ width: "340px", flexShrink: 0 }}>
                        <CustomModernSelect
                            id="primary-speech-model-select"
                            label="Active Speech Recognition Model"
                            value={selectedModelId || "auto"}
                            options={modelOptions}
                            onChange={handleModelSelectChange}
                            disabled={controlsPending && statuses.length === 0}
                            variant="model"
                        />
                    </div>
                </section>

                <section className={styles.preset_grid} aria-label={t("main_page.models_hub.presets_label")}>
                    {WHISPER_PRESETS.map((preset) => {
                        const copy = PRESET_COPY[preset.id];
                        const candidate = findPresetCandidate({
                            presetId: preset.id,
                            statuses,
                            installedOnly: false,
                        });
                        const progress = getProgress(candidate);
                        const isActive = selectedPreset === preset.id
                            && selectedModelId === candidate?.id;
                        const isRecommended = recommendation.presetId === preset.id;
                        const actionLabel = candidate?.is_downloaded === true
                            ? isActive
                                ? t("main_page.models_hub.active_model")
                                : t("main_page.models_hub.select_model")
                            : candidate?.is_pending === true
                                ? t("main_page.models_hub.downloading")
                                : candidate
                                    ? t("main_page.models_hub.download_model", { size: candidate.capacity ?? "" })
                                    : t("main_page.models_hub.model_unavailable");

                        return (
                            <article
                                key={preset.id}
                                className={styles.preset_card}
                                data-active={isActive}
                                data-recommended={isRecommended}
                            >
                                <header className={styles.card_header}>
                                    <div>
                                        <h2>{t(copy.title)}</h2>
                                        <p>{t(copy.detail)}</p>
                                    </div>
                                    {isRecommended && <span className={styles.recommended_badge}>{t("main_page.models_hub.recommended")}</span>}
                                </header>
                                <dl className={styles.model_facts}>
                                    <div><dt>{t("main_page.models_hub.model_label")}</dt><dd>{candidate?.id ?? t("main_page.models_hub.model_unavailable")}</dd></div>
                                    <div><dt>{t("main_page.models_hub.download_size")}</dt><dd>{candidate?.capacity ?? t("main_page.models_hub.size_not_available")}</dd></div>
                                    <div><dt>{t("main_page.models_hub.profile_label")}</dt><dd>{preset.decodingProfile}</dd></div>
                                    <div><dt>{t("main_page.models_hub.status_label")}</dt><dd>{candidate?.is_downloaded === true ? t("main_page.models_hub.installed") : candidate?.is_pending === true ? t("main_page.models_hub.downloading") : t("main_page.models_hub.download_needed")}</dd></div>
                                </dl>
                                {progress !== null && candidate?.is_pending === true && (
                                    <div className={styles.progress} aria-label={t("main_page.models_hub.download_progress", { progress })}>
                                        <span style={{ width: `${progress}%` }} />
                                    </div>
                                )}
                                <button
                                    type="button"
                                    className={styles.preset_button}
                                    disabled={!candidate || candidate.is_pending === true || isActive || controlsPending}
                                    onClick={() => handlePresetAction(preset)}
                                >
                                    {actionLabel}
                                </button>
                            </article>
                        );
                    })}
                </section>

                <details className={styles.advanced_models}>
                    <summary>{t("main_page.models_hub.advanced_models")}</summary>
                    <p>{t("main_page.models_hub.advanced_models_detail")}</p>
                    <div className={styles.model_list}>
                        {statuses.map((status) => (
                            <div key={status.id} className={styles.model_row}>
                                <div>
                                    <strong>{status.id}</strong>
                                    <span>{status.capacity ?? t("main_page.models_hub.size_not_available")}</span>
                                </div>
                                <span data-ready={status.is_downloaded === true}>
                                    {status.is_downloaded === true
                                        ? t("main_page.models_hub.installed")
                                        : status.is_pending === true
                                            ? t("main_page.models_hub.downloading")
                                            : t("main_page.models_hub.download_needed")}
                                </span>
                                <button
                                    type="button"
                                    disabled={status.is_pending === true || controlsPending}
                                    onClick={() => {
                                        if (status.is_downloaded === true) setSelectedWhisperWeightType(status.id);
                                        else downloadWhisperWeightTypeStatus(status.id);
                                    }}
                                >
                                    {status.is_downloaded === true
                                        ? selectedModelId === status.id
                                            ? t("main_page.models_hub.active_model")
                                            : t("main_page.models_hub.select_model")
                                        : t("main_page.models_hub.download")}
                                </button>
                            </div>
                        ))}
                    </div>
                </details>
            </main>
        </div>
    );
};
