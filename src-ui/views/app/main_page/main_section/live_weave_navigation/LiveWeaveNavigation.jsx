import { useMemo } from "react";
import { useI18n } from "@useI18n";
import { store, useStore_SelectedConfigTabId } from "@store";
import { useIsOpenedConfigPage, usePipelineStatus } from "@logics_common";
import { selectPipelineStatusSummary } from "@logics_common/pipelineStatusUtils.js";
import { DesktopOverlayButton } from "../../sidebar_section/desktop_overlay_button/DesktopOverlayButton";
import styles from "./LiveWeaveNavigation.module.scss";

const NAVIGATION_ITEMS = [
    { id: "live", labelKey: "main_page.live_weave.navigation.live" },
    { id: "history", labelKey: "main_page.live_weave.navigation.history" },
    { id: "models", labelKey: "main_page.live_weave.navigation.models", configTab: "model_and_provider" },
    { id: "overlay", labelKey: "main_page.live_weave.navigation.overlay", configTab: "vr" },
    { id: "settings", labelKey: "main_page.live_weave.navigation.settings", configTab: "appearance" },
];

export const LiveWeaveNavigation = () => {
    const { t } = useI18n();
    const { currentIsOpenedConfigPage, setIsOpenedConfigPage } = useIsOpenedConfigPage();
    const { updateSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const { currentPipelineStatus } = usePipelineStatus();
    const summary = useMemo(
        () => selectPipelineStatusSummary(currentPipelineStatus.data, Date.now()),
        [currentPipelineStatus.data],
    );

    const openItem = (item) => {
        if (item.id === "live") {
            setIsOpenedConfigPage(false);
            return;
        }

        if (item.id === "history") {
            store.log_box_ref?.current?.scrollTo({ top: 0, behavior: "smooth" });
            return;
        }

        updateSelectedConfigTabId(item.configTab);
        setIsOpenedConfigPage(true);
    };

    return (
        <div className={styles.container}>
            <button
                type="button"
                className={styles.wordmark}
                onClick={() => setIsOpenedConfigPage(false)}
                aria-label={t("main_page.live_weave.navigation.live")}
            >
                <span>VRCNT</span>
            </button>
            <nav className={styles.navigation} aria-label={t("main_page.live_weave.navigation.live")}>
                {NAVIGATION_ITEMS.map((item) => {
                    const isLive = item.id === "live";
                    const isActive = isLive && !currentIsOpenedConfigPage.data;

                    return (
                        <button
                            key={item.id}
                            type="button"
                            className={styles.navigation_item}
                            data-active={isActive}
                            aria-current={isActive ? "page" : undefined}
                            onClick={() => openItem(item)}
                        >
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
                <DesktopOverlayButton forceCompact />
            </div>
        </div>
    );
};
