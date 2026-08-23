import { useRef, useState } from "react";
import clsx from "clsx";
import { useI18n } from "@useI18n";
import styles from "./TranscriptionEngineLabel.module.scss";
import { useTranscription } from "@logics_configs";
import { useStore_IsOpenedTranscriptionEngineSelector } from "@store";
import { TranscriptionEngineSelector } from "./transcription_engine_selector/TranscriptionEngineSelector";
import {
    getAllowedTranscriptionComputeTypes,
    getQuickDeviceOptions,
    getSelectedDeviceMode,
    isAutoOnlyTranscriptionEngine,
} from "../transcriptionRuntimeUtils.js";
import {
    getActiveModel,
    resolveLiveTranscriptionEngine,
    resolveLiveTranscriptionModel,
} from "../../../engines/transcriptionProfileUi.js";
import {
    TRANSCRIPTION_ENGINE_QUICK_PICK_ROLES,
    getQuickPickerProfile,
} from "./transcriptionEngineQuickPick.js";
import { getTranscriptionEngineMetadata } from "@logics_common/transcriptionEngineMetadata.js";
import { getTranscriptionEngineIconSource } from "@logics_common/transcriptionEngineIconSources.js";

const TranscriptionEngineIcon = ({ engine, className }) => {
    const metadata = getTranscriptionEngineMetadata(engine);
    return (
        <img
            className={className}
            src={getTranscriptionEngineIconSource(metadata.icon)}
            alt=""
            aria-hidden="true"
        />
    );
};

export const TranscriptionEngineLabel = ({ variant = "settings" }) => (
    variant === "settings"
        ? <TranscriptionEngineQuickPick />
        : variant === "live_compact"
            ? <LiveTranscriptionEngineQuickPick />
        : <LegacyTranscriptionEngineLabel variant={variant} />
);

const TranscriptionEngineQuickPick = () => {
    const { t } = useI18n();
    const {
        currentTranscriptionProfileSend,
        currentTranscriptionProfileReceive,
        currentSelectableTranscriptionComputeDeviceList,
        currentSelectedTranscriptionComputeDeviceSend,
        setSelectedTranscriptionComputeDeviceSend,
        currentSelectedTranscriptionComputeDeviceReceive,
        setSelectedTranscriptionComputeDeviceReceive,
        currentSelectedTranscriptionComputeTypeSend,
        setSelectedTranscriptionComputeTypeSend,
        currentSelectedTranscriptionComputeTypeReceive,
        setSelectedTranscriptionComputeTypeReceive,
    } = useTranscription();
    const {
        currentIsOpenedTranscriptionEngineSelector,
        updateIsOpenedTranscriptionEngineSelector,
    } = useStore_IsOpenedTranscriptionEngineSelector();
    const [openRole, setOpenRole] = useState(null);

    const sendProfile = currentTranscriptionProfileSend?.data ?? {};
    const receiveProfile = currentTranscriptionProfileReceive?.data ?? {};
    const deviceMap = currentSelectableTranscriptionComputeDeviceList?.data ?? {};
    const roleState = {
        speaking: {
            selectedDevice: currentSelectedTranscriptionComputeDeviceSend?.data ?? null,
            setDevice: setSelectedTranscriptionComputeDeviceSend,
            selectedComputeType: currentSelectedTranscriptionComputeTypeSend?.data ?? "auto",
            setComputeType: setSelectedTranscriptionComputeTypeSend,
        },
        listening: {
            selectedDevice: currentSelectedTranscriptionComputeDeviceReceive?.data ?? null,
            setDevice: setSelectedTranscriptionComputeDeviceReceive,
            selectedComputeType: currentSelectedTranscriptionComputeTypeReceive?.data ?? "auto",
            setComputeType: setSelectedTranscriptionComputeTypeReceive,
        },
    };

    const toggleRoleSelector = (role) => {
        const shouldOpen = currentIsOpenedTranscriptionEngineSelector.data !== true
            || openRole !== role;
        setOpenRole(shouldOpen ? role : null);
        updateIsOpenedTranscriptionEngineSelector(shouldOpen);
    };

    return (
        <div className={styles.container} data-variant="settings">
            <div className={styles.role_grid}>
                {TRANSCRIPTION_ENGINE_QUICK_PICK_ROLES.map((role) => {
                    const state = roleState[role.id];
                    const profile = getQuickPickerProfile(
                        role.id,
                        sendProfile,
                        receiveProfile,
                    );
                    const engine = profile.engine || t("main_page.language_panels.loading");
                    const model = getActiveModel(profile);
                    const selectorOpen = currentIsOpenedTranscriptionEngineSelector.data === true
                        && openRole === role.id;

                    return (
                        <TranscriptionEngineRoleCard
                            key={role.id}
                            role={role.id}
                            title={t(role.titleKey)}
                            engine={engine}
                            model={model}
                            deviceMap={deviceMap}
                            selectedDevice={state.selectedDevice}
                            selectedComputeType={state.selectedComputeType}
                            setDevice={state.setDevice}
                            setComputeType={state.setComputeType}
                            selectorOpen={selectorOpen}
                            onToggleSelector={() => toggleRoleSelector(role.id)}
                            t={t}
                        />
                    );
                })}
            </div>
        </div>
    );
};

const LiveTranscriptionEngineQuickPick = () => {
    const { t } = useI18n();
    const {
        currentTranscriptionProfileSend,
        currentTranscriptionProfileReceive,
    } = useTranscription();
    const {
        currentIsOpenedTranscriptionEngineSelector,
        updateIsOpenedTranscriptionEngineSelector,
    } = useStore_IsOpenedTranscriptionEngineSelector();
    const [openRole, setOpenRole] = useState(null);
    const speakingButtonRef = useRef(null);
    const listeningButtonRef = useRef(null);

    const sendProfile = currentTranscriptionProfileSend?.data ?? {};
    const receiveProfile = currentTranscriptionProfileReceive?.data ?? {};

    const toggleRoleSelector = (role) => {
        const shouldOpen = currentIsOpenedTranscriptionEngineSelector.data !== true
            || openRole !== role;
        setOpenRole(shouldOpen ? role : null);
        updateIsOpenedTranscriptionEngineSelector(shouldOpen);
    };

    return (
        <div className={styles.container} data-variant="live_compact">
            <div className={styles.live_role_grid}>
                {TRANSCRIPTION_ENGINE_QUICK_PICK_ROLES.map((role) => {
                    const profile = getQuickPickerProfile(
                        role.id,
                        sendProfile,
                        receiveProfile,
                    );
                    const engine = profile.engine || t("main_page.language_panels.loading");
                    const model = getActiveModel(profile);
                    const selectorOpen = currentIsOpenedTranscriptionEngineSelector.data === true
                        && openRole === role.id;
                    const title = t(role.titleKey);
                    const anchorRef = role.id === "speaking"
                        ? speakingButtonRef
                        : listeningButtonRef;

                    return (
                        <section
                            key={role.id}
                            className={styles.live_role_card}
                            data-group={role.id === "listening" ? "target" : "speaking"}
                            aria-label={title}
                        >
                            <button
                                type="button"
                                className={styles.live_role_button}
                                ref={anchorRef}
                                onClick={() => toggleRoleSelector(role.id)}
                                aria-expanded={selectorOpen}
                            >
                                <span className={styles.live_role_copy}>
                                    <span className={styles.live_role_heading}>{title}</span>
                                    <span className={styles.live_role_engine}>
                                        <TranscriptionEngineIcon
                                            engine={engine}
                                            className={styles.live_role_engine_icon}
                                        />
                                        <span className={styles.live_role_engine_name}>{engine}</span>
                                    </span>
                                    {model && (
                                        <span className={styles.live_role_model}>{model}</span>
                                    )}
                                </span>
                                <span className={styles.live_role_change}>
                                    {t("main_page.language_panels.change")}
                                </span>
                            </button>
                            {selectorOpen && (
                                <TranscriptionEngineSelector
                                    selected_id={engine}
                                    role={role.id}
                                    anchorRef={anchorRef}
                                    placement="live"
                                />
                            )}
                        </section>
                    );
                })}
            </div>
        </div>
    );
};

const TranscriptionEngineRoleCard = ({
    role,
    title,
    engine,
    model,
    deviceMap,
    selectedDevice,
    selectedComputeType,
    setDevice,
    setComputeType,
    selectorOpen,
    onToggleSelector,
    t,
}) => {
    const selectedMode = getSelectedDeviceMode(selectedDevice);
    const deviceOptions = getQuickDeviceOptions(deviceMap, engine);
    const activeDevice =
        deviceOptions.find((option) => option.id === selectedMode)?.device ??
        deviceOptions.find((option) => option.device)?.device ??
        selectedDevice;
    const computeTypeOptions = getAllowedTranscriptionComputeTypes({
        engine,
        device: activeDevice,
    });

    const selectDeviceMode = (mode) => {
        const target = deviceOptions.find((option) => option.id === mode);
        if (target?.device) setDevice(target.device);
    };

    return (
        <section className={styles.role_card} aria-label={title}>
            <button
                type="button"
                className={styles.engine_label_button}
                onClick={onToggleSelector}
                aria-expanded={selectorOpen}
            >
                <div className={styles.label_copy}>
                    <p className={styles.role_heading}>{title}</p>
                    <p className={styles.label_heading}>{t("main_page.language_panels.engine")}</p>
                    <span className={styles.engine_identity}>
                        <TranscriptionEngineIcon
                            engine={engine}
                            className={styles.engine_identity_icon}
                        />
                        <p className={styles.label_value}>{engine}</p>
                    </span>
                    {model && <p className={styles.model_value}>{model}</p>}
                </div>
                <p className={styles.edit_hint}>{t("main_page.language_panels.change")}</p>
            </button>

            <div className={styles.quick_switch_block}>
                <div className={styles.quick_switch_header}>
                    <p className={styles.quick_switch_title}>{t("main_page.language_panels.device")}</p>
                    <p className={styles.quick_switch_hint}>{t("main_page.language_panels.device_desc")}</p>
                </div>
                <div className={styles.option_row}>
                    {deviceOptions.map((option) => (
                        <button
                            key={option.id}
                            type="button"
                            className={clsx(styles.option_button, {
                                [styles.is_selected]: selectedMode === option.id,
                                [styles.is_disabled]: option.disabled,
                            })}
                            onClick={() => selectDeviceMode(option.id)}
                            disabled={option.disabled}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className={styles.quick_switch_block}>
                <div className={styles.quick_switch_header}>
                    <p className={styles.quick_switch_title}>{t("main_page.language_panels.processing_type")}</p>
                    <p className={styles.quick_switch_hint}>
                        {isAutoOnlyTranscriptionEngine(engine)
                            ? t("main_page.language_panels.processing_type_locked")
                            : t("main_page.language_panels.processing_type_whisper")}
                    </p>
                </div>
                <div className={styles.processing_scroll_area}>
                    <div className={styles.option_row}>
                        {computeTypeOptions.map((computeType) => (
                            <button
                                key={computeType}
                                type="button"
                                className={clsx(styles.option_button, styles.compute_type_button, {
                                    [styles.is_selected]: selectedComputeType === computeType,
                                })}
                                onClick={() => setComputeType(computeType)}
                            >
                                {computeType}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {selectorOpen && (
                <TranscriptionEngineSelector
                    selected_id={engine}
                    role={role}
                    placement="settings"
                />
            )}
        </section>
    );
};

const LegacyTranscriptionEngineLabel = ({ variant = "settings" }) => {
    const { t } = useI18n();
    const {
        currentSelectedTranscriptionEngine,
        currentTranscriptionProfileSend,
        currentTranscriptionProfileReceive,
        currentSelectableTranscriptionComputeDeviceList,
        currentSelectedTranscriptionComputeDevice,
        setSelectedTranscriptionComputeDevice,
        currentSelectedTranscriptionComputeType,
        setSelectedTranscriptionComputeType,
        currentSelectedWhisperWeightType,
        currentSelectedWhisperThaiWeightType,
        currentSelectedWhisperCloudModel,
        currentSelectedVoskWeightType,
        currentSelectedParakeetWeightType,
        currentSelectedSenseVoiceWeightType,
    } = useTranscription();

    const {
        currentIsOpenedTranscriptionEngineSelector,
        updateIsOpenedTranscriptionEngineSelector,
    } = useStore_IsOpenedTranscriptionEngineSelector();

    const engine = resolveLiveTranscriptionEngine({
        legacyEngine: currentSelectedTranscriptionEngine?.data,
        sendProfile: currentTranscriptionProfileSend?.data,
        receiveProfile: currentTranscriptionProfileReceive?.data,
    }) || t("main_page.language_panels.loading");
    const deviceMap = currentSelectableTranscriptionComputeDeviceList?.data ?? {};
    const selectedDevice = currentSelectedTranscriptionComputeDevice?.data ?? null;
    const selectedMode = getSelectedDeviceMode(selectedDevice);
    const deviceOptions = getQuickDeviceOptions(deviceMap, engine);
    const activeDevice =
        deviceOptions.find((option) => option.id === selectedMode)?.device ??
        deviceOptions.find((option) => option.device)?.device ??
        selectedDevice;
    const computeTypeOptions = getAllowedTranscriptionComputeTypes({
        engine,
        device: activeDevice,
    });
    const selectedComputeType = currentSelectedTranscriptionComputeType?.data ?? "auto";
    const legacyModelName =
        engine === "Whisper" ? currentSelectedWhisperWeightType?.data :
        engine === "Whisper Thai" ? currentSelectedWhisperThaiWeightType?.data :
        engine === "Whisper Cloud" ? currentSelectedWhisperCloudModel?.data :
        engine === "Vosk" ? currentSelectedVoskWeightType?.data :
        engine === "Parakeet" ? currentSelectedParakeetWeightType?.data :
        engine === "SenseVoice" ? currentSelectedSenseVoiceWeightType?.data :
        null;
    const currentModelName = resolveLiveTranscriptionModel({
        legacyEngine: currentSelectedTranscriptionEngine?.data,
        legacyModel: legacyModelName,
        sendProfile: currentTranscriptionProfileSend?.data,
        receiveProfile: currentTranscriptionProfileReceive?.data,
    });
    const liveModelLabel = currentModelName
        ? `${engine} · ${currentModelName}`
        : engine;

    const openSelector = () => {
        updateIsOpenedTranscriptionEngineSelector(!currentIsOpenedTranscriptionEngineSelector.data);
    };

    const selectDeviceMode = (mode) => {
        const target = deviceOptions.find((option) => option.id === mode);
        if (target?.device) setSelectedTranscriptionComputeDevice(target.device);
    };

    return (
        <div className={styles.container} data-variant={variant}>
            <button
                type="button"
                className={styles.engine_label_button}
                onClick={openSelector}
                aria-expanded={currentIsOpenedTranscriptionEngineSelector.data}
            >
                <div className={styles.label_copy}>
                    <p className={styles.label_heading}>{t("main_page.language_panels.engine")}</p>
                    <span className={styles.engine_identity}>
                        <TranscriptionEngineIcon
                            engine={engine}
                            className={styles.engine_identity_icon}
                        />
                        <p className={styles.label_value}>
                            {variant === "live_compact" ? liveModelLabel : engine}
                        </p>
                    </span>
                    {variant !== "live_compact" && currentModelName &&
                        <p className={styles.model_value}>{currentModelName}</p>
                    }
                </div>
                <p className={styles.edit_hint}>{t("main_page.language_panels.change")}</p>
            </button>
            {variant !== "live_compact" && <>
                <div className={styles.quick_switch_block}>
                    <div className={styles.quick_switch_header}>
                        <p className={styles.quick_switch_title}>{t("main_page.language_panels.device")}</p>
                        <p className={styles.quick_switch_hint}>{t("main_page.language_panels.device_desc")}</p>
                    </div>
                    <div className={styles.option_row}>
                        {deviceOptions.map((option) => (
                            <button
                                key={option.id}
                                type="button"
                                className={clsx(styles.option_button, {
                                    [styles.is_selected]: selectedMode === option.id,
                                    [styles.is_disabled]: option.disabled,
                                })}
                                onClick={() => selectDeviceMode(option.id)}
                                disabled={option.disabled}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className={styles.quick_switch_block}>
                    <div className={styles.quick_switch_header}>
                        <p className={styles.quick_switch_title}>{t("main_page.language_panels.processing_type")}</p>
                        <p className={styles.quick_switch_hint}>
                            {isAutoOnlyTranscriptionEngine(engine)
                                ? t("main_page.language_panels.processing_type_locked")
                                : t("main_page.language_panels.processing_type_whisper")}
                        </p>
                    </div>
                    <div className={styles.processing_scroll_area}>
                        <div className={styles.option_row}>
                            {computeTypeOptions.map((computeType) => (
                                <button
                                    key={computeType}
                                    type="button"
                                    className={clsx(styles.option_button, styles.compute_type_button, {
                                        [styles.is_selected]: selectedComputeType === computeType,
                                    })}
                                    onClick={() => setSelectedTranscriptionComputeType(computeType)}
                                >
                                    {computeType}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </>}
            {currentIsOpenedTranscriptionEngineSelector.data &&
                <TranscriptionEngineSelector
                    selected_id={engine}
                    placement={variant === "live_compact" ? "live" : "settings"}
                />
            }
        </div>
    );
};
