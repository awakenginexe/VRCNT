import React, { useEffect } from "react";
import { ToastContainer, toast, cssTransition } from "react-toastify";
import clsx from "clsx";

import "./ReactToastifyOverrideClass.scss";
import styles from "./SnackbarController.module.scss";

import WarningSvg from "@images/warning.svg?react";
import MegaphoneSvg from "@images/megaphone.svg?react";
import CheckMarkSvg from "@images/check_mark.svg?react";
import ErrorSvg from "@images/error.svg?react";
import XMarkSvg from "@images/cancel.svg?react";

import { useI18n } from "@useI18n";
import { useNotificationStatus } from "@logics_common";

const CustomTransition = cssTransition({
    enter: "fade_in",
    exit: "fade_out",
    collapse: false,
});


export const SnackbarController = () => {
    const { currentNotificationStatus, closeNotification } = useNotificationStatus();
    const { t } = useI18n();

    const settings = currentNotificationStatus.data;

    const snackbar_classname = clsx(
        styles.snackbar_content,
        {
            [styles.is_success]: settings.status === "success",
            [styles.is_warning]: settings.status === "warning",
            [styles.is_error]:   settings.status === "error",
        }
    );

    let hide_duration = 5000;
    if (settings.options?.hide_duration === null) {
        hide_duration = false;
    } else if (Number(settings.options?.hide_duration)) {
        hide_duration = Number(settings.options?.hide_duration);
    }


    useEffect(() => {
        if (!settings.is_open) return;

        const message_text = settings.message;
        const category_id = settings.category_id ? settings.category_id : message_text;

        const to_hide_progress_bar = settings.options?.to_hide_progress_bar === true;
        const timeoutId = window.setTimeout(() => {
            toast(message_text, {
                toastId: category_id,
                type: settings.status,
                autoClose: hide_duration,
                transition: CustomTransition,
                toastClassName: snackbar_classname,
                hideProgressBar: to_hide_progress_bar || hide_duration === false,
                progressClassName: styles.toast_progress,
                style: hide_duration === false ? undefined : {
                    "--vrcnt-notification-duration": `${hide_duration}ms`,
                },
                closeButton: ({ closeToast }) => (
                    <button
                        type="button"
                        className={styles.dismiss_button}
                        onClick={(event) => {
                            event.stopPropagation();
                            closeToast(true);
                        }}
                        aria-label={t("main_page.notifications.dismiss")}
                        title={t("main_page.notifications.dismiss")}
                    >
                        <XMarkSvg aria-hidden="true" className={styles.dismiss_icon} />
                    </button>
                ),
                onClose: () => {
                    closeNotification();
                },
            });
        }, 100);

        return () => window.clearTimeout(timeoutId);
    }, [settings, snackbar_classname, hide_duration, closeNotification, t]);

    return (
        <ToastContainer
            position="bottom-left"
            transition={CustomTransition}
            hideProgressBar={false}
            newestOnTop={false}
            closeOnClick={false}
            pauseOnFocusLoss={false}
            draggable={false}
            pauseOnHover={true}
            theme="dark"
            aria-label={t("main_page.notifications.label")}
            icon={({ type }) => {
                switch (type) {
                    case "info":
                        return <MegaphoneSvg className={styles.megaphone_svg} />;
                    case "error":
                        return <ErrorSvg className={styles.error_svg} />;
                    case "success":
                        return <CheckMarkSvg className={styles.check_mark_svg} />;
                    case "warning":
                        return <WarningSvg className={styles.warning_svg} />;
                    default:
                        return null;
                }
            }}
        />
    );
};
