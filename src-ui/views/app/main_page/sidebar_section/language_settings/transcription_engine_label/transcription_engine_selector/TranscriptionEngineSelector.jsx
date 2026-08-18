import clsx from "clsx";
import styles from "./TranscriptionEngineSelector.module.scss";
import { chunkArray } from "@utils";
import { useStore_IsOpenedTranscriptionEngineSelector } from "@store";
import {
    useStore_SelectedConfigTabId,
} from "@store";
import { useTranscription, useTranslation } from "@logics_configs";
import { useIsOpenedConfigPage } from "@logics_common";
import { QUICK_TRANSCRIPTION_ENGINE_OPTIONS } from "./transcriptionEngineOptions";

export const TranscriptionEngineSelector = ({ selected_id, placement = "settings", role = "all" }) => {
    const columns = chunkArray(QUICK_TRANSCRIPTION_ENGINE_OPTIONS, 2);

    return (
        <div className={styles.container} data-placement={placement}>
            <div className={styles.relative_container}>
                <div className={styles.wrapper}>
                    {columns.map((column, column_index) => (
                        <div className={styles.column_wrapper} key={`column_${column_index}`}>
                            {column.map(({ id, label, is_available }) => (
                                <EngineBox
                                    key={id}
                                    id={id}
                                    label={label}
                                    is_available={is_available}
                                    is_selected={id === selected_id}
                                    role={role}
                                />
                            ))}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

const EngineBox = (props) => {
    const {
        setSelectedTranscriptionEngine,
        setSelectedTranscriptionEngineSend,
        setSelectedTranscriptionEngineReceive,
        currentUseSplitGroqApiKey,
        currentGroqWhisperAuthKey,
    } = useTranscription();
    const { currentGroqAuthKey } = useTranslation();
    const { setIsOpenedConfigPage } = useIsOpenedConfigPage();
    const { updateSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const { updateIsOpenedTranscriptionEngineSelector } = useStore_IsOpenedTranscriptionEngineSelector();

    const box_class_name = clsx(
        styles.box,
        { [styles.is_selected]: props.is_selected },
        { [styles.is_available]: props.is_available }
    );

    const selectEngine = () => {
        if (props.is_selected === false) {
            const hasCloudKey = currentUseSplitGroqApiKey.data === true
                ? Boolean(currentGroqWhisperAuthKey.data)
                : Boolean(currentGroqAuthKey.data);
            if (props.id === "Whisper Cloud" && !hasCloudKey) {
                updateSelectedConfigTabId("model_and_provider");
                setIsOpenedConfigPage(true);
                updateIsOpenedTranscriptionEngineSelector(false);
                return;
            }
            const setEngine = props.role === "speaking"
                ? setSelectedTranscriptionEngineSend
                : props.role === "listening"
                    ? setSelectedTranscriptionEngineReceive
                    : setSelectedTranscriptionEngine;
            setEngine(props.id);
        }
        updateIsOpenedTranscriptionEngineSelector(false);
    };

    return (
        <button type="button" className={box_class_name} onClick={selectEngine}>
            <p className={styles.engine_name}>{props.label}</p>
        </button>
    );
};
