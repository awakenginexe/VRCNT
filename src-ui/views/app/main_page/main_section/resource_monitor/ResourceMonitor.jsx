import { useCallback, useState } from "react";
import { useI18n } from "@useI18n";
import clsx from "clsx";
import styles from "./ResourceMonitor.module.scss";
import { useResourceUsage } from "@logics_common";
import { formatResourceMetric } from "@logics_common/resourceUsageUtils.js";
import { GpuMonitorMenu } from "./GpuMonitorMenu.jsx";

const RESOURCE_ITEMS = [
    { key: "cpu", label: "CPU" },
    { key: "gpu", label: "GPU" },
    { key: "ram", label: "RAM" },
    { key: "vram", label: "VRAM" },
];

export const ResourceMonitor = () => {
    const { t } = useI18n();
    const {
        currentResourceUsage,
        gpuMonitorSelection,
        setGpuMonitorSelection,
    } = useResourceUsage();
    const [openGpuMenu, setOpenGpuMenu] = useState(null);
    const resourceUsage = currentResourceUsage.data;
    const gpuDevices = resourceUsage?.gpu_devices ?? [];
    const canSelectGpu = gpuDevices.length > 0;

    const closeGpuMenu = useCallback(() => setOpenGpuMenu(null), []);
    const toggleGpuMenu = useCallback((cardKey, anchorElement) => {
        if (canSelectGpu) {
            setOpenGpuMenu((current) => (
                current?.cardKey === cardKey ? null : { cardKey, anchorElement }
            ));
        }
    }, [canSelectGpu]);

    const selectGpuMonitor = useCallback((selection) => {
        setGpuMonitorSelection(selection);
        closeGpuMenu();
    }, [closeGpuMenu, setGpuMonitorSelection]);

    return (
        <div className={styles.container}>
            {RESOURCE_ITEMS.map((item) => (
                <ResourceCard
                    key={item.key}
                    label={item.label}
                    metric={resourceUsage?.[item.key]}
                    isGpuSelectable={["gpu", "vram"].includes(item.key) && canSelectGpu}
                    isGpuMenuOpen={openGpuMenu?.cardKey === item.key}
                    onToggleGpuMenu={(event) => toggleGpuMenu(item.key, event.currentTarget)}
                    gpuDevices={gpuDevices}
                    selectedGpuIndex={resourceUsage?.selected_gpu_index}
                    gpuMonitorSelection={gpuMonitorSelection}
                    onSelectGpuMonitor={selectGpuMonitor}
                    onCloseGpuMenu={closeGpuMenu}
                    anchorElement={openGpuMenu?.anchorElement}
                    t={t}
                />
            ))}
        </div>
    );
};

const ResourceCard = ({
    label,
    metric,
    isGpuSelectable,
    isGpuMenuOpen,
    onToggleGpuMenu,
    gpuDevices,
    selectedGpuIndex,
    gpuMonitorSelection,
    onSelectGpuMonitor,
    onCloseGpuMenu,
    anchorElement,
    t,
}) => {
    const isAvailable = metric?.available && metric.percent !== null && metric.percent !== undefined;
    const percent = isAvailable ? Math.max(0, Math.min(100, Number(metric.percent))) : 0;
    const cardClassName = clsx(styles.card, {
        [styles.is_selectable]: isGpuSelectable,
        [styles.is_menu_open]: isGpuMenuOpen,
    });

    return (
        <div
            className={cardClassName}
            onClick={isGpuSelectable ? onToggleGpuMenu : undefined}
        >
            <div className={styles.card_header}>
                <div className={styles.label_group}>
                    <p className={styles.label}>{label}</p>
                    {isGpuSelectable && (
                        <p className={styles.gpu_selection_label}>
                            {getGpuSelectionLabel(gpuMonitorSelection, selectedGpuIndex, t)}
                        </p>
                    )}
                </div>
                <p className={styles.value}>{formatResourceMetric(metric)}</p>
            </div>
            <div className={styles.meter_track}>
                <span
                    className={styles.meter_fill}
                    style={{ width: `${percent}%` }}
                    data-unavailable={!isAvailable}
                />
            </div>
            {isGpuMenuOpen && (
                <GpuMonitorMenu
                    anchorElement={anchorElement}
                    gpuDevices={gpuDevices}
                    selectedGpuIndex={selectedGpuIndex}
                    gpuMonitorSelection={gpuMonitorSelection}
                    onSelectGpuMonitor={onSelectGpuMonitor}
                    onClose={onCloseGpuMenu}
                    t={t}
                />
            )}
        </div>
    );
};

const getGpuSelectionLabel = (selection, selectedGpuIndex, t) => {
    if (selection?.mode === "manual") return `GPU ${selection.device_index}`;
    if (selectedGpuIndex !== null && selectedGpuIndex !== undefined) return t("main_page.resource_monitor.auto_gpu", { index: selectedGpuIndex });
    return t("main_page.resource_monitor.auto");
};
