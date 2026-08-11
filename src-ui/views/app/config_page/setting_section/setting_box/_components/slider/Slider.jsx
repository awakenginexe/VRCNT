import React, { useRef, useState, useEffect, useCallback } from "react";
import styles from "./Slider.module.scss";
import clsx from "clsx";
import { useSliderLogic } from "@logics_configs";

export const Slider = (props) => {
    const location = props.valueLabelDisplayLocation || "top";
    const {
        ui_value,
        onChangeFunction,
        onChangeCommittedFunction,
        marks
    } = useSliderLogic({
        variable: props.variable,
        setterFunction: props.setterFunction,
        setter_timing: props.setter_timing,
        postUpdateAction: props.postUpdateAction,
        min: props.min,
        max: props.max,
        step: props.step,
        show_label_values: props.show_label_values,
        marks_step: props.marks_step,
    });

    const isVertical = props.orientation === "vertical";
    const min = props.min !== undefined ? Number(props.min) : 0;
    const max = props.max !== undefined ? Number(props.max) : 100;
    const step = props.step == null ? null : Number(props.step);

    const trackRef = useRef(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const activePointerIdRef = useRef(null);
    const dragTargetRef = useRef(null);
    const lastPointerPositionRef = useRef({ clientX: 0, clientY: 0 });
    const localValueRef = useRef(ui_value);
    const uiValueRef = useRef(ui_value);
    const onChangeFunctionRef = useRef(onChangeFunction);
    const onChangeCommittedFunctionRef = useRef(onChangeCommittedFunction);

    const decimalPlaces = step && step.toString().includes('.')
        ? step.toString().split('.')[1].length
        : 0;

    const [localValue, setLocalValue] = useState(ui_value);

    // Sync localValue with ui_value (from store) only when NOT dragging
    useEffect(() => {
        if (!isDragging) {
            localValueRef.current = ui_value;
            setLocalValue(ui_value);
        }
    }, [ui_value, isDragging]);

    useEffect(() => {
        localValueRef.current = localValue;
        uiValueRef.current = ui_value;
        onChangeFunctionRef.current = onChangeFunction;
        onChangeCommittedFunctionRef.current = onChangeCommittedFunction;
    }, [localValue, ui_value, onChangeFunction, onChangeCommittedFunction]);

    const calculateValue = useCallback((clientX, clientY) => {
        if (!trackRef.current) return localValueRef.current;
        const rect = trackRef.current.getBoundingClientRect();
        const trackSize = isVertical ? rect.height : rect.width;
        if (!trackSize) return localValueRef.current;
        let percentage;
        if (isVertical) {
            let y = clientY - rect.top;
            y = Math.max(0, Math.min(y, rect.height));
            percentage = 1 - (y / rect.height);
        } else {
            let x = clientX - rect.left;
            x = Math.max(0, Math.min(x, rect.width));
            percentage = x / rect.width;
        }

        let rawValue = percentage * (max - min) + min;
        if (step) {
            const steps = Math.round((rawValue - min) / step);
            // Use decimalPlaces + 2 for intermediate to avoid rounding issues, then final toFixed(decimalPlaces)
            rawValue = parseFloat((steps * step + min).toFixed(decimalPlaces + 2));
            rawValue = parseFloat(rawValue.toFixed(decimalPlaces));
        }
        return Math.max(min, Math.min(rawValue, max));
    }, [isVertical, max, min, step, decimalPlaces]);

    const updateFromPointer = useCallback((event) => {
        if (Number.isFinite(event?.clientX)) lastPointerPositionRef.current.clientX = event.clientX;
        if (Number.isFinite(event?.clientY)) lastPointerPositionRef.current.clientY = event.clientY;
        const newValue = calculateValue(
            lastPointerPositionRef.current.clientX,
            lastPointerPositionRef.current.clientY,
        );
        localValueRef.current = newValue;
        setLocalValue(newValue);
        if (newValue !== uiValueRef.current) {
            onChangeFunctionRef.current(newValue);
        }
        return newValue;
    }, [calculateValue]);

    const finishDragging = useCallback((event) => {
        const activePointerId = activePointerIdRef.current;
        if (activePointerId === null) return;
        if (event?.pointerId !== undefined && event.pointerId !== activePointerId) return;

        const newValue = updateFromPointer(event);
        onChangeCommittedFunctionRef.current?.(newValue);
        dragTargetRef.current?.releasePointerCapture?.(activePointerId);
        dragTargetRef.current = null;
        activePointerIdRef.current = null;
        setIsDragging(false);
    }, [updateFromPointer]);

    const handlePointerDown = (e) => {
        if (e.button !== 0 || activePointerIdRef.current !== null) return; // Only left click and one pointer at a time
        activePointerIdRef.current = e.pointerId;
        dragTargetRef.current = e.currentTarget;
        lastPointerPositionRef.current = { clientX: e.clientX, clientY: e.clientY };
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setIsDragging(true);
        updateFromPointer(e);
        e.preventDefault();
        e.stopPropagation();
    };

    useEffect(() => {
        if (!isDragging) return;

        const handlePointerMove = (e) => {
            if (e.pointerId !== activePointerIdRef.current) return;
            updateFromPointer(e);
        };

        const handlePointerUp = (e) => finishDragging(e);
        const handlePointerCancel = (e) => finishDragging(e);
        const handleWindowBlur = () => finishDragging();

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerCancel);
        window.addEventListener("blur", handleWindowBlur);

        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerCancel);
            window.removeEventListener("blur", handleWindowBlur);
        };
    }, [isDragging, updateFromPointer, finishDragging]);

    const handleMouseEnter = (e) => {
        setIsHovered(true);
        if (props.onMouseEnterFunction) props.onMouseEnterFunction(e);
    };

    const handleMouseLeave = (e) => {
        setIsHovered(false);
        if (props.onMouseLeaveFunction) props.onMouseLeaveFunction(e);
    };

    const percentage = Math.max(0, Math.min((localValue - min) / (max - min), 1)) * 100;

    const valueLabelStr = (() => {
        let displayValue = localValue;
        if (typeof props.valueLabelFunction === "function") {
            displayValue = props.valueLabelFunction(localValue);
        }

        if (typeof props.valueLabelFormat === "function") {
            return props.valueLabelFormat(displayValue);
        } else if (typeof props.valueLabelFormat === "string") {
            return props.valueLabelFormat.replace("value", displayValue);
        }

        return displayValue;
    })();
    const valueLabelDisplay = props.valueLabelDisplay || "auto";
    const showValueLabel = valueLabelDisplay === "on" || (valueLabelDisplay === "auto" && (isHovered || isDragging));

    return (
        <div
            className={clsx(
                styles.container,
                props.className,
                {
                    [styles.no_padding]: props.no_padding || props.is_break_point,
                }
            )}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <div
                className={clsx(styles.sliderRoot, {
                    [styles.vertical]: isVertical,
                    [styles.horizontal]: !isVertical,
                    [styles.dragging]: isDragging
                })}
                ref={trackRef}
                onPointerDown={handlePointerDown}
            >
                <div className={styles.rail}></div>
                {props.track !== false && (
                    <div
                        className={styles.track}
                        style={{
                            ...(isVertical ? { bottom: "0%", height: `${percentage}%` } : { left: "0%", width: `${percentage}%` })
                        }}
                    ></div>
                )}

                {marks && marks.map((mark, i) => {
                    const markPercent = Math.max(0, Math.min((mark.value - min) / (max - min), 1)) * 100;
                    const isActive = mark.value <= localValue;
                    return (
                        <div
                            key={i}
                            className={clsx(styles.mark, { [styles.markActive]: isActive })}
                            style={{
                                ...(isVertical ? { bottom: `${markPercent}%` } : { left: `${markPercent}%` })
                            }}
                        >
                            {mark.label && (
                                <span className={clsx(styles.markLabel, { [styles.markLabelActive]: isActive })}>
                                    {mark.label}
                                </span>
                            )}
                        </div>
                    );
                })}

                <div
                    className={clsx(styles.thumb, { [styles.thumbActive]: isDragging })}
                    style={{
                        ...(isVertical ? { bottom: `${percentage}%` } : { left: `${percentage}%` })
                    }}
                >
                    <div className={clsx(styles.valueLabel, styles[`location-${location}`], {
                        [styles.valueLabelOpen]: showValueLabel
                    })}>
                        <span className={styles.valueLabelLabel}>{valueLabelStr}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
