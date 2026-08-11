import { useEffect, useRef, useState } from "react";

import { normalizeHexColor } from "../../../logics/common/colorPalette.js";
import {
    hexToHsv,
    hsvToHex,
    getContainedPlaneMarkerPosition,
    pointToHue,
    pointToSaturationValue,
} from "./colorMath.js";
import styles from "./ColorPicker.module.scss";

export const ColorPicker = ({
    label,
    value,
    onChange,
    description,
    contrastWarning,
    open,
    onOpenChange,
    labels = {},
}) => {
    const copy = {
        hue: "Hue",
        saturation: "Saturation",
        brightness: "Brightness / Value",
        hex: "Hex",
        invalid: "Enter a valid 3- or 6-digit hex color.",
        ...labels,
    };
    const normalizedValue = normalizeHexColor(value) ?? "#000000";
    const [draftValue, setDraftValue] = useState(normalizedValue);
    const [hsv, setHsv] = useState(() => hexToHsv(normalizedValue));
    const [internalOpen, setInternalOpen] = useState(false);
    const planeRef = useRef(null);
    const wheelRef = useRef(null);
    const isOpen = open ?? internalOpen;
    const planeMarkerPosition = getContainedPlaneMarkerPosition(hsv);

    useEffect(() => {
        const next = normalizeHexColor(value);
        if (!next) return;
        setDraftValue(next);
        setHsv(hexToHsv(next));
    }, [value]);

    const setPopoverOpen = (next) => {
        if (open === undefined) setInternalOpen(next);
        onOpenChange?.(next);
    };

    const commitHex = (candidate) => {
        const next = normalizeHexColor(candidate);
        if (!next) return false;
        setDraftValue(next);
        setHsv(hexToHsv(next));
        onChange?.(next);
        return true;
    };

    const commitHsv = (nextHsv) => {
        const next = hsvToHex(nextHsv);
        setHsv(nextHsv);
        setDraftValue(next);
        onChange?.(next);
    };

    const updatePlane = (event) => {
        if (!planeRef.current) return;
        const next = pointToSaturationValue(event, planeRef.current.getBoundingClientRect());
        commitHsv({ ...hsv, ...next });
    };

    const updateWheel = (event) => {
        if (!wheelRef.current) return;
        const h = pointToHue(event, wheelRef.current.getBoundingClientRect());
        commitHsv({ ...hsv, h });
    };

    const handleKeyDown = (event) => {
        if (event.key === "Escape") {
            setDraftValue(normalizedValue);
            setHsv(hexToHsv(normalizedValue));
            setPopoverOpen(false);
        }
        if (event.key === "Enter") {
            event.preventDefault();
            if (commitHex(draftValue)) setPopoverOpen(false);
        }
    };

    return (
        <div className={styles.wrapper}>
            <button
                className={styles.trigger}
                type="button"
                aria-label={`${label} color picker`}
                aria-expanded={isOpen}
                onClick={() => setPopoverOpen(!isOpen)}
            >
                <span className={styles.swatch} style={{ backgroundColor: normalizedValue }} aria-hidden="true" />
                <span className={styles.trigger_value}>{normalizedValue}</span>
            </button>
            {description ? <p className={styles.description}>{description}</p> : null}
            {isOpen ? (
                <div className={styles.popover} role="dialog" aria-label={`${label} color controls`}>
                    <div className={styles.visual_controls}>
                        <div
                            ref={wheelRef}
                            className={styles.hue_wheel}
                            role="slider"
                            tabIndex="0"
                            aria-label={`${label} Hue`}
                            aria-valuemin="0"
                            aria-valuemax="360"
                            aria-valuenow={Math.round(hsv.h)}
                            onPointerDown={(event) => {
                                event.currentTarget.setPointerCapture?.(event.pointerId);
                                updateWheel(event);
                            }}
                            onPointerMove={(event) => {
                                if (event.currentTarget.hasPointerCapture?.(event.pointerId)) updateWheel(event);
                            }}
                            onKeyDown={(event) => {
                                if (!["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp"].includes(event.key)) return;
                                event.preventDefault();
                                commitHsv({ ...hsv, h: hsv.h + ((event.key === "ArrowLeft" || event.key === "ArrowDown") ? -1 : 1) });
                            }}
                        >
                            <div className={styles.hue_marker} style={{ transform: `rotate(${hsv.h}deg)` }} />
                            <div
                                ref={planeRef}
                                className={styles.saturation_plane}
                                style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
                                role="slider"
                                tabIndex="0"
                                aria-label={`${label} Saturation and Brightness`}
                                aria-valuemin="0"
                                aria-valuemax="100"
                                aria-valuenow={Math.round(hsv.s * 100)}
                                onPointerDown={(event) => {
                                    event.stopPropagation();
                                    event.currentTarget.setPointerCapture?.(event.pointerId);
                                    updatePlane(event);
                                }}
                                onPointerMove={(event) => {
                                    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) updatePlane(event);
                                }}
                            >
                                <span
                                    className={styles.plane_marker}
                                    style={{
                                        "--plane-marker-x": `${planeMarkerPosition.x * 100}%`,
                                        "--plane-marker-y": `${planeMarkerPosition.y * 100}%`,
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                    <div className={styles.range_controls}>
                        <label>
                            <span>{copy.hue}</span>
                            <input
                                type="range"
                                min="0"
                                max="360"
                                value={Math.round(hsv.h)}
                                aria-label={`${label} Hue range`}
                                onChange={(event) => commitHsv({ ...hsv, h: Number(event.target.value) })}
                            />
                        </label>
                        <label>
                            <span>{copy.saturation}</span>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={Math.round(hsv.s * 100)}
                                aria-label={`${label} Saturation range`}
                                onChange={(event) => commitHsv({ ...hsv, s: Number(event.target.value) / 100 })}
                            />
                        </label>
                        <label>
                            <span>{copy.brightness}</span>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={Math.round(hsv.v * 100)}
                                aria-label={`${label} Brightness / Value range`}
                                onChange={(event) => commitHsv({ ...hsv, v: Number(event.target.value) / 100 })}
                            />
                        </label>
                    </div>
                    <label className={styles.hex_field}>
                        <span>{copy.hex}</span>
                        <input
                            type="text"
                            value={draftValue}
                            aria-label={`${label} hex code`}
                            aria-invalid={draftValue !== "" && !normalizeHexColor(draftValue)}
                            onChange={(event) => setDraftValue(event.target.value.toUpperCase())}
                            onBlur={() => commitHex(draftValue)}
                            onKeyDown={handleKeyDown}
                            spellCheck="false"
                        />
                    </label>
                    {draftValue !== "" && !normalizeHexColor(draftValue)
                        ? <p className={styles.error} role="alert">{copy.invalid}</p>
                        : null}
                    {contrastWarning ? <p className={styles.warning} role="status">{contrastWarning}</p> : null}
                </div>
            ) : null}
        </div>
    );
};
