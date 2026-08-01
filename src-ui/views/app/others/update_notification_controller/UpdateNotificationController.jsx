import { useEffect, useRef } from "react";
import { useI18n } from "@useI18n";
import { useStore_OpenedQuickSetting } from "@store";
import {
    useIsBackendReady,
    useNotificationStatus,
    useSoftwareVersion,
} from "@logics_common";

export const UpdateNotificationController = () => {
    const hasNotifiedRef = useRef(false);
    const { currentIsBackendReady } = useIsBackendReady();
    const { currentLatestSoftwareVersionInfo } = useSoftwareVersion();
    const { showNotification_Warning } = useNotificationStatus();
    const { updateOpenedQuickSetting } = useStore_OpenedQuickSetting();
    const { t } = useI18n();

    useEffect(() => {
        if (currentIsBackendReady.data !== true) return;
        if (currentLatestSoftwareVersionInfo.data.is_update_available !== true) return;
        if (hasNotifiedRef.current === true) return;

        hasNotifiedRef.current = true;
        showNotification_Warning(
            t("main_page.update_available_detail", {
                version: currentLatestSoftwareVersionInfo.data.new_version,
            }),
            {
                category_id: "software_update_available",
                hide_duration: 10000,
            },
        );
        updateOpenedQuickSetting("update_software");
    }, [
        currentIsBackendReady.data,
        currentLatestSoftwareVersionInfo.data.is_update_available,
        currentLatestSoftwareVersionInfo.data.new_version,
        showNotification_Warning,
        updateOpenedQuickSetting,
        t,
    ]);

    return null;
};
