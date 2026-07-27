import { useRef, useState } from "react";
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
    const [openGpuMenuCardKey, setOpenGpuMenuCardKey] = useState(null);
    const activeGpuCardRef = useRef(null);
    const resourceUsage = currentResourceUsage.data;
    const gpuDevices = resourceUsage?.gpu_devices ?? [];
    const canSelectGpu = gpuDevices.length > 0;

    const closeGpuMenu = () => setOpenGpuMenuCardKey(null);
    const toggleGpuMenu = (cardKey) => {
        if (canSelectGpu) {
            setOpenGpuMenuCardKey((current) => current === cardKey ? null : cardKey);
        }
    };

    const selectGpuMonitor = (selection) => {
        setGpuMonitorSelection(selection);
        closeGpuMenu();
    };

    return (
        <div className={styles.container}>
            {RESOURCE_ITEMS.map((item) => (
                <ResourceCard
                    key={item.key}
                    label={item.label}
                    metric={resourceUsage?.[item.key]}
                    isGpuSelectable={["gpu", "vram"].includes(item.key) && canSelectGpu}
                    isGpuMenuOpen={openGpuMenuCardKey === item.key}
                    onToggleGpuMenu={() => toggleGpuMenu(item.key)}
                    gpuDevices={gpuDevices}
                    selectedGpuIndex={resourceUsage?.selected_gpu_index}
                    gpuMonitorSelection={gpuMonitorSelection}
                    onSelectGpuMonitor={selectGpuMonitor}
                    onCloseGpuMenu={closeGpuMenu}
                    activeGpuCardRef={activeGpuCardRef}
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
    activeGpuCardRef,
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
            ref={isGpuMenuOpen ? activeGpuCardRef : undefined}
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
                    anchorRef={activeGpuCardRef}
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
