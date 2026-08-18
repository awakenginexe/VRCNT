import { useState } from "react";
import { useI18n } from "@useI18n";
import { useTranslation } from "@logics_configs";
import { getTranslationModelStatus } from "@logics_common";
import {
    getAllTranslationModels,
    getPresetTranslationModels,
} from "@logics_common/translationModelCatalog.js";
import {
    getPresetMetadata,
    getWeightDisplayName,
} from "@ui_configs";
import { CTranslate2ComputeDevice } from "./CTranslate2ComputeDevice";
import styles from "./TranslationModels.module.scss";

const statusCopy = (t, status, preset) => {
    switch (status.state) {
        case "preparing":
            return t("config_page.translation_models.preparing");
        case "downloading":
            return t("config_page.translation_models.downloading", {
                progress: Math.round(status.progress),
            });
        case "failed":
            return preset
                ? t(`config_page.model_download_error.preset_${preset}_failed`)
                : t("config_page.model_download_error.weight_type_verification");
        case "ready":
            return t("config_page.translation_models.ready");
        default:
            return t("config_page.common.model_download.required");
    }
};

const ModelStatus = ({ status, label }) => (
    <div className={styles.status} data-status={status.state} aria-live="polite">
        <span>{label}</span>
        {status.state === "downloading" && (
            <div
                className={styles.progress_track}
                role="progressbar"
                aria-label={label}
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={status.progress}
            >
                <span className={styles.progress_fill} style={{ width: `${status.progress}%` }} />
            </div>
        )}
        {status.state === "preparing" && (
            <div
                className={`${styles.progress_track} ${styles.progress_indeterminate}`}
                role="progressbar"
                aria-label={label}
                aria-busy="true"
            >
                <span className={styles.progress_fill} />
            </div>
        )}
    </div>
);

const ModelCard = ({
    model,
    preset,
    selected,
    status,
    statusLabel,
    selectionPending,
    onSelect,
    onDownload,
    t,
}) => {
    const metadata = preset ? getPresetMetadata(preset) : model;
    const isDownloading = status.state === "preparing" || status.state === "downloading";
    const canDownload = !selectionPending && !isDownloading && !status.ready;
    const isFailed = status.state === "failed";

    return (
        <article
            className={`${styles.card} ${selected ? styles.card_selected : ""}`}
            data-model-id={model.id}
            data-model-status={status.state}
            aria-busy={selectionPending}
        >
            <div className={styles.card_header}>
                <div>
                    <h3 className={styles.card_title}>
                        {preset ? t(`main_page.preset.${preset}`) : (model.display_name || getWeightDisplayName(model.id))}
                    </h3>
                    <p className={styles.card_capacity}>{metadata?.capacity || model.capacity}</p>
                </div>
                {selected && (
                    <span className={styles.selected_badge}>
                        {t("config_page.translation_models.current_selection")}
                    </span>
                )}
            </div>

            <p className={styles.card_description}>
                {preset
                    ? t(`main_page.offline_translation.preset.${preset}_description`)
                    : (model.language_coverage || t("config_page.translation_models.advanced_description"))}
            </p>

            <div className={styles.status_group}>
                <span className={styles.status_label}>
                    {t("config_page.translation_models.install_status")}
                </span>
                <ModelStatus status={status} label={statusLabel} />
            </div>

            <div className={styles.actions}>
                <button
                    className={styles.select_button}
                    type="button"
                    disabled={selected || selectionPending}
                    onClick={() => onSelect(model.id)}
                >
                    {selected
                        ? t("config_page.translation_models.current_selection")
                        : t("config_page.translation_models.select_model")}
                </button>
                {canDownload && (
                    <button
                        className={styles.download_button}
                        type="button"
                        onClick={() => onDownload(model.id)}
                    >
                        {isFailed
                            ? t("config_page.translation_models.retry")
                            : t("config_page.translation_models.download_model")}
                    </button>
                )}
            </div>

            <p className={styles.technical_id}>
                <span>{t("config_page.translation_models.technical_id")}:</span>{" "}
                <code>{model.id}</code>
            </p>
        </article>
    );
};

export const TranslationModels = ({
    mode = "legacy",
    showDescription = true,
    onOpenAdvanced,
}) => {
    const { t } = useI18n();
    const {
        currentCTranslate2WeightTypeStatus,
        pendingCTranslate2WeightTypeStatus,
        downloadCTranslate2WeightTypeStatus,
        currentSelectedCTranslate2WeightType,
        setSelectedCTranslate2WeightType,
    } = useTranslation();
    const [showAdvancedModels, setShowAdvancedModels] = useState(false);

    const allModels = currentCTranslate2WeightTypeStatus.data || [];
    const presetEntries = getPresetTranslationModels(allModels);
    const fullCatalog = getAllTranslationModels(allModels);
    const visibleAdvancedModels = mode === "legacy" ? fullCatalog : [];
    const isPresetMode = mode === "presets";
    const selectedWeightType = currentSelectedCTranslate2WeightType?.data;
    const isSwitchingModel = currentSelectedCTranslate2WeightType?.state === "pending";

    const selectModel = (weightType) => {
        if (isSwitchingModel) return;
        setSelectedCTranslate2WeightType(weightType);
    };

    const downloadModel = (weightType) => {
        pendingCTranslate2WeightTypeStatus(weightType);
        downloadCTranslate2WeightTypeStatus(weightType);
    };

    const renderModel = (model, preset = null) => {
        const status = getTranslationModelStatus(model);
        const selected = selectedWeightType === model.id;
        return (
            <ModelCard
                key={model.id}
                model={model}
                preset={preset}
                selected={selected}
                status={status}
                statusLabel={statusCopy(t, status, preset)}
                selectionPending={isSwitchingModel}
                onSelect={selectModel}
                onDownload={downloadModel}
                t={t}
            />
        );
    };

    return (
        <div className={styles.container}>
            {(showDescription || isSwitchingModel) && (
                <div className={styles.intro}>
                    {showDescription && (
                        <p className={styles.description}>
                            {t("config_page.translation_models.description")}
                        </p>
                    )}
                    {isSwitchingModel && (
                        <div
                            className={styles.active_notice}
                            role="status"
                            aria-live="polite"
                            aria-busy="true"
                        >
                            <span>{t("config_page.translation_models.model_switching")}</span>
                            <div
                                className={`${styles.progress_track} ${styles.progress_indeterminate}`}
                                role="progressbar"
                                aria-label={t("config_page.translation_models.model_switching")}
                                aria-busy="true"
                            >
                                <span className={styles.progress_fill} />
                            </div>
                        </div>
                    )}
                </div>
            )}

            <CTranslate2ComputeDevice />

            <div className={styles.preset_grid}>
                {presetEntries.map(({ model, preset }) => renderModel(model, preset))}
            </div>

            {!isPresetMode ? (
                <section className={styles.advanced_section}>
                    <button
                        className={styles.advanced_toggle}
                        type="button"
                        aria-expanded={showAdvancedModels}
                        onClick={() => setShowAdvancedModels((current) => !current)}
                    >
                        <span aria-hidden="true">{showAdvancedModels ? "−" : "+"}</span>
                        {t("main_page.offline_translation.advanced_models")}
                    </button>
                    {showAdvancedModels && (
                        <div className={styles.advanced_list}>
                            <p className={styles.advanced_description}>
                                {t("config_page.translation_models.advanced_description")}
                            </p>
                            {visibleAdvancedModels.map((model) => renderModel(model))}
                        </div>
                    )}
                </section>
            ) : (
                <section className={styles.advanced_section}>
                    <p className={styles.advanced_description}>
                        {t("main_page.translation_models.advanced_models_detail")}
                    </p>
                    <button
                        className={styles.advanced_handoff}
                        type="button"
                        onClick={() => onOpenAdvanced?.()}
                    >
                        {t("main_page.translation_models.advanced_models")}
                    </button>
                </section>
            )}
        </div>
    );
};
