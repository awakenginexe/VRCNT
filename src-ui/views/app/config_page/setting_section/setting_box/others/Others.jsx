import { useEffect, useState } from "react";
import { useI18n } from "@useI18n";
import styles from "./Others.module.scss";

import {
    useOpenFolder,
    useIsOscAvailable,
} from "@logics_common";
import { isTauriRuntime } from "@logics_common/tauriRuntime.js";
import {
    disableStartWithVrchat,
    enableStartWithVrchat,
    getStartWithVrchatStatus,
} from "@logics_common/startWithVrchat.js";
import {
    confirmStartWithVrchatRegistration,
    createInitialStartWithVrchatState,
    createStartWithVrchatCheckboxProps,
    createUnknownStartWithVrchatState,
    dismissStartWithVrchatConfirmation,
    getStartWithVrchatConfirmationOutcome,
    readStartWithVrchatStatus,
    reconcileStartWithVrchatMutation,
    requestStartWithVrchatChange,
    shouldShowStartWithVrchatStatusError,
} from "./startWithVrchatSettingsState.js";
import { useStore_OpenedQuickSetting } from "@store";

import {
    useOthers,
    useOnboarding,
} from "@logics_configs";

import {
    CheckboxContainer,
    MessageFormatContainer,
} from "../_templates/Templates";

import {
    LabelComponent,
    ActionButton,
    SectionLabelComponent,
} from "../_components";
import { Checkbox } from "@common_components";

import OpenFolderSvg from "@images/open_folder.svg?react";
import { RuntimeSettings } from "./RuntimeSettings";

export const Others = () => {
    const { t } = useI18n();

    return (
        <div className={styles.container}>
            <div>
                <AutoClearMessageInputBoxContainer />
                <SendOnlyTranslatedMessagesContainer />
                <SendOriginalWhileTranslatingContainer />
                <AutoExportMessageLogsContainer />
                <VrcMicMuteSyncContainer />
                <SendMessageToVrcContainer />
            </div>
            <div>
                <SectionLabelComponent label={t("config_page.others.section_label_sounds")} />
                <EnableNotificationVrcSfxContainer />
            </div>
            <div>
                <SectionLabelComponent label="Speaker2Chatbox" />
                <SendReceivedMessageToVrcContainer />
            </div>
            <div>
                <SectionLabelComponent label={t("config_page.others.section_label_message_formats")} />
                <SendMessageFormatPartsContainer />
                <ReceivedMessageFormatPartsContainer />
            </div>
            <div>
                <ConvertMessageToRomajiContainer />
                <ConvertMessageToHiraganaContainer />
            </div>
            <div>
                <SectionLabelComponent label={t("config_page.others.section_label_startup")} />
                <QuickWakeUpContainer />
                <StartWithVrchatContainer />
            </div>
            <div>
                <RuntimeSettings />
            </div>
            <div>
                <TelemetryContainer />
            </div>
        </div>
    );
};

const QuickWakeUpContainer = () => {
    const { t } = useI18n();
    const { currentEnableQuickWakeUp, toggleEnableQuickWakeUp } = useOnboarding();

    return (
        <CheckboxContainer
            label={t("config_page.others.quick_wake_up.label")}
            desc={t("config_page.others.quick_wake_up.desc")}
            variable={currentEnableQuickWakeUp}
            toggleFunction={toggleEnableQuickWakeUp}
        />
    );
};

const StartWithVrchatContainer = () => {
    const { t } = useI18n();
    const { currentOpenedQuickSetting, updateOpenedQuickSetting } = useStore_OpenedQuickSetting();
    const isTauri = isTauriRuntime();
    const [startWithVrchatState, setStartWithVrchatState] = useState(() => createInitialStartWithVrchatState(isTauri));
    const [error, setError] = useState("");

    useEffect(() => {
        let isCurrent = true;

        const refreshRegistration = async () => {
            if (!isTauri) {
                if (isCurrent) {
                    setStartWithVrchatState(createInitialStartWithVrchatState(false));
                    setError("");
                }
                return;
            }

            const nextState = await readStartWithVrchatStatus({
                isTauri,
                getRegistrationStatus: getStartWithVrchatStatus,
            });
            if (isCurrent) {
                setStartWithVrchatState(nextState);
                setError(shouldShowStartWithVrchatStatusError({ isTauri, state: nextState })
                    ? t("config_page.others.start_with_vrchat.status_failed")
                    : "");
            }
        };

        refreshRegistration();
        return () => {
            isCurrent = false;
        };
    }, [currentOpenedQuickSetting.data, isTauri, t]);

    const toggleStartWithVrchat = async () => {
        const requestedChange = await requestStartWithVrchatChange({
            registration: startWithVrchatState.registration,
            isInteractive: isTauri && startWithVrchatState.isInteractive,
            onRequestConfirmation: () => updateOpenedQuickSetting("start_with_vrchat"),
        });

        if (requestedChange.type !== "disable") return;

        setStartWithVrchatState(createUnknownStartWithVrchatState());
        setError("");
        const result = await reconcileStartWithVrchatMutation({
            changeRegistration: disableStartWithVrchat,
            getRegistrationStatus: getStartWithVrchatStatus,
        });
        setStartWithVrchatState(result.state);
        if (result.hasError || result.state.registration) {
            setError(t("config_page.others.start_with_vrchat.status_failed"));
        }
    };

    const checkboxProps = createStartWithVrchatCheckboxProps({
        isTauri,
        startWithVrchatState,
    });

    return (
        <div>
            <CheckboxContainer
                label={t("config_page.others.start_with_vrchat.label")}
                desc={t("config_page.others.start_with_vrchat.desc")}
                {...checkboxProps}
                toggleFunction={toggleStartWithVrchat}
            />
            {error && <p className={styles.start_with_vrchat_error} role="alert">{error}</p>}
        </div>
    );
};

export const StartWithVrchatConfirmationModal = ({ onSavingChange = () => {} }) => {
    const { t } = useI18n();
    const { updateOpenedQuickSetting } = useStore_OpenedQuickSetting();
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState("");

    const closeModal = () => {
        dismissStartWithVrchatConfirmation({
            isSaving,
            closeModal: () => updateOpenedQuickSetting(""),
        });
    };

    const confirmStartWithVrchat = async () => {
        setIsSaving(true);
        onSavingChange(true);
        setError("");
        try {
            const result = await confirmStartWithVrchatRegistration({
                enableRegistration: enableStartWithVrchat,
                getRegistrationStatus: getStartWithVrchatStatus,
            });
            const outcome = getStartWithVrchatConfirmationOutcome(result);
            if (outcome.shouldClose) {
                updateOpenedQuickSetting("");
                return;
            }
            if (outcome.shouldShowError) {
                setError(t("config_page.others.start_with_vrchat.confirmation.enable_failed"));
            }
        } catch {
            setError(t("config_page.others.start_with_vrchat.confirmation.enable_failed"));
        } finally {
            setIsSaving(false);
            onSavingChange(false);
        }
    };

    const onKeyDown = (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            closeModal();
        }
    };

    return (
        <section
            className={styles.start_with_vrchat_confirmation}
            role="dialog"
            aria-modal="true"
            aria-labelledby="start-with-vrchat-confirmation-title"
            aria-describedby="start-with-vrchat-confirmation-detail"
            onKeyDown={onKeyDown}
        >
            <h2 id="start-with-vrchat-confirmation-title">
                {t("config_page.others.start_with_vrchat.confirmation.title")}
            </h2>
            <p id="start-with-vrchat-confirmation-detail">
                {t("config_page.others.start_with_vrchat.confirmation.detail")}
            </p>
            {error && <p className={styles.start_with_vrchat_error} role="alert">{error}</p>}
            <div className={styles.start_with_vrchat_confirmation_actions}>
                <button type="button" onClick={closeModal} disabled={isSaving} autoFocus>
                    {t("config_page.others.start_with_vrchat.confirmation.cancel")}
                </button>
                <button type="button" onClick={confirmStartWithVrchat} disabled={isSaving}>
                    {t("config_page.others.start_with_vrchat.confirmation.confirm")}
                </button>
            </div>
        </section>
    );
};

const AutoClearMessageInputBoxContainer = () => {
    const { t } = useI18n();
    const { currentEnableAutoClearMessageInputBox, toggleEnableAutoClearMessageInputBox } = useOthers();

    return (
        <CheckboxContainer
            label={t("config_page.others.auto_clear_the_message_box.label")}
            variable={currentEnableAutoClearMessageInputBox}
            toggleFunction={toggleEnableAutoClearMessageInputBox}
        />
    );
};
const SendOnlyTranslatedMessagesContainer = () => {
    const { t } = useI18n();
    const { currentEnableSendOnlyTranslatedMessages, toggleEnableSendOnlyTranslatedMessages } = useOthers();

    return (
        <CheckboxContainer
            label={t("config_page.others.send_only_translated_messages.label")}
            variable={currentEnableSendOnlyTranslatedMessages}
            toggleFunction={toggleEnableSendOnlyTranslatedMessages}
        />
    );
};
const SendOriginalWhileTranslatingContainer = () => {
    const { t } = useI18n();
    const {
        currentEnableSendOriginalWhileTranslating,
        toggleEnableSendOriginalWhileTranslating,
    } = useOthers();

    return (
        <CheckboxContainer
            label={t("config_page.others.send_original_while_translating.label")}
            desc={t("config_page.others.send_original_while_translating.desc")}
            variable={currentEnableSendOriginalWhileTranslating}
            toggleFunction={toggleEnableSendOriginalWhileTranslating}
        />
    );
};
const AutoExportMessageLogsContainer = () => {
    const { t } = useI18n();
    const { currentEnableAutoExportMessageLogs, toggleEnableAutoExportMessageLogs } = useOthers();
    const { openFolder_MessageLogs } = useOpenFolder();

    return (
        <div className={styles.auto_export_message_logs_container}>
            <LabelComponent
                label={t("config_page.others.auto_export_message_logs.label")}
                desc={t("config_page.others.auto_export_message_logs.desc")}
                />
            <div className={styles.auto_export_message_logs_switch_section_container}>
                <ActionButton
                    IconComponent={OpenFolderSvg}
                    onclickFunction={openFolder_MessageLogs}
                />
                <Checkbox
                    variable={currentEnableAutoExportMessageLogs}
                    toggleFunction={toggleEnableAutoExportMessageLogs}
                />
            </div>
        </div>
    );
};
export const VrcMicMuteSyncContainer = () => {
    const { t } = useI18n();
    const { currentEnableVrcMicMuteSync, toggleEnableVrcMicMuteSync } = useOthers();
    const { currentIsOscAvailable } = useIsOscAvailable();

    const add_warnings = [];
    if (currentIsOscAvailable.data === false) {
        add_warnings.push({
            label: t("config_page.common.warning_labels.unable_to_use_osc_query"),
        });
    }

    return (
        <CheckboxContainer
            label={t("config_page.others.vrc_mic_mute_sync.label")}
            desc={t("config_page.others.vrc_mic_mute_sync.desc")}
            variable={currentEnableVrcMicMuteSync}
            is_available={currentIsOscAvailable.data}
            add_warnings={add_warnings}
            toggleFunction={toggleEnableVrcMicMuteSync}
        />
    );
};
const SendMessageToVrcContainer = () => {
    const { t } = useI18n();
    const { currentEnableSendMessageToVrc, toggleEnableSendMessageToVrc } = useOthers();

    return (
        <CheckboxContainer
            label={t("config_page.others.send_message_to_vrc.label")}
            desc={t("config_page.others.send_message_to_vrc.desc")}
            variable={currentEnableSendMessageToVrc}
            toggleFunction={toggleEnableSendMessageToVrc}
        />
    );
};


const EnableNotificationVrcSfxContainer = () => {
    const { t } = useI18n();
    const { currentEnableNotificationVrcSfx, toggleEnableNotificationVrcSfx } = useOthers();

    return (
        <CheckboxContainer
            label={t("config_page.others.notification_vrc_sfx.label")}
            desc={t("config_page.others.notification_vrc_sfx.desc")}
            variable={currentEnableNotificationVrcSfx}
            toggleFunction={toggleEnableNotificationVrcSfx}
        />
    );
};

const SendReceivedMessageToVrcContainer = () => {
    const { t } = useI18n();
    const { currentEnableSendReceivedMessageToVrc, toggleEnableSendReceivedMessageToVrc } = useOthers();

    return (
        <CheckboxContainer
            label={t("config_page.others.send_received_message_to_vrc.label")}
            desc={t("config_page.others.send_received_message_to_vrc.desc")}
            variable={currentEnableSendReceivedMessageToVrc}
            toggleFunction={toggleEnableSendReceivedMessageToVrc}
        />
    );
};

const SendMessageFormatPartsContainer = () => {
    const { t } = useI18n();
    const {
        currentSendMessageFormatParts,
        setSendMessageFormatParts,
    } = useOthers();

    return (
        <MessageFormatContainer
            label={t("config_page.others.send_message_format.label")}
            desc={t("config_page.others.send_message_format.desc")}
            variable={currentSendMessageFormatParts}
            setFunction={setSendMessageFormatParts}
            format_id="send"
        />
    );
};

const ReceivedMessageFormatPartsContainer = () => {
    const { t } = useI18n();
    const {
        currentReceivedMessageFormatParts,
        setReceivedMessageFormatParts,
    } = useOthers();

    return (
        <MessageFormatContainer
            label={t("config_page.others.received_message_format.label")}
            desc={t("config_page.others.received_message_format.desc")}
            variable={currentReceivedMessageFormatParts}
            setFunction={setReceivedMessageFormatParts}
            format_id="received"
        />
    );
};

const ConvertMessageToRomajiContainer = () => {
    const { t } = useI18n();
    const { currentConvertMessageToRomaji, toggleConvertMessageToRomaji } = useOthers();

    const desc_1 = t("config_page.others.common_convert_message_hiragana_romaji.desc_1");
    const desc_2 = t("config_page.others.common_convert_message_hiragana_romaji.desc_2");
    const desc_romaji = t(
        "config_page.others.convert_message_to_romaji.desc",
        { convert_message_to_hiragana: t("config_page.others.convert_message_to_hiragana.label") }
    );
    const desc = [desc_1, desc_2, desc_romaji].join("\n");

    return (
        <CheckboxContainer
            label={t("config_page.others.convert_message_to_romaji.label")}
            desc={desc}
            variable={currentConvertMessageToRomaji}
            toggleFunction={toggleConvertMessageToRomaji}
        />
    );
};

const ConvertMessageToHiraganaContainer = () => {
    const { t } = useI18n();
    const { currentConvertMessageToHiragana, toggleConvertMessageToHiragana } = useOthers();

    const desc_1 = t("config_page.others.common_convert_message_hiragana_romaji.desc_1");
    const desc_2 = t("config_page.others.common_convert_message_hiragana_romaji.desc_2");
    const desc = [desc_1, desc_2].join("\n");

    return (
        <CheckboxContainer
            label={t("config_page.others.convert_message_to_hiragana.label")}
            desc={desc}
            variable={currentConvertMessageToHiragana}
            toggleFunction={toggleConvertMessageToHiragana}
        />
    );
};

const TelemetryContainer = () => {
    const { t } = useI18n();
    const { currentTelemetry, toggleTelemetry } = useOthers();

    return (
        <CheckboxContainer
            label={t("config_page.others.telemetry.label")}
            webpage_url="https://aptabase.com/legal/privacy"
            open_webpage_label={t("config_page.others.telemetry.aptabase_privacy_policy_label")}
            desc={t("config_page.others.telemetry.desc")}
            variable={currentTelemetry}
            toggleFunction={toggleTelemetry}
        />
    );
};
