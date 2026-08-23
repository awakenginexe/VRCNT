import { useState } from "react";
import styles from "./ModalController.module.scss";
import { useStore_OpenedQuickSetting } from "@store";
import { Vr, VrcMicMuteSyncContainer } from "@setting_box";
import { StartWithVrchatConfirmationModal } from "../../config_page/setting_section/setting_box/others/Others";
import { dismissStartWithVrchatConfirmation } from "../../config_page/setting_section/setting_box/others/startWithVrchatSettingsState.js";
import { UpdateModal } from "./update_modal/UpdateModal";

export const ModalController = () => {
    const { currentOpenedQuickSetting, updateOpenedQuickSetting } = useStore_OpenedQuickSetting();
    const [isStartWithVrchatSaving, setIsStartWithVrchatSaving] = useState(false);
    if (currentOpenedQuickSetting.data === "") return null;
    return (
        <div className={styles.container}>
            <div
                className={styles.bg_onclick_close_area}
                onClick={() => dismissStartWithVrchatConfirmation({
                    isSaving: currentOpenedQuickSetting.data === "start_with_vrchat" && isStartWithVrchatSaving,
                    closeModal: () => updateOpenedQuickSetting(""),
                })}
            ></div>
            <div className={styles.wrapper}>
                <QuickSettingsController onStartWithVrchatSavingChange={setIsStartWithVrchatSaving} />
            </div>
        </div>
    );
};

const QuickSettingsController = ({ onStartWithVrchatSavingChange }) => {
    const { currentOpenedQuickSetting, updateOpenedQuickSetting } = useStore_OpenedQuickSetting();

    switch (currentOpenedQuickSetting.data) {
        case "vrc_mic_mute_sync":
            return <VrcMicMuteSyncContainer />;
        case "overlay":
            return <Vr />;
        case "update_software":
            return <UpdateModal />;
        case "start_with_vrchat":
            return <StartWithVrchatConfirmationModal onSavingChange={onStartWithVrchatSavingChange} />;
        default:
            return null;
    }
};
