import { useEffect, useRef, useState } from "react";
import styles from "./ModalController.module.scss";
import { useStore_OpenedQuickSetting } from "@store";
import { Vr, VrcMicMuteSyncContainer } from "@setting_box";
import { StartWithVrchatConfirmationModal } from "../../config_page/setting_section/setting_box/others/Others";
import { dismissStartWithVrchatConfirmation } from "../../config_page/setting_section/setting_box/others/startWithVrchatSettingsState.js";
import { UpdateModal } from "./update_modal/UpdateModal";

export const ModalController = () => {
    const { currentOpenedQuickSetting, updateOpenedQuickSetting } = useStore_OpenedQuickSetting();
    const [isStartWithVrchatSaving, setIsStartWithVrchatSaving] = useState(false);
    const [isUpdateInstalling, setIsUpdateInstalling] = useState(false);
    const wrapperRef = useRef(null);
    const isUpdateInstallingRef = useRef(false);
    const isStartWithVrchatSavingRef = useRef(false);
    const openedQuickSettingRef = useRef(currentOpenedQuickSetting.data);
    const updateOpenedQuickSettingRef = useRef(updateOpenedQuickSetting);
    const isOpen = currentOpenedQuickSetting.data !== "";
    isUpdateInstallingRef.current = isUpdateInstalling;
    isStartWithVrchatSavingRef.current = isStartWithVrchatSaving;
    openedQuickSettingRef.current = currentOpenedQuickSetting.data;
    updateOpenedQuickSettingRef.current = updateOpenedQuickSetting;

    useEffect(() => {
        if (!isOpen) return undefined;
        const previousFocus = document.activeElement;
        wrapperRef.current?.focus();

        const getFocusable = () => [...(wrapperRef.current?.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [])].filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");

        const handleKeyDown = (event) => {
            if (event.key === "Escape") {
                if (isUpdateInstallingRef.current) {
                    event.preventDefault();
                    return;
                }
                dismissStartWithVrchatConfirmation({
                    isSaving: openedQuickSettingRef.current === "start_with_vrchat" && isStartWithVrchatSavingRef.current,
                    closeModal: () => updateOpenedQuickSettingRef.current(""),
                });
                return;
            }
            if (event.key !== "Tab") return;

            const focusable = getFocusable();
            if (focusable.length === 0) {
                event.preventDefault();
                wrapperRef.current?.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && (
                document.activeElement === first
                || document.activeElement === wrapperRef.current
                || !wrapperRef.current?.contains(document.activeElement)
            )) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (
                document.activeElement === last
                || document.activeElement === wrapperRef.current
                || !wrapperRef.current?.contains(document.activeElement)
            )) {
                event.preventDefault();
                first.focus();
            }
        };

        const handleFocusIn = (event) => {
            if (!wrapperRef.current?.contains(event.target)) wrapperRef.current?.focus();
        };

        document.addEventListener("keydown", handleKeyDown);
        document.addEventListener("focusin", handleFocusIn);
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.removeEventListener("focusin", handleFocusIn);
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, [
        currentOpenedQuickSetting.data,
        isOpen,
    ]);

    if (currentOpenedQuickSetting.data === "") return null;

    const closeFromBackdrop = () => {
        if (isUpdateInstallingRef.current) return;
        dismissStartWithVrchatConfirmation({
            isSaving: currentOpenedQuickSetting.data === "start_with_vrchat" && isStartWithVrchatSavingRef.current,
            closeModal: () => updateOpenedQuickSetting(""),
        });
    };

    return (
        <div className={styles.container}>
            <div className={styles.bg_onclick_close_area} onClick={closeFromBackdrop}></div>
            <div
                className={styles.wrapper}
                ref={wrapperRef}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-label="VRCNT quick settings"
                aria-labelledby={currentOpenedQuickSetting.data === "update_software" ? "update-dialog-title" : undefined}
            >
                <QuickSettingsController
                    onStartWithVrchatSavingChange={setIsStartWithVrchatSaving}
                    onUpdateActivityChange={setIsUpdateInstalling}
                />
            </div>
        </div>
    );
};

const QuickSettingsController = ({ onStartWithVrchatSavingChange, onUpdateActivityChange }) => {
    const { currentOpenedQuickSetting, updateOpenedQuickSetting } = useStore_OpenedQuickSetting();

    switch (currentOpenedQuickSetting.data) {
        case "vrc_mic_mute_sync":
            return <VrcMicMuteSyncContainer />;
        case "overlay":
            return <Vr />;
        case "update_software":
            return <UpdateModal onUpdateActivityChange={onUpdateActivityChange} />;
        case "start_with_vrchat":
            return <StartWithVrchatConfirmationModal onSavingChange={onStartWithVrchatSavingChange} />;
        default:
            return null;
    }
};
