import clsx from "clsx";
import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import styles from "./TranslatorSelector.module.scss";
import { useI18n } from "@useI18n";

import { chunkArray } from "@utils";
import { useStore_IsOpenedTranslatorSelector } from "@store";
import { useLanguageSettings } from "@logics_main";
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

const normalizeSelectedIds = (selected_ids) => (
    Array.isArray(selected_ids)
        ? selected_ids.filter(Boolean)
        : [selected_ids].filter(Boolean)
);

const canBeSecondary = (engine, primary_id) => (
    engine?.is_available === true
    && engine.id !== primary_id
    && (primary_id === "CTranslate2" || engine.id !== "CTranslate2")
);

const findFallbackSecondaryId = (translation_engines, primary_id, current_secondary_id) => {
    const current_secondary = translation_engines.find(engine => engine.id === current_secondary_id);
    if (canBeSecondary(current_secondary, primary_id)) return current_secondary.id;

    const cloud_secondary = translation_engines.find(
        engine => canBeSecondary(engine, primary_id) && engine.is_default !== true
    );
    if (cloud_secondary) return cloud_secondary.id;

    return translation_engines.find(
        engine => canBeSecondary(engine, primary_id)
    )?.id;
};

export const TranslatorSelector = ({
    selected_ids,
    translation_engines,
    is_selected_same_language,
    placement = "settings",
    anchorRef,
}) => {
    const { t } = useI18n();
    const columns = chunkArray(translation_engines, 2);
    const isLivePlacement = placement === "live";
    const panelRef = useRef(null);
    const closeRequestedRef = useRef(false);
    const {
        updateIsOpenedTranslatorSelector,
    } = useStore_IsOpenedTranslatorSelector();
    const updateCloseRef = useRef(updateIsOpenedTranslatorSelector);
    updateCloseRef.current = updateIsOpenedTranslatorSelector;
    const { style: floatingPanelStyle, placement: verticalPlacement } = useFloatingPanelPosition(anchorRef, {
        open: isLivePlacement,
        width: LIVE_PANEL_WIDTH,
        gap: LIVE_PANEL_GAP,
        padding: LIVE_PANEL_PADDING,
        panelRef,
        verticalAlignment: "anchor-end",
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
    const selectedIds = normalizeSelectedIds(selected_ids);
    const primary_id = selectedIds[0] ?? "CTranslate2";
    const secondary_id = selectedIds[1];
    const parallel_enabled = selectedIds.length > 1;

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
                <ParallelTranslationControls
                    primary_id={primary_id}
                    secondary_id={secondary_id}
                    selected_ids={selectedIds}
                    translation_engines={translation_engines}
                />
                <div className={styles.wrapper}>
                    {columns.map((column, column_index) => (
                        <div className={styles.column_wrapper} key={`column_${column_index}`}>
                            {column.map(({ id, label, is_available, is_default }) => (
                                <TranslatorBox
                                    key={id}
                                    id={id}
                                    label={label}
                                    is_available={is_available}
                                    is_default={is_default}
                                    is_primary_selected={(id === primary_id)}
                                    is_secondary_selected={parallel_enabled && (id === secondary_id)}
                                    selected_ids={selectedIds}
                                    translation_engines={translation_engines}
                                    onClose={isLivePlacement ? markLivePanelClosed : undefined}
                                />
                            ))}
                        </div>
                    ))}
                </div>
                {is_selected_same_language ?
                    <div className={styles.is_selected_same_language_wrapper}>
                        <p className={styles.is_selected_same_language_text}>
                            {t("main_page.translator_selector.is_selected_same_language", {
                                your_language: t("main_page.your_language"),
                                target_language: t("main_page.target_language"),
                                ctranslate2: "CTranslate2",
                            })}
                        </p>
                    </div>
                : null
                }
            </div>
        </div>
    );

    return isLivePlacement && typeof document !== "undefined"
        ? createPortal(panel, document.body)
        : panel;
};

const ParallelTranslationControls = ({primary_id, secondary_id, selected_ids, translation_engines}) => {
    const { t } = useI18n();
    const {
        setSelectedTranslationEngines,
        currentCTranslate2AutoFallback,
        getCTranslate2AutoFallback,
        setCTranslate2AutoFallback,
    } = useLanguageSettings();
    const parallel_enabled = selected_ids.length > 1;
    const fallback_secondary_id = findFallbackSecondaryId(translation_engines, primary_id, secondary_id);
    const can_use_parallel = Boolean(fallback_secondary_id);
    const selected_secondary_id = fallback_secondary_id ?? "";
    const secondary_options = translation_engines.filter(
        engine => canBeSecondary(engine, primary_id)
    );
    const local_fallback_available = translation_engines.some(
        engine => engine.id === "CTranslate2" && engine.is_available === true
    );
    const show_local_fallback = primary_id !== "CTranslate2";

    useEffect(() => {
        getCTranslate2AutoFallback();
    }, []);

    const toggleParallelService = (event) => {
        if (event.target.checked && fallback_secondary_id) {
            setSelectedTranslationEngines([primary_id, fallback_secondary_id]);
        } else {
            setSelectedTranslationEngines(primary_id);
        }
    };

    const selectSecondaryTranslator = (event) => {
        const next_secondary_id = event.target.value;
        if (next_secondary_id) {
            setSelectedTranslationEngines([primary_id, next_secondary_id]);
        }
    };

    return (
        <div className={styles.parallel_controls}>
            <label className={styles.parallel_toggle}>
                <div className={styles.parallel_checkbox_wrapper}>
                    <input
                        className={styles.parallel_checkbox}
                        type="checkbox"
                        checked={parallel_enabled && can_use_parallel}
                        disabled={!can_use_parallel}
                        onChange={toggleParallelService}
                    />
                    <span className={styles.checkbox_slider} />
                </div>
                <span>{t("main_page.translator_selector.use_parallel_service")}</span>
            </label>
            {parallel_enabled && can_use_parallel ? (
                <div className={styles.second_selector_wrapper}>
                    <label className={styles.second_selector_label}>
                        {t("main_page.translator_selector.second_translator")}
                    </label>
                    <div className={styles.second_selector_container}>
                        <select
                            className={styles.second_selector}
                            value={selected_secondary_id}
                            onChange={selectSecondaryTranslator}
                        >
                            {secondary_options.map(engine => (
                                <option key={engine.id} value={engine.id}>{engine.label.replace("\n", " ")}</option>
                            ))}
                        </select>
                        <div className={styles.dropdown_arrow}>
                            <svg viewBox="0 0 24 24">
                                <path d="M7 10l5 5 5-5H7z" />
                            </svg>
                        </div>
                    </div>
                </div>
            ) : null}
            {show_local_fallback ? (
                <label className={styles.local_fallback_control}>
                    <div className={styles.local_fallback_heading}>
                        <div className={styles.parallel_checkbox_wrapper}>
                            <input
                                className={styles.parallel_checkbox}
                                type="checkbox"
                                checked={Boolean(currentCTranslate2AutoFallback.data)}
                                disabled={
                                    currentCTranslate2AutoFallback.state === "pending"
                                    || (
                                        !local_fallback_available
                                        && !currentCTranslate2AutoFallback.data
                                    )
                                }
                                onChange={(event) => (
                                    setCTranslate2AutoFallback(event.target.checked)
                                )}
                            />
                            <span className={styles.checkbox_slider} />
                        </div>
                        <span>{t("main_page.translator_selector.local_fallback")}</span>
                    </div>
                    <span className={styles.local_fallback_description}>
                        {t("main_page.translator_selector.local_fallback_desc")}
                    </span>
                </label>
            ) : null}
        </div>
    );
};

const TranslatorBox = (props) => {
    const { t } = useI18n();
    const { setSelectedTranslationEngines} = useLanguageSettings();
    const { updateIsOpenedTranslatorSelector} = useStore_IsOpenedTranslatorSelector();
    const parallel_enabled = props.selected_ids.length > 1;

    const box_class_name = clsx(
        styles.box,
        { [styles.is_primary]: props.is_primary_selected },
        { [styles.is_secondary]: props.is_secondary_selected },
        { [styles.is_available]: props.is_available }
    );
    const label_default_class_name = clsx(
        styles.label_default,
        { [styles.is_primary]: props.is_primary_selected },
        { [styles.is_secondary]: props.is_secondary_selected },
    );

    const selectTranslator = () => {
        const parallel_enabled = props.selected_ids.length > 1;
        if (parallel_enabled) {
            const secondary_id = findFallbackSecondaryId(
                props.translation_engines,
                props.id,
                props.selected_ids[1],
            );
            setSelectedTranslationEngines(
                secondary_id ? [props.id, secondary_id] : props.id
            );
            return;
        }
        if (props.is_primary_selected === false) {
            setSelectedTranslationEngines(props.id);
        }
        updateIsOpenedTranslatorSelector(false);
        props.onClose?.();
    };

    return (
        <button type="button" className={box_class_name} onClick={selectTranslator}>
            {parallel_enabled && props.is_primary_selected && (
                <span className={clsx(styles.badge, styles.primary_badge)}>
                    {t("main_page.translator_selector.primary_badge")}
                </span>
            )}
            {parallel_enabled && props.is_secondary_selected && (
                <span className={clsx(styles.badge, styles.secondary_badge)}>
                    {t("main_page.translator_selector.secondary_badge")}
                </span>
            )}
            <p className={styles.translator_name}>{props.label}</p>
            {props.is_default && <p className={label_default_class_name}>{t("main_page.translator_label_default")}</p>}
        </button>
    );
};
