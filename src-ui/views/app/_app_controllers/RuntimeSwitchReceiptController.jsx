import { useEffect, useRef } from "react";

import { useI18n } from "@useI18n";
import { useNotificationStatus } from "@logics_common";
import { consumePersistedRuntimeSwitch, consumeRuntimeSwitchReceipt, getRuntimeState } from "@logics_common/runtimeManager.js";

export const RuntimeSwitchReceiptController = () => {
    const { t } = useI18n();
    const { showNotification_Success, showNotification_Error } = useNotificationStatus();
    const hasConsumedRef = useRef(false);

    useEffect(() => {
        if (hasConsumedRef.current) return;
        hasConsumedRef.current = true;
        let isCurrent = true;
        consumePersistedRuntimeSwitch({
            consumeReceipt: consumeRuntimeSwitchReceipt,
            refreshRuntime: getRuntimeState,
        }).then(({ status, isTerminal }) => {
            if (!isCurrent || !isTerminal) return;
            if (status.status === "succeeded") {
                showNotification_Success(t("config_page.others.runtime.switch_complete"), {
                    category_id: "runtime_switch_complete",
                });
                return;
            }
            showNotification_Error(t("config_page.others.runtime.switch_failed"), {
                hide_duration: null,
                category_id: "runtime_switch_recovery",
            });
        }).catch(() => {
            if (!isCurrent) return;
            showNotification_Error(t("config_page.others.runtime.recovery"), {
                hide_duration: null,
                category_id: "runtime_switch_recovery",
            });
        });
        return () => {
            isCurrent = false;
        };
    }, [showNotification_Error, showNotification_Success, t]);

    return null;
};
