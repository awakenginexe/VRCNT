import { useMemo } from "react";
import { useI18n } from "@useI18n";
import {
    store,
    useStore_ExperienceRoute,
    useStore_OpenedQuickSetting,
    useStore_SelectedConfigTabId,
} from "@store";
import { useIsOpenedConfigPage, usePipelineStatus, useSoftwareVersion } from "@logics_common";
import { selectPipelineStatusSummary } from "@logics_common/pipelineStatusUtils.js";
import { DesktopOverlayButton } from "../../sidebar_section/desktop_overlay_button/DesktopOverlayButton";
import logoBadge from "@images/vrcnt_logo_badge.png";
import styles from "./LiveWeaveNavigation.module.scss";

const NAVIGATION_ITEMS = [
    { id: "live", icon: "⚡", labelKey: "main_page.live_weave.navigation.live" },
    { id: "setup", icon: "🪄", labelKey: "main_page.live_weave.navigation.setup" },
    { id: "engines", icon: "⚙", labelKey: "main_page.live_weave.navigation.engines", configTab: "model_and_provider" },
    { id: "models", icon: "🧠", labelKey: "main_page.live_weave.navigation.models", configTab: "model_and_provider" },
    { id: "overlay", icon: "🖼", labelKey: "main_page.live_weave.navigation.overlay", configTab: "vr" },
    { id: "history", icon: "📜", labelKey: "main_page.live_weave.navigation.history" },
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
    const hasUpdateAvailable = currentLatestSoftwareVersionInfo.data.is_update_available === true;
    const summary = useMemo(
        () => selectPipelineStatusSummary(currentPipelineStatus.data, Date.now()),
        [currentPipelineStatus.data],
    );

    const openItem = (item) => {
        updateExperienceRoute(item.id);
        if (item.id === "live") {
            setIsOpenedConfigPage(false);
            return;
        }

        if (item.id === "setup") {
            setIsOpenedConfigPage(false);
            return;
        }

        if (item.id === "engines" || item.id === "models") {
            setIsOpenedConfigPage(false);
            return;
        }

        if (item.id === "history") {
            store.log_box_ref?.current?.scrollTo({ top: 0, behavior: "smooth" });
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
                onClick={() => {
                    updateExperienceRoute("live");
                    setIsOpenedConfigPage(false);
                }}
                aria-label={t("main_page.live_weave.navigation.live")}
            >
                <img className={styles.wordmark_badge} src={logoBadge} alt="" />
                <span>VRCNT</span>
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
                            onClick={() => openItem(item)}
                        >
                            <span className={styles.navigation_icon} aria-hidden="true">{item.icon}</span>
                            {t(item.labelKey)}
                        </button>
                    );
                })}
            </nav>
            <div className={styles.utility_area}>
                <span className={styles.session_health} data-health={summary.health}>
                    {summary.health === "healthy"
                        ? t("main_page.live_weave.session_live")
                        : t(`main_page.pipeline_status.${summary.health}`)}
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
