import { useEffect, useRef, useState } from "react";
import { _DownloadButton } from "../_atoms/_download_button/_DownloadButton";
import {
    getModelRowState,
    resolvePendingModelSelection,
} from "./modelDownloadState";
import { ModelDownloadConfirmation } from "./ModelDownloadConfirmation";
import styles from "./DownloadModels.module.scss";

export const DownloadModels = (props) => {
    const [confirmationModelId, setConfirmationModelId] = useState(null);
    const [pendingSelectionModelId, setPendingSelectionModelId] = useState(null);
    const triggeringRowRef = useRef(null);
    const rowRefs = useRef(new Map());

    useEffect(() => {
        const resolution = resolvePendingModelSelection(
            pendingSelectionModelId,
            props.options,
        );
        if (resolution.action === "select") {
            props.selectFunction(resolution.modelId);
        }
        if (resolution.action === "select" || resolution.action === "clear") {
            setPendingSelectionModelId(null);
        }
    }, [pendingSelectionModelId, props.options, props.selectFunction]);

    useEffect(() => {
        if (confirmationModelId === null && triggeringRowRef.current) {
            triggeringRowRef.current.focus();
            triggeringRowRef.current = null;
        }
    }, [confirmationModelId]);

    const activateModel = (option) => {
        const rowState = getModelRowState(
            option,
            props.checked_variable.state === "pending"
        );
        if (rowState === "installed") props.selectFunction(option.id);
        if (rowState === "download_required") {
            triggeringRowRef.current = rowRefs.current.get(option.id);
            setConfirmationModelId(option.id);
        }
    };

    const handleRowKeyDown = (option) => (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        activateModel(option);
    };

    const confirmDownload = () => {
        const option = props.options.find((item) => item.id === confirmationModelId);
        if (!option || getModelRowState(option, false) !== "download_required") {
            setConfirmationModelId(null);
            return;
        }
        setPendingSelectionModelId(option.id);
        setConfirmationModelId(null);
        props.downloadStartFunction(option.id);
    };

    const cancelDownload = () => setConfirmationModelId(null);
    const confirmationModel = props.options.find(
        (option) => option.id === confirmationModelId,
    );
    const selectionPending = props.checked_variable.state === "pending";

    return (
        <>
            <div
                className={styles.container}
                role="radiogroup"
                aria-label={props.label}
                aria-busy={selectionPending}
            >
                {props.options.map((option) => {
                    const rowState = getModelRowState(option, selectionPending);
                    const selected = props.checked_variable.data === option.id;
                    const installed = (
                        rowState === "installed" || rowState === "selection_pending"
                    );
                    const disabled = (
                        rowState === "selection_pending"
                        || rowState === "downloading"
                        || rowState === "unavailable"
                    );

                    return (
                        <div
                            className={styles.row}
                            data-state={rowState}
                            key={option.id}
                            ref={(node) => {
                                if (node) rowRefs.current.set(option.id, node);
                                else rowRefs.current.delete(option.id);
                            }}
                            tabIndex={-1}
                        >
                            {installed ? (
                                <label className={styles.installed_surface}>
                                    <input
                                        className={styles.radio}
                                        type="radio"
                                        name={props.name}
                                        value={option.id}
                                        checked={selected}
                                        disabled={disabled}
                                        onChange={() => activateModel(option)}
                                    />
                                    <span className={styles.label}>{option.label}</span>
                                </label>
                            ) : (
                                <button
                                    className={styles.activation_surface}
                                    type="button"
                                    disabled={disabled}
                                    aria-disabled={disabled}
                                    onClick={() => activateModel(option)}
                                    onKeyDown={handleRowKeyDown(option)}
                                >
                                    <span className={styles.label}>{option.label}</span>
                                </button>
                            )}
                            <_DownloadButton
                                option={option}
                                rowState={rowState}
                                downloadStartFunction={props.downloadStartFunction}
                            />
                        </div>
                    );
                })}
            </div>
            {confirmationModel && (
                <ModelDownloadConfirmation
                    model={confirmationModel}
                    onConfirm={confirmDownload}
                    onCancel={cancelDownload}
                />
            )}
        </>
    );
};
