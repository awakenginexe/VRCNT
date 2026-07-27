import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import styles from "./ResourceMonitor.module.scss";
import { calculateResourceMenuPosition } from "./resourceMenuPosition.js";

export const GpuMonitorMenu = ({
    anchorElement,
    gpuDevices,
    selectedGpuIndex,
    gpuMonitorSelection,
    onSelectGpuMonitor,
    onClose,
    t,
}) => {
    const menuRef = useRef(null);
    const [position, setPosition] = useState({ left: 8, top: 8 });
    const isAutoSelected = gpuMonitorSelection?.mode !== "manual";

    useLayoutEffect(() => {
        const updatePosition = () => {
            if (!anchorElement || !menuRef.current) return;

            const anchorRect = anchorElement.getBoundingClientRect();
            const menuRect = menuRef.current.getBoundingClientRect();
            setPosition(calculateResourceMenuPosition(
                anchorRect,
                { width: menuRect.width, height: menuRect.height },
                { width: window.innerWidth, height: window.innerHeight }
            ));
        };
        const handlePointerDown = (event) => {
            if (menuRef.current?.contains(event.target)) return;
            if (anchorElement?.contains(event.target)) return;
            onClose();
        };
        const handleKeyDown = (event) => {
            if (event.key === "Escape") onClose();
        };

        updatePosition();
        document.addEventListener("pointerdown", handlePointerDown);
        document.addEventListener("keydown", handleKeyDown);
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);

        return () => {
            document.removeEventListener("pointerdown", handlePointerDown);
            document.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
        };
    }, [anchorElement, onClose]);

    const menuItems = (
        <>
            <button
                className={clsx(styles.gpu_menu_item, {
                    [styles.is_selected]: isAutoSelected,
                })}
                onClick={() => onSelectGpuMonitor({ mode: "auto", device_index: null })}
            >
                <span className={styles.gpu_menu_title}>{t("main_page.resource_monitor.auto")}</span>
                <span className={styles.gpu_menu_desc}>
                    AI GPU{selectedGpuIndex !== null && selectedGpuIndex !== undefined ? ` ${selectedGpuIndex}` : ""}
                </span>
            </button>
            {gpuDevices.map((device) => (
                <button
                    key={device.device_index}
                    className={clsx(styles.gpu_menu_item, {
                        [styles.is_selected]:
                            gpuMonitorSelection?.mode === "manual" &&
                            gpuMonitorSelection.device_index === device.device_index,
                    })}
                    onClick={() => onSelectGpuMonitor({ mode: "manual", device_index: device.device_index })}
                >
                    <span className={styles.gpu_menu_title}>GPU {device.device_index}</span>
                    <span className={styles.gpu_menu_desc}>{device.device_name}</span>
                </button>
            ))}
        </>
    );

    return createPortal(
        <div
            ref={menuRef}
            className={styles.gpu_menu}
            style={{ left: position.left, top: position.top }}
            onClick={(event) => event.stopPropagation()}
        >
            {menuItems}
        </div>,
        document.body
    );
};
