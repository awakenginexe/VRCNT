import clsx from "clsx";
import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import styles from "./TranscriptionEngineSelector.module.scss";
import { chunkArray } from "@utils";
import { useStore_IsOpenedTranscriptionEngineSelector } from "@store";
import {
    useStore_SelectedConfigTabId,
} from "@store";
import { useTranscription, useTranslation } from "@logics_configs";
import { useIsOpenedConfigPage } from "@logics_common";
import { QUICK_TRANSCRIPTION_ENGINE_OPTIONS } from "./transcriptionEngineOptions";
import { useFloatingPanelPosition } from "../../../../../../common_components/floating_panel/useFloatingPanelPosition.js";

const LIVE_PANEL_WIDTH = 400;
const LIVE_PANEL_GAP = 12;
const LIVE_PANEL_PADDING = 16;

const toFiniteNumber = (value, fallback) => (
    Number.isFinite(Number(value)) ? Number(value) : fallback
);

const getLivePanelStyle = (floatingPanelStyle, anchorRef) => {
    if (
        typeof window === "undefined"
        || !anchorRef?.current
        || floatingPanelStyle.visibility === "hidden"
    ) {
        return { style: floatingPanelStyle, horizontalPlacement: "right" };
    }

    const anchorRect = anchorRef.current.getBoundingClientRect();
    const anchorLeft = toFiniteNumber(anchorRect.left, 0);
    const anchorRight = toFiniteNumber(
        anchorRect.right,
        anchorLeft + toFiniteNumber(anchorRect.width, 1),
    );
    const width = Math.max(1, toFiniteNumber(floatingPanelStyle.width, LIVE_PANEL_WIDTH));
    const viewportWidth = Math.max(1, toFiniteNumber(window.innerWidth, 1));
    const maximumLeft = Math.max(
        LIVE_PANEL_PADDING,
        viewportWidth - width - LIVE_PANEL_PADDING,
    );
    const rightSideLeft = anchorRight + LIVE_PANEL_GAP;
    const leftSideLeft = anchorLeft - width - LIVE_PANEL_GAP;
    const fitsRight = rightSideLeft + width <= viewportWidth - LIVE_PANEL_PADDING;
    const preferredLeft = fitsRight ? rightSideLeft : leftSideLeft;
    const left = Math.min(
        Math.max(preferredLeft, LIVE_PANEL_PADDING),
        maximumLeft,
    );

    return {
        style: { ...floatingPanelStyle, left, right: "auto" },
        horizontalPlacement: fitsRight ? "right" : "left",
    };
};

export const TranscriptionEngineSelector = ({
    selected_id,
    placement = "settings",
    role = "all",
    anchorRef,
}) => {
    const columns = chunkArray(QUICK_TRANSCRIPTION_ENGINE_OPTIONS, 2);
    const isLivePlacement = placement === "live";
    const panelRef = useRef(null);
    const closeRequestedRef = useRef(false);
    const {
        updateIsOpenedTranscriptionEngineSelector,
    } = useStore_IsOpenedTranscriptionEngineSelector();
    const updateCloseRef = useRef(updateIsOpenedTranscriptionEngineSelector);
    updateCloseRef.current = updateIsOpenedTranscriptionEngineSelector;
    const { style: floatingPanelStyle, placement: verticalPlacement } = useFloatingPanelPosition(anchorRef, {
        open: isLivePlacement,
        width: LIVE_PANEL_WIDTH,
        gap: LIVE_PANEL_GAP,
        padding: LIVE_PANEL_PADDING,
    });
    const {
        style: livePanelStyle,
        horizontalPlacement,
    } = getLivePanelStyle(floatingPanelStyle, anchorRef);
    const restoreFocus = useCallback(() => {
        const anchor = anchorRef?.current;
        if (anchor && typeof anchor.focus === "function") anchor.focus();
    }, [anchorRef]);
    const closeLivePanel = useCallback(() => {
        if (closeRequestedRef.current) return;
        closeRequestedRef.current = true;
        updateCloseRef.current(false);
        restoreFocus();
    }, [restoreFocus]);
    const markLivePanelClosed = useCallback(() => {
        closeRequestedRef.current = true;
        restoreFocus();
    }, [restoreFocus]);

    useEffect(() => {
        if (!isLivePlacement || typeof document === "undefined") return undefined;

        closeRequestedRef.current = false;
        const isInsideLiveSurface = (event) => {
            const panel = panelRef.current;
            const anchor = anchorRef?.current;
            const eventPath = typeof event.composedPath === "function"
                ? event.composedPath()
                : [];
            return eventPath.includes(panel)
                || eventPath.includes(anchor)
                || panel?.contains(event.target)
                || anchor?.contains(event.target);
        };
        const handleKeyDown = (event) => {
            if (event.key !== "Escape" && event.key !== "Esc") return;
            event.preventDefault();
            closeLivePanel();
        };
        const handleOutsideInteraction = (event) => {
            if (!isInsideLiveSurface(event)) closeLivePanel();
        };

        document.addEventListener("keydown", handleKeyDown, true);
        document.addEventListener("pointerdown", handleOutsideInteraction, true);
        document.addEventListener("click", handleOutsideInteraction, true);

        return () => {
            document.removeEventListener("keydown", handleKeyDown, true);
            document.removeEventListener("pointerdown", handleOutsideInteraction, true);
            document.removeEventListener("click", handleOutsideInteraction, true);
            if (!closeRequestedRef.current) restoreFocus();
        };
    }, [anchorRef, closeLivePanel, isLivePlacement, restoreFocus]);

    const panel = (
        <div
            className={styles.container}
            data-placement={placement}
            data-horizontal-placement={isLivePlacement ? horizontalPlacement : undefined}
            data-vertical-placement={isLivePlacement ? verticalPlacement : undefined}
            ref={isLivePlacement ? panelRef : undefined}
            style={isLivePlacement ? livePanelStyle : undefined}
        >
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
                                    onClose={isLivePlacement ? markLivePanelClosed : undefined}
                                />
                            ))}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );

    return isLivePlacement && typeof document !== "undefined"
        ? createPortal(panel, document.body)
        : panel;
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
    const closeSelector = () => {
        updateIsOpenedTranscriptionEngineSelector(false);
        props.onClose?.();
    };

    const selectEngine = () => {
        if (props.is_selected === false) {
            const hasCloudKey = currentUseSplitGroqApiKey.data === true
                ? Boolean(currentGroqWhisperAuthKey.data)
                : Boolean(currentGroqAuthKey.data);
            if (props.id === "Whisper Cloud" && !hasCloudKey) {
                updateSelectedConfigTabId("model_and_provider");
                setIsOpenedConfigPage(true);
                closeSelector();
                return;
            }
            const setEngine = props.role === "speaking"
                ? setSelectedTranscriptionEngineSend
                : props.role === "listening"
                    ? setSelectedTranscriptionEngineReceive
                    : setSelectedTranscriptionEngine;
            setEngine(props.id);
        }
        closeSelector();
    };

    return (
        <button type="button" className={box_class_name} onClick={selectEngine}>
            <p className={styles.engine_name}>{props.label}</p>
        </button>
    );
};
