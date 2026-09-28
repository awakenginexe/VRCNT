import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import clsx from "clsx";
import { getCachedRuntimeState, getRuntimeBadge, getRuntimePresentation, getRuntimeState } from "@logics_common/runtimeManager.js";
import { useI18n } from "@useI18n";
import { useOnboarding } from "@logics_configs";
import {
    store,
    useStore_ExperienceRoute,
    useStore_OpenedQuickSetting,
    useStore_SelectedConfigTabId,
} from "@store";
import { useIsOpenedConfigPage, usePipelineStatus, useSoftwareVersion } from "@logics_common";
import { selectAudioBacklogProgress, selectPipelineStatusSummary } from "@logics_common/pipelineStatusUtils.js";
import {
    canNavigateDuringOnboarding,
    getOnboardingTourSnapshot,
    subscribeToOnboardingTour,
} from "@logics_common/onboardingTourState.js";
import { DesktopOverlayButton } from "../../sidebar_section/desktop_overlay_button/DesktopOverlayButton";
import logoBadge from "@images/vrcnt_logo_badge.png";
import MicSvg from "@images/mic.svg?react";
import HeadphonesSvg from "@images/headphones.svg?react";
import styles from "./LiveWeaveNavigation.module.scss";

const NAVIGATION_ITEMS = [
    { id: "live", icon: "⚡", labelKey: "main_page.live_weave.navigation.live" },
    { id: "models", icon: "🧠", labelKey: "main_page.live_weave.navigation.models", configTab: "model_and_provider" },
    { id: "translation_models", icon: "🌐", labelKey: "main_page.live_weave.navigation.translation_models" },
    { id: "overlay", icon: "🖼", labelKey: "main_page.live_weave.navigation.overlay", configTab: "vr" },
    { id: "osc", icon: "◈", labelKey: "main_page.live_weave.navigation.osc" },
    { id: "customize", icon: "🎨", labelKey: "main_page.live_weave.navigation.customize" },
    { id: "settings", icon: "⚙", labelKey: "main_page.live_weave.navigation.settings", configTab: "appearance" },
];

export const LiveWeaveNavigation = () => {
    const { t } = useI18n();
    const { setIsOpenedConfigPage } = useIsOpenedConfigPage();
    const { updateSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const { currentExperienceRoute, updateExperienceRoute } = useStore_ExperienceRoute();
    const { updateOpenedQuickSetting } = useStore_OpenedQuickSetting();
    const { currentLatestSoftwareVersionInfo } = useSoftwareVersion();
    const { currentPipelineStatus } = usePipelineStatus();
    const { currentSetupCompleted } = useOnboarding();
    const onboardingSnapshot = useSyncExternalStore(
        subscribeToOnboardingTour,
        getOnboardingTourSnapshot,
        getOnboardingTourSnapshot,
    );
    const canManualNavigate = canNavigateDuringOnboarding({
        setupCompleted: currentSetupCompleted.data,
        onboardingActive: onboardingSnapshot.active,
    });
    const hasUpdateAvailable = currentLatestSoftwareVersionInfo.data.is_update_available === true;
    const summary = useMemo(
        () => selectPipelineStatusSummary(currentPipelineStatus.data, Date.now()),
        [currentPipelineStatus.data],
    );
    const audioBacklog = useMemo(
        () => selectAudioBacklogProgress(currentPipelineStatus.data),
        [currentPipelineStatus.data],
    );
    const hasQueuedAudio = audioBacklog.some(({ total }) => total > 1);
    const [runtime, setRuntime] = useState(getCachedRuntimeState);

    useEffect(() => {
        let isCurrent = true;
        getRuntimeState()
            .then((currentRuntime) => {
                if (isCurrent) {
                    setRuntime(currentRuntime);
                }
            })
            .catch(() => {
                if (isCurrent) {
                    setRuntime(null);
                }
            });
        return () => {
            isCurrent = false;
        };
    }, []);

    const presentation = getRuntimePresentation(runtime);
    const runtimeVariant = presentation.status === "active" ? presentation.currentVariant : null;
    const runtimeBadge = getRuntimeBadge(runtime, { preferNvidiaCuda: true });
    const displayedBadge = runtimeVariant === "cuda" ? "CUDA" : (runtimeVariant === "cpu" ? "CPU" : null);

    const openItem = (item) => {
        if (!canManualNavigate) return;
        updateExperienceRoute(item.id);
        if (item.id === "live") {
            setIsOpenedConfigPage(false);
            return;
        }

        if (item.id === "models" || item.id === "translation_models" || item.id === "overlay" || item.id === "osc" || item.id === "customize") {
            setIsOpenedConfigPage(false);
            return;
        }

        if (item.configTab) {
            updateSelectedConfigTabId(item.configTab);
            setIsOpenedConfigPage(true);
        }
    };

    return (
        <div className={styles.container}>
            <button
                type="button"
                className={styles.wordmark}
                disabled={!canManualNavigate}
                aria-disabled={!canManualNavigate}
                onClick={() => {
                    if (!canManualNavigate) return;
                    updateExperienceRoute("live");
                    setIsOpenedConfigPage(false);
                }}
                aria-label={t("main_page.live_weave.navigation.live")}
            >
                <img className={styles.wordmark_badge} src={logoBadge} alt="" />
                <span>VRCNT</span>
                <span
                    className={clsx(styles.runtime_badge, {
                        [styles.variant_cpu]: runtimeVariant === "cpu",
                        [styles.variant_cuda]: runtimeVariant === "cuda",
                    })}
                    data-unverified={!displayedBadge}
                    aria-hidden={!displayedBadge}
                    title={displayedBadge ? `Installed edition: ${runtimeBadge}` : undefined}
                >
                    {displayedBadge ?? "CUDA"}
                </span>
            </button>
            <nav className={styles.navigation} aria-label={t("main_page.live_weave.navigation.live")}>
                {NAVIGATION_ITEMS.map((item) => {
                    const isActive = currentExperienceRoute.data === item.id;

                    return (
                        <button
                            key={item.id}
                            type="button"
                            className={styles.navigation_item}
                            data-active={isActive}
                            aria-current={isActive ? "page" : undefined}
                            disabled={!canManualNavigate}
                            aria-disabled={!canManualNavigate}
                            onClick={() => openItem(item)}
                        >
                            <span className={styles.navigation_icon} aria-hidden="true">{item.icon}</span>
                            {t(item.labelKey)}
                        </button>
                    );
                })}
            </nav>
            <div className={styles.utility_area}>
                <span
                    className={styles.session_health}
                    data-health={summary.health === "error" ? "error" : (hasQueuedAudio ? "backlog" : summary.health)}
                >
                    {audioBacklog.length > 0 ? (
                        <span className={styles.backlog_status}>
                            {(summary.health === "error" || !hasQueuedAudio)
                                ? `${summary.health === "healthy"
                                    ? t("main_page.live_weave.session_live")
                                    : t(`main_page.pipeline_status.${summary.health}`)} · `
                                : ""}
                            {t("main_page.pipeline_status.queue")}
                            {audioBacklog.map(({ source, position, total }) => {
                                const label = t(`main_page.pipeline_status.${source === "mic" ? "speaking" : "listening"}`);
                                return (
                                    <span key={source} className={styles.backlog_source} data-source={source} title={label} aria-label={`${label}: ${position}/${total}`}>
                                        {source === "mic" ? <MicSvg aria-hidden="true" /> : <HeadphonesSvg aria-hidden="true" />}
                                        {position}/{total}
                                    </span>
                                );
                            })}
                        </span>
                    ) : (
                        summary.health === "healthy"
                            ? t("main_page.live_weave.session_live")
                            : t(`main_page.pipeline_status.${summary.health}`)
                    )}
                </span>
                <button
                    type="button"
                    className={styles.update_button}
                    data-update-available={hasUpdateAvailable}
                    onClick={() => updateOpenedQuickSetting("update_software")}
                >
                    {t(
                        hasUpdateAvailable
                            ? "main_page.quick_setting_update"
                            : "main_page.quick_setting_latest",
                    )}
                </button>
                <DesktopOverlayButton forceCompact />
            </div>
        </div>
    );
};
