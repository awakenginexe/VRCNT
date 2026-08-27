import { useI18n } from "@useI18n";
import {
    useAdvancedSettings,
    useOthers,
    useSaveButtonLogic,
} from "@logics_configs";
import { useIsOscAvailable } from "@logics_common";
import {
    EntryWithSaveButtonContainer,
    MessageFormatContainer,
} from "../../config_page/setting_section/setting_box/_templates/Templates";
import { TopBar } from "../main_section/top_bar/TopBar";
import styles from "./OscStudio.module.scss";

const ToggleCard = ({
    label,
    desc,
    variable,
    toggleFunction,
    available = true,
    statusEnabled = "Active",
    statusDisabled = "Disabled",
}) => {
    const isActive = variable.data === true;
    const isPending = variable.state === "pending";

    return (
        <button
            type="button"
            className={styles.toggle_card}
            data-active={isActive}
            data-available={available}
            disabled={!available || isPending}
            onClick={() => {
                if (available && !isPending) toggleFunction();
            }}
            aria-pressed={isActive}
        >
            <div className={styles.toggle_card_info}>
                <div className={styles.toggle_title_row}>
                    <span className={styles.toggle_title}>{label}</span>
                    <span className={styles.status_badge} data-active={isActive}>
                        {isActive ? statusEnabled : statusDisabled}
                    </span>
                </div>
                {desc && <p className={styles.toggle_desc}>{desc}</p>}
            </div>
            <div
                className={styles.toggle_switch}
                data-active={isActive}
                data-pending={isPending}
                aria-hidden="true"
            >
                <span className={styles.switch_thumb} />
            </div>
        </button>
    );
};

const OriginalOrderPicker = ({ variable, toggleFunction, t }) => {
    const originalFirst = variable.data === true;
    const isPending = variable.state === "pending";

    const choose = (nextOriginalFirst) => {
        if (originalFirst !== nextOriginalFirst) toggleFunction();
    };

    return (
        <div className={styles.order_panel}>
            <div>
                <p className={styles.section_kicker}>{t("main_page.osc_studio.delivery_kicker")}</p>
                <h3>{t("main_page.osc_studio.delivery_title")}</h3>
                <p>{t("main_page.osc_studio.delivery_detail")}</p>
            </div>
            <div className={styles.order_picker} role="group" aria-label={t("main_page.osc_studio.delivery_title")}>
                <button
                    type="button"
                    className={styles.order_option}
                    data-active={originalFirst}
                    aria-pressed={originalFirst}
                    disabled={isPending}
                    onClick={() => choose(true)}
                >
                    <span>{t("main_page.live_workspace.original_first")}</span>
                    <small>{t("main_page.osc_studio.original_first_detail")}</small>
                </button>
                <button
                    type="button"
                    className={styles.order_option}
                    data-active={!originalFirst}
                    aria-pressed={!originalFirst}
                    disabled={isPending}
                    onClick={() => choose(false)}
                >
                    <span>{t("main_page.live_workspace.translation_first")}</span>
                    <small>{t("main_page.osc_studio.translation_first_detail")}</small>
                </button>
            </div>
        </div>
    );
};

const OscIpAddressField = () => {
    const { t } = useI18n();
    const { currentOscIpAddress, setOscIpAddress } = useAdvancedSettings();
    const { variable, onChangeFunction, saveFunction } = useSaveButtonLogic({
        variable: currentOscIpAddress.data,
        state: currentOscIpAddress.state,
        setFunction: setOscIpAddress,
    });

    return (
        <EntryWithSaveButtonContainer
            label={t("config_page.advanced_settings.osc_ip_address.label")}
            variable={variable}
            saveFunction={saveFunction}
            onChangeFunction={onChangeFunction}
            state={currentOscIpAddress.state}
            width="14rem"
        />
    );
};

const OscPortField = () => {
    const { t } = useI18n();
    const { currentOscPort, setOscPort } = useAdvancedSettings();
    const { variable, onChangeFunction: rawOnChange, saveFunction } = useSaveButtonLogic({
        variable: currentOscPort.data,
        state: currentOscPort.state,
        setFunction: setOscPort,
    });

    return (
        <EntryWithSaveButtonContainer
            label={t("config_page.advanced_settings.osc_port.label")}
            variable={variable}
            saveFunction={saveFunction}
            onChangeFunction={(value) => rawOnChange(value.replace(/[^0-9]/g, ""))}
            state={currentOscPort.state}
            width="10rem"
        />
    );
};

export const OscStudio = () => {
    const { t } = useI18n();
    const { currentIsOscAvailable } = useIsOscAvailable();
    const { currentOscIpAddress, currentOscPort } = useAdvancedSettings();
    const {
        currentEnableSendMessageToVrc,
        toggleEnableSendMessageToVrc,
        currentEnableSendReceivedMessageToVrc,
        toggleEnableSendReceivedMessageToVrc,
        currentEnableSendOriginalWhileTranslating,
        toggleEnableSendOriginalWhileTranslating,
        currentEnableNotificationVrcSfx,
        toggleEnableNotificationVrcSfx,
        currentEnableVrcMicMuteSync,
        toggleEnableVrcMicMuteSync,
        currentSendMessageFormatParts,
        setSendMessageFormatParts,
        currentReceivedMessageFormatParts,
        setReceivedMessageFormatParts,
    } = useOthers();

    const oscAvailable = currentIsOscAvailable.data === true;
    const oscPending = currentIsOscAvailable.data == null;

    const statusEnabled = t("main_page.osc_studio.status_enabled");
    const statusDisabled = t("main_page.osc_studio.status_disabled");

    return (
        <div className={styles.page}>
            <TopBar />
            <main className={styles.content} data-onboarding-target="tour-workspace">
                <header className={styles.hero}>
                    <div>
                        <p className={styles.eyebrow}>{t("main_page.osc_studio.eyebrow")}</p>
                        <h1>{t("main_page.osc_studio.title")}</h1>
                        <p>{t("main_page.osc_studio.detail")}</p>
                    </div>
                    <div className={styles.connection_badge} data-available={oscAvailable} data-pending={oscPending}>
                        <span className={styles.connection_dot} aria-hidden="true" />
                        <span>{t(oscPending
                            ? "main_page.osc_studio.connection_checking"
                            : oscAvailable
                                ? "main_page.osc_studio.connection_available"
                                : "main_page.osc_studio.connection_unavailable")}</span>
                    </div>
                </header>

                <section className={styles.status_strip} aria-label={t("main_page.osc_studio.connection_title")}>
                    <div className={styles.status_icon} aria-hidden="true">◈</div>
                    <div>
                        <p className={styles.section_kicker}>{t("main_page.osc_studio.connection_kicker")}</p>
                        <h2>{t("main_page.osc_studio.connection_title")}</h2>
                        <p>{t("main_page.osc_studio.connection_detail")}</p>
                    </div>
                    <div className={styles.endpoint}>
                        <span>{t("main_page.osc_studio.endpoint_label")}</span>
                        <strong>{currentOscIpAddress.data}:{currentOscPort.data}</strong>
                    </div>
                </section>

                <div className={styles.workspace_grid}>
                    <section className={styles.card} aria-labelledby="osc-chatbox-title">
                        <div className={styles.card_header}>
                            <div>
                                <p className={styles.section_kicker}>{t("main_page.osc_studio.chatbox_kicker")}</p>
                                <h2 id="osc-chatbox-title">{t("main_page.osc_studio.chatbox_title")}</h2>
                                <p>{t("main_page.osc_studio.chatbox_detail")}</p>
                            </div>
                            <span className={styles.card_number}>01</span>
                        </div>

                        <ToggleCard
                            label={t("main_page.osc_studio.send_chatbox_label")}
                            desc={t("main_page.osc_studio.send_chatbox_desc")}
                            variable={currentEnableSendMessageToVrc}
                            toggleFunction={toggleEnableSendMessageToVrc}
                            statusEnabled={statusEnabled}
                            statusDisabled={statusDisabled}
                        />
                        <OriginalOrderPicker
                            variable={currentEnableSendOriginalWhileTranslating}
                            toggleFunction={toggleEnableSendOriginalWhileTranslating}
                            t={t}
                        />
                        <div className={styles.compact_grid}>
                            <ToggleCard
                                label={t("main_page.osc_studio.notification_sfx_label")}
                                desc={t("main_page.osc_studio.notification_sfx_desc")}
                                variable={currentEnableNotificationVrcSfx}
                                toggleFunction={toggleEnableNotificationVrcSfx}
                                statusEnabled={statusEnabled}
                                statusDisabled={statusDisabled}
                            />
                            <ToggleCard
                                label={t("main_page.osc_studio.mic_mute_sync_label")}
                                desc={t("main_page.osc_studio.mic_mute_sync_desc")}
                                variable={currentEnableVrcMicMuteSync}
                                available={oscAvailable}
                                toggleFunction={toggleEnableVrcMicMuteSync}
                                statusEnabled={statusEnabled}
                                statusDisabled={statusDisabled}
                            />
                        </div>
                        <div className={styles.format_block}>
                            <p className={styles.section_kicker}>{t("main_page.osc_studio.format_kicker")}</p>
                            <MessageFormatContainer
                                label={t("config_page.others.send_message_format.label")}
                                desc={t("config_page.others.send_message_format.desc")}
                                variable={currentSendMessageFormatParts}
                                setFunction={setSendMessageFormatParts}
                                format_id="send"
                            />
                        </div>
                    </section>

                    <section className={styles.card} aria-labelledby="osc-speaker-title">
                        <div className={styles.card_header}>
                            <div>
                                <p className={styles.section_kicker}>{t("main_page.osc_studio.speaker_kicker")}</p>
                                <h2 id="osc-speaker-title">{t("main_page.osc_studio.speaker_title")}</h2>
                                <p>{t("main_page.osc_studio.speaker_detail")}</p>
                            </div>
                            <span className={styles.card_number}>02</span>
                        </div>
                        <ToggleCard
                            label={t("main_page.osc_studio.received_chatbox_label")}
                            desc={t("main_page.osc_studio.received_chatbox_desc")}
                            variable={currentEnableSendReceivedMessageToVrc}
                            toggleFunction={toggleEnableSendReceivedMessageToVrc}
                            statusEnabled={statusEnabled}
                            statusDisabled={statusDisabled}
                        />
                        <div className={styles.format_block}>
                            <p className={styles.section_kicker}>{t("main_page.osc_studio.format_kicker")}</p>
                            <MessageFormatContainer
                                label={t("config_page.others.received_message_format.label")}
                                desc={t("config_page.others.received_message_format.desc")}
                                variable={currentReceivedMessageFormatParts}
                                setFunction={setReceivedMessageFormatParts}
                                format_id="received"
                            />
                        </div>
                    </section>

                    <section className={`${styles.card} ${styles.network_card}`} aria-labelledby="osc-network-title">
                        <div className={styles.card_header}>
                            <div>
                                <p className={styles.section_kicker}>{t("main_page.osc_studio.network_kicker")}</p>
                                <h2 id="osc-network-title">{t("main_page.osc_studio.network_title")}</h2>
                                <p>{t("main_page.osc_studio.network_detail")}</p>
                            </div>
                            <span className={styles.card_number}>03</span>
                        </div>
                        <div className={styles.network_fields}>
                            <OscIpAddressField />
                            <OscPortField />
                        </div>
                        <p className={styles.sync_note}>{t("main_page.osc_studio.sync_note")}</p>
                    </section>
                </div>
            </main>
        </div>
    );
};
