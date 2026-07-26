import clsx from "clsx";
import { useI18n } from "@useI18n";
import { useStore_SelectedConfigTabId } from "@store";

import MicSvg from "@images/mic.svg?react";
import AppearanceSvg from "@images/mui_palette.svg?react";
import TranslationSvg from "@images/translation.svg?react";
import HMDSvg from "@images/mui_head_mounted_device.svg?react";
import DiscoverTuneSvg from "@images/mui_discover_tune.svg?react";
import KeyboardAltSvg from "@images/mui_keyboard_alt.svg?react";
import CodeBlocksSvg from "@images/mui_code_blocks.svg?react";
import logoBadge from "@images/vrcnt_logo_badge.png";

import styles from "./SidebarSection.module.scss";
import { getSidebarTabMeta, sidebarTabOrder } from "./sidebarTabMeta.js";

const TabIcon = ({ tabId }) => {
    const className = styles.tab_icon;
    switch (tabId) {
        case "device": return <MicSvg className={className} />;
        case "appearance": return <AppearanceSvg className={className} />;
        case "translation":
        case "transcription":
        case "model_and_provider":
            return <TranslationSvg className={className} />;
        case "vr": return <HMDSvg className={className} />;
        case "others": return <DiscoverTuneSvg className={className} />;
        case "hotkeys": return <KeyboardAltSvg className={className} />;
        case "advanced_settings": return <CodeBlocksSvg className={className} />;
        case "about": return <img className={clsx(className, styles.logo_icon)} src={logoBadge} alt="" />;
        default: return null;
    }
};

export const SidebarSection = ({ searchQuery = "", onSelect }) => {
    const { t } = useI18n();
    const { updateSelectedConfigTabId, currentSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();

    return (
        <nav
            className={styles.container}
            aria-label={t("config_page.focus_settings.navigation_label")}
        >
            <div className={styles.tabs_wrapper}>
                {sidebarTabOrder.map((tabId) => {
                    const meta = getSidebarTabMeta(tabId, t);
                    const isSelected = currentSelectedConfigTabId.data === tabId;
                    const matchesQuery = !normalizedQuery
                        || meta.label.toLocaleLowerCase().includes(normalizedQuery)
                        || meta.tooltipDetail.toLocaleLowerCase().includes(normalizedQuery);

                    return (
                        <button
                            key={tabId}
                            type="button"
                            className={clsx(styles.tab, {
                                [styles.is_selected]: isSelected,
                                [styles.matches_search]: normalizedQuery && matchesQuery,
                            })}
                            onClick={() => {
                                updateSelectedConfigTabId(tabId);
                                onSelect?.();
                            }}
                            aria-current={isSelected ? "page" : undefined}
                            title={meta.tooltipDetail}
                        >
                            <TabIcon tabId={tabId} />
                            <span>{meta.label}</span>
                        </button>
                    );
                })}
            </div>
        </nav>
    );
};
