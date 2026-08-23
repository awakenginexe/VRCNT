import { useMemo, useState } from "react";
import { useI18n } from "@useI18n";
import { useTranscription, useTranslation } from "@logics_configs";
import {
    useIsOpenedConfigPage,
} from "@logics_common";
import {
    useStore_ExperienceRoute,
    useStore_SelectedConfigTabId,
} from "@store";
import { TopBar } from "../main_section/top_bar/TopBar";
import { SpeechRecognitionCards } from "../engines/SpeechRecognitionCards.jsx";
import { CustomModernSelect } from "@common_components";
import {
    findPresetCandidate,
    resolveWhisperRecommendation,
    WHISPER_PRESETS,
    WHISPER_THAI_PRESETS,
    WHISPER_CLOUD_MODELS,
    CLOUD_RECOMMENDATIONS,
    CPU_RECOMMENDATIONS,
    getModelSuitability,
    getModelsHubCopyKey,
    MODEL_FILTER_CATEGORIES,
} from "../engines/engineModelUtils";
import { ModelDownloadProgress } from "./ModelDownloadProgress.jsx";
import { getModelDownloadState } from "./modelDownloadDisplay.js";
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
    better: {
        title: "main_page.models_hub.better_title",
        detail: "main_page.models_hub.better_detail",
    },
    accurate: {
        title: "main_page.models_hub.accurate_title",
        detail: "main_page.models_hub.accurate_detail",
    },
    best_accuracy: {
        title: "main_page.models_hub.accuracy_title",
        detail: "main_page.models_hub.accuracy_detail",
    },
};

const THAI_PRESET_COPY = {
    fast: {
        title: "main_page.models_hub.thai_fast_title",
        detail: "main_page.models_hub.thai_fast_detail",
    },
    balanced: {
        title: "main_page.models_hub.thai_balanced_title",
        detail: "main_page.models_hub.thai_balanced_detail",
    },
    best_accuracy: {
        title: "main_page.models_hub.thai_best_title",
        detail: "main_page.models_hub.thai_best_detail",
    },
};

const getStatusLabel = (downloadState, t) => {
    if (downloadState === "installed") return t("main_page.models_hub.installed");
    if (downloadState === "cancelling") return t("main_page.models_hub.cancelling_download");
    if (downloadState === "preparing") return t("main_page.models_hub.preparing_download");
    if (downloadState === "downloading") return t("main_page.models_hub.downloading");
    if (downloadState === "failed") return t("main_page.models_hub.download_failed");
    if (downloadState === "unavailable") return t("main_page.models_hub.model_unavailable");
    return t("main_page.models_hub.download_needed");
};

const RecommendationCard = ({
    t,
    definition,
    status,
    suitability,
    isRecommended = false,
    onAction,
    onCancel,
    actionLabel,
    actionDisabled = false,
}) => {
    const downloadState = getModelDownloadState(status);
    const isDownloading = downloadState === "preparing" || downloadState === "downloading";
    const isCancelling = downloadState === "cancelling";
    const isUnavailable = downloadState === "unavailable";
    const hasModelStatus = Boolean(status);

    return (
        <article
            className={styles.preset_card}
            data-active={false}
            data-recommended={isRecommended}
            data-engine={definition.engine}
            data-model={definition.modelId ?? ""}
        >
            <header className={styles.card_header}>
                <div>
                    <h2>{t(getModelsHubCopyKey(definition.titleKey))}</h2>
                    <p>{t(getModelsHubCopyKey(definition.detailKey))}</p>
                </div>
                {isRecommended && <span className={styles.recommended_badge}>{t("main_page.models_hub.recommended")}</span>}
            </header>
            <div className={styles.suitability_chips}>
                <span className={styles.suit_badge} data-tier={suitability.tier}>{suitability.badge}</span>
                <span className={styles.rating_chip} title="Speed Rating">⚡ {"⚡".repeat(suitability.speed)}</span>
                <span className={styles.rating_chip} title="Accuracy Rating">⭐ {"⭐".repeat(suitability.quality)}</span>
            </div>
            <dl className={styles.model_facts}>
                <div>
                    <dt>{t("main_page.models_hub.model_label")}</dt>
                    <dd>{definition.modelId ?? t(`main_page.models_hub.${definition.modelLabelKey ?? "language_specific_model"}`)}</dd>
                </div>
                <div>
                    <dt>{t("main_page.models_hub.download_size")}</dt>
                    <dd>{status?.capacity ?? (hasModelStatus ? t("main_page.models_hub.size_not_available") : t("main_page.models_hub.not_applicable"))}</dd>
                </div>
                <div>
                    <dt>{t("main_page.models_hub.profile_label")}</dt>
                    <dd>{definition.profile ?? t("main_page.models_hub.local_runtime")}</dd>
                </div>
                <div>
                    <dt>{t("main_page.models_hub.status_label")}</dt>
                    <dd>{definition.statusKey ? t(`main_page.models_hub.${definition.statusKey}`) : getStatusLabel(downloadState, t)}</dd>
                </div>
            </dl>
            {hasModelStatus && (
                <ModelDownloadProgress status={status} onCancel={() => onCancel?.(status.id)} />
            )}
            <button
                type="button"
                className={styles.preset_button}
                disabled={actionDisabled || (!onAction && !onCancel) || isDownloading || isCancelling || isUnavailable}
                onClick={onAction}
            >
                {actionLabel ?? (hasModelStatus
                    ? downloadState === "installed"
                        ? t("main_page.models_hub.select_model")
                        : downloadState === "failed"
                            ? t("main_page.models_hub.retry_download")
                            : downloadState === "unavailable"
                                ? t("main_page.models_hub.model_unavailable")
                            : downloadState === "preparing" || downloadState === "downloading"
                                ? t("main_page.models_hub.downloading")
                                : t("main_page.models_hub.download_model", { size: status?.capacity ?? "" })
                    : t("main_page.models_hub.choose_in_runtime"))}
            </button>
        </article>
    );
};

export const ModelsHub = () => {
    const { t } = useI18n();
    const [activeFilter, setActiveFilter] = useState("all");
    const { updateExperienceRoute } = useStore_ExperienceRoute();
    const {
        currentWhisperWeightTypeStatus,
        downloadWhisperWeightTypeStatus,
        cancelDownloadWhisperWeightTypeStatus,
        currentWhisperThaiWeightTypeStatus,
        downloadWhisperThaiWeightTypeStatus,
        cancelDownloadWhisperThaiWeightTypeStatus,
        currentVoskWeightTypeStatus,
        downloadVoskWeightTypeStatus,
        cancelDownloadVoskWeightTypeStatus,
        currentParakeetWeightTypeStatus,
        downloadParakeetWeightTypeStatus,
        cancelDownloadParakeetWeightTypeStatus,
        currentSenseVoiceWeightTypeStatus,
        downloadSenseVoiceWeightTypeStatus,
        cancelDownloadSenseVoiceWeightTypeStatus,
        currentTranscriptionProfileSend,
        setTranscriptionProfileSend,
        currentUseSplitGroqApiKey,
        currentGroqWhisperAuthKey,
    } = useTranscription();
    const { currentGroqAuthKey } = useTranslation();
    const { setIsOpenedConfigPage } = useIsOpenedConfigPage();
    const { updateSelectedConfigTabId } = useStore_SelectedConfigTabId();

    const statuses = currentWhisperWeightTypeStatus.data ?? [];
    const modelGroups = [
        { id: "Whisper", statuses, download: downloadWhisperWeightTypeStatus, cancel: cancelDownloadWhisperWeightTypeStatus },
        { id: "Whisper Thai", statuses: currentWhisperThaiWeightTypeStatus.data ?? [], download: downloadWhisperThaiWeightTypeStatus, cancel: cancelDownloadWhisperThaiWeightTypeStatus },
        { id: "Vosk", statuses: currentVoskWeightTypeStatus.data ?? [], download: downloadVoskWeightTypeStatus, cancel: cancelDownloadVoskWeightTypeStatus },
        { id: "Parakeet", statuses: currentParakeetWeightTypeStatus.data ?? [], download: downloadParakeetWeightTypeStatus, cancel: cancelDownloadParakeetWeightTypeStatus },
        { id: "SenseVoice", statuses: currentSenseVoiceWeightTypeStatus.data ?? [], download: downloadSenseVoiceWeightTypeStatus, cancel: cancelDownloadSenseVoiceWeightTypeStatus },
    ];
    const modelGroupByEngine = new Map(modelGroups.map((group) => [group.id, group]));
    const selectedDevice = currentTranscriptionProfileSend.data?.device ?? {};
    const recommendation = useMemo(() => resolveWhisperRecommendation({
        statuses,
        selectedDevice,
    }), [selectedDevice, statuses]);
    const controlsPending = statuses.some((status) => status?.is_pending === true);
    const cloudConfigured = currentUseSplitGroqApiKey.data === true
        ? Boolean(currentGroqWhisperAuthKey.data)
        : Boolean(currentGroqAuthKey.data);
    const openAdvanced = () => {
        updateSelectedConfigTabId("model_and_provider");
        setIsOpenedConfigPage(true);
    };

    const handleModelAction = (engine, modelId) => {
        const group = modelGroupByEngine.get(engine);
        const status = group?.statuses.find((item) => item.id === modelId);
        if (
            !group
            || !status
            || getModelDownloadState(status) === "unavailable"
            || group.statuses.some((item) => item?.is_pending === true)
        ) return;
        if (status.is_downloaded === true) {
            updateExperienceRoute("models");
            return;
        }
        if (status.is_pending !== true) group.download(status.id);
    };

    const openAdvancedModels = (engine) => {
        const id = `advanced-${engine.toLowerCase().replaceAll(" ", "-")}`;
        const section = document.getElementById(id);
        if (!section) return;
        section.open = true;
        section.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    return (
        <div className={styles.container}>
            <TopBar />
            <main className={styles.content} data-onboarding-target="tour-workspace">
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

                <SpeechRecognitionCards />

                <section className={styles.advanced_models} data-provider="whisper-cloud">
                    <div className={styles.model_identity}>
                        <strong>{t("main_page.models_hub.whisper_cloud_title")}</strong>
                        <span>{t("main_page.models_hub.whisper_cloud_detail")}</span>
                    </div>
                    <CustomModernSelect
                        id="whisper-cloud-model-select"
                        label={t("main_page.models_hub.whisper_cloud_model_label")}
                        value={currentTranscriptionProfileSend.data?.models?.["Whisper Cloud"] ?? WHISPER_CLOUD_MODELS[1]}
                        options={WHISPER_CLOUD_MODELS.map((id) => ({ id, title: id }))}
                        disabled={!cloudConfigured}
                        onChange={(value) => {
                            if (!cloudConfigured) {
                                openAdvanced();
                                return;
                            }
                            setTranscriptionProfileSend({
                                engine: "Whisper Cloud",
                                models: { "Whisper Cloud": value },
                            });
                        }}
                    />
                    {!cloudConfigured && (
                        <button type="button" onClick={openAdvanced}>
                            {t("main_page.models_hub.configure_groq_key")}
                        </button>
                    )}
                </section>

                <nav className={styles.filter_bar} aria-label="Model Categories">
                    {MODEL_FILTER_CATEGORIES.map((cat) => (
                        <button
                            key={cat.id}
                            type="button"
                            className={styles.filter_pill}
                            data-active={activeFilter === cat.id}
                            onClick={() => setActiveFilter(cat.id)}
                        >
                            {cat.fallback}
                        </button>
                    ))}
                </nav>

                <section className={styles.preset_grid} aria-label={t("main_page.models_hub.presets_label")}>
                    {WHISPER_PRESETS.map((preset) => {
                        const modelId = preset.candidates[0];
                        const candidate = findPresetCandidate({
                            presetId: preset.id,
                            statuses,
                            installedOnly: false,
                        });
                        const suitability = getModelSuitability("Whisper", modelId);
                        if (activeFilter !== "all" && suitability.tier !== activeFilter) return null;
                        return (
                            <RecommendationCard
                                key={`whisper-${preset.id}`}
                                t={t}
                                definition={{
                                    engine: "Whisper",
                                    modelId,
                                    profile: preset.decodingProfile,
                                    titleKey: PRESET_COPY[preset.id].title,
                                    detailKey: PRESET_COPY[preset.id].detail,
                                }}
                                status={candidate}
                                suitability={suitability}
                                isRecommended={recommendation.presetId === preset.id}
                                onAction={() => handleModelAction("Whisper", modelId)}
                                onCancel={(id) => cancelDownloadWhisperWeightTypeStatus(id)}
                                actionDisabled={!candidate || controlsPending}
                            />
                        );
                    })}
                    {WHISPER_THAI_PRESETS.map((preset) => {
                        const modelId = preset.candidates[0];
                        const group = modelGroupByEngine.get("Whisper Thai");
                        const candidate = group?.statuses.find((status) => status.id === modelId);
                        const suitability = getModelSuitability("Whisper Thai", modelId);
                        if (activeFilter !== "all" && suitability.tier !== activeFilter) return null;
                        return (
                            <RecommendationCard
                                key={`whisper-thai-${preset.id}`}
                                t={t}
                                definition={{
                                    engine: "Whisper Thai",
                                    modelId,
                                    profile: preset.decodingProfile,
                                    titleKey: THAI_PRESET_COPY[preset.id].title,
                                    detailKey: THAI_PRESET_COPY[preset.id].detail,
                                }}
                                status={candidate}
                                suitability={suitability}
                                onAction={() => handleModelAction("Whisper Thai", modelId)}
                                onCancel={(id) => group?.cancel(id)}
                                actionDisabled={!candidate || group?.statuses.some((status) => status?.is_pending === true)}
                            />
                        );
                    })}
                    {CPU_RECOMMENDATIONS.map((definition) => {
                        const group = modelGroupByEngine.get(definition.engine);
                        const status = definition.modelId
                            ? group?.statuses.find((item) => item.id === definition.modelId)
                            : null;
                        const suitability = getModelSuitability(definition.engine, definition.modelId);
                        if (activeFilter !== "all" && suitability.tier !== activeFilter) return null;
                        return (
                            <RecommendationCard
                                key={`cpu-${definition.id}`}
                                t={t}
                                definition={definition}
                                status={status}
                                suitability={suitability}
                                onAction={() => definition.languageSpecific
                                    ? openAdvancedModels(definition.engine)
                                    : handleModelAction(definition.engine, definition.modelId)}
                                onCancel={(id) => group?.cancel(id)}
                                actionLabel={definition.languageSpecific ? t("main_page.models_hub.open_advanced_models") : undefined}
                                actionDisabled={definition.languageSpecific
                                    ? false
                                    : !status || group?.statuses.some((item) => item?.is_pending === true)}
                            />
                        );
                    })}
                    {CLOUD_RECOMMENDATIONS.map((definition) => {
                        const suitability = getModelSuitability(definition.engine);
                        if (activeFilter !== "all" && suitability.tier !== activeFilter) return null;
                        return (
                            <RecommendationCard
                                key={`cloud-${definition.id}`}
                                t={t}
                                definition={definition}
                                suitability={suitability}
                                onAction={() => definition.engine === "Whisper Cloud" && !cloudConfigured
                                    ? openAdvanced()
                                    : updateExperienceRoute("live")}
                                actionLabel={definition.engine === "Whisper Cloud" && !cloudConfigured
                                    ? t("main_page.models_hub.configure_groq_key")
                                    : t("main_page.models_hub.choose_in_runtime")}
                            />
                        );
                    })}
                </section>

                {modelGroups.map((group) => (
                    <details
                        key={group.id}
                        id={`advanced-${group.id.toLowerCase().replaceAll(" ", "-")}`}
                        className={styles.advanced_models}
                    >
                        <summary>{group.id} · {t("main_page.models_hub.advanced_models")}</summary>
                        <p>{t("main_page.models_hub.advanced_models_detail")}</p>
                        <div className={styles.model_list}>
                            {group.statuses.map((status) => {
                                const downloadState = getModelDownloadState(status);
                                const isDownloading = downloadState === "preparing" || downloadState === "downloading";
                                const isCancelling = downloadState === "cancelling";
                                const suit = getModelSuitability(group.id, status.id);

                                return (
                                    <div key={status.id} className={styles.model_row} data-state={downloadState}>
                                        <div className={styles.model_identity}>
                                            <div className={styles.model_name_row}>
                                                <strong>{status.label ?? status.display_name ?? status.id}</strong>
                                                <span className={styles.row_suit_badge} data-tier={suit.tier}>{suit.badge}</span>
                                            </div>
                                            <div className={styles.model_specs_row}>
                                                <span>{status.capacity ?? t("main_page.models_hub.size_not_available")}</span>
                                                <span className={styles.row_rating}>⚡ {"⚡".repeat(suit.speed)} · ⭐ {"⭐".repeat(suit.quality)}</span>
                                            </div>
                                            {(isDownloading || isCancelling) && (
                                                <ModelDownloadProgress
                                                    status={status}
                                                    onCancel={() => group.cancel(status.id)}
                                                />
                                            )}
                                        </div>
                                        <span data-ready={downloadState === "installed"} data-state={downloadState}>
                                            {downloadState === "installed"
                                                ? t("main_page.models_hub.installed")
                                                : downloadState === "cancelling"
                                                    ? t("main_page.models_hub.cancelling_download")
                                                    : downloadState === "preparing"
                                                        ? t("main_page.models_hub.preparing_download")
                                                        : downloadState === "downloading"
                                                            ? t("main_page.models_hub.downloading")
                                                            : downloadState === "failed"
                                                                ? t("main_page.models_hub.download_failed")
                                                                : downloadState === "unavailable"
                                                                    ? t("main_page.models_hub.model_unavailable")
                                                                    : t("main_page.models_hub.download_needed")}
                                        </span>
                                        <button
                                            type="button"
                                            disabled={isCancelling || isDownloading || downloadState === "unavailable"}
                                            onClick={() => {
                                                if (downloadState === "installed") updateExperienceRoute("models");
                                                else if (isDownloading || isCancelling) return;
                                                else group.download(status.id);
                                            }}
                                        >
                                            {downloadState === "installed"
                                                ? t("main_page.models_hub.select_model")
                                                : isCancelling
                                                    ? t("main_page.models_hub.cancelling_download")
                                                    : isDownloading
                                                        ? t("main_page.models_hub.downloading")
                                                        : downloadState === "failed"
                                                            ? t("main_page.models_hub.retry_download")
                                                            : t("main_page.models_hub.download")}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </details>
                ))}
            </main>
        </div>
    );
};
