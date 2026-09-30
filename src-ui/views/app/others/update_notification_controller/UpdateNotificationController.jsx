import { useEffect, useRef } from "react";
import { useStore_OpenedQuickSetting, useStore_InitStatus } from "@store";
import { useIsBackendReady } from "@logics_common";
import { useReleaseUpdates } from "@logics_common/useReleaseUpdates.js";

export const UpdateNotificationController = () => {
    const hasNotifiedRef = useRef(false);
    const { currentIsBackendReady } = useIsBackendReady();
    const { info, status } = useReleaseUpdates({ enabled: currentIsBackendReady.data === true });
    const { currentInitStatus } = useStore_InitStatus();
    const { currentOpenedQuickSetting, updateOpenedQuickSetting } = useStore_OpenedQuickSetting();

    useEffect(() => {
        if (currentIsBackendReady.data !== true) return;
        if (!["ready", "error"].includes(status)) return;
        if (currentInitStatus.data.visible || currentOpenedQuickSetting.data) return;
        if (info.is_update_available !== true) return;
        if (hasNotifiedRef.current === true) return;

        hasNotifiedRef.current = true;
        updateOpenedQuickSetting("update_software");
    }, [
        currentIsBackendReady.data,
        info.is_update_available,
        status,
        currentInitStatus.data.visible,
        currentOpenedQuickSetting.data,
        updateOpenedQuickSetting,
    ]);

    return null;
};
