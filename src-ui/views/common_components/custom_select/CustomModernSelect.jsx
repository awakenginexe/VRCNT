import React, { useState, useRef, useEffect, useId } from "react";
import clsx from "clsx";
import { createPortal } from "react-dom";
import styles from "./CustomModernSelect.module.scss";
import { LanguageFlag } from "../../app/main_page/sidebar_section/language_settings/LanguageFlag.jsx";
import { useFloatingPanelPosition } from "../floating_panel/useFloatingPanelPosition.js";

/**
 * CustomModernSelect — Production-grade Dark Glassmorphism Dropdown Selector
 *
 * Supports:
 * - Full keyboard navigation (Arrow keys, Enter, Space, Escape, Tab)
 * - Click-outside dismissal
 * - Auto upward/downward positioning based on viewport space
 * - Primary & secondary text hierarchy
 * - Custom status badges (Recommended, Installed, GPU/CPU, Speed/Accuracy)
 * - Accessible ARIA attributes & focus ring
 */
export const CustomModernSelect = ({
    id: propId,
    label,
    value,
    options = [],
    onChange,
    disabled = false,
    placeholder = "Select an option...",
    color = "var(--accent_color, #38BDF8)",
    variant = "default", // "default" | "compact" | "model"
    className,
    ariaLabel,
}) => {
    const generatedId = useId();
    const selectId = propId || generatedId;
    const [isOpen, setIsOpen] = useState(false);
    const [focusedIndex, setFocusedIndex] = useState(-1);

    const containerRef = useRef(null);
    const triggerRef = useRef(null);
    const listboxRef = useRef(null);
    const optionRefs = useRef([]);

    const { style: floatingPanelStyle, placement } = useFloatingPanelPosition(triggerRef, {
        open: isOpen,
        width: variant === "model" ? 380 : "anchor",
        gap: 6,
        padding: 12,
    });

    const selectedOption = options.find((opt) => opt.id === value || opt.value === value);

    // Click outside handler
    useEffect(() => {
        if (!isOpen) return;
        const handleMousedown = (event) => {
            const isInsideContainer = containerRef.current?.contains(event.target);
            const isInsideListbox = listboxRef.current?.contains(event.target);
            if (!isInsideContainer && !isInsideListbox) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleMousedown);
        document.addEventListener("touchstart", handleMousedown);
        return () => {
            document.removeEventListener("mousedown", handleMousedown);
            document.removeEventListener("touchstart", handleMousedown);
        };
    }, [isOpen]);

    // Sync focused index with selected option when opening
    useEffect(() => {
        if (isOpen) {
            const idx = options.findIndex((opt) => opt.id === value || opt.value === value);
            setFocusedIndex(idx >= 0 ? idx : 0);
        }
    }, [isOpen, options, value]);

    // Scroll focused option into view
    useEffect(() => {
        if (isOpen && focusedIndex >= 0 && optionRefs.current[focusedIndex]) {
            optionRefs.current[focusedIndex].scrollIntoView({
                block: "nearest",
                behavior: "smooth",
            });
        }
    }, [focusedIndex, isOpen]);

    const toggleOpen = () => {
        if (disabled) return;
        setIsOpen((prev) => !prev);
    };

    const handleSelect = (option) => {
        if (option.disabled) return;
        if (onChange) {
            onChange(option.id !== undefined ? option.id : option.value);
        }
        setIsOpen(false);
        if (triggerRef.current) {
            triggerRef.current.focus();
        }
    };

    const handleKeyDown = (event) => {
        if (disabled) return;

        switch (event.key) {
            case "Enter":
            case " ":
                event.preventDefault();
                if (!isOpen) {
                    setIsOpen(true);
                } else if (focusedIndex >= 0 && options[focusedIndex]) {
                    handleSelect(options[focusedIndex]);
                }
                break;
            case "ArrowDown":
                event.preventDefault();
                if (!isOpen) {
                    setIsOpen(true);
                } else {
                    setFocusedIndex((prev) => {
                        let next = prev + 1;
                        while (next < options.length && options[next]?.disabled) {
                            next++;
                        }
                        return next < options.length ? next : prev;
                    });
                }
                break;
            case "ArrowUp":
                event.preventDefault();
                if (!isOpen) {
                    setIsOpen(true);
                } else {
                    setFocusedIndex((prev) => {
                        let next = prev - 1;
                        while (next >= 0 && options[next]?.disabled) {
                            next--;
                        }
                        return next >= 0 ? next : prev;
                    });
                }
                break;
            case "Escape":
                if (isOpen) {
                    event.preventDefault();
                    setIsOpen(false);
                    triggerRef.current?.focus();
                }
                break;
            case "Tab":
                if (isOpen) {
                    setIsOpen(false);
                }
                break;
            default:
                break;
        }
    };

    const listbox = isOpen ? (
        <div
            id={`${selectId}-listbox`}
            ref={listboxRef}
            className={styles.dropdown_panel}
            style={floatingPanelStyle}
            data-placement={placement}
            data-variant={variant}
            role="listbox"
            aria-activedescendant={
                focusedIndex >= 0 ? `${selectId}-option-${focusedIndex}` : undefined
            }
            tabIndex={-1}
        >
            <div
                className={styles.options_scroll_area}
                style={{ maxHeight: floatingPanelStyle.maxHeight }}
            >
                {options.map((option, index) => {
                    const isSelected =
                        option.id === value || option.value === value;
                    const isFocused = index === focusedIndex;

                    return (
                        <div
                            key={option.id ?? option.value ?? index}
                            id={`${selectId}-option-${index}`}
                            ref={(el) => (optionRefs.current[index] = el)}
                            role="option"
                            aria-selected={isSelected}
                            aria-disabled={option.disabled}
                            className={clsx(styles.option_row, {
                                [styles.is_selected]: isSelected,
                                [styles.is_focused]: isFocused,
                                [styles.is_disabled]: option.disabled,
                            })}
                            onClick={() => handleSelect(option)}
                            onMouseEnter={() => setFocusedIndex(index)}
                        >
                            {(option.country || option.flagCountry) && (
                                <LanguageFlag
                                    country={option.country || option.flagCountry}
                                    className={styles.option_flag}
                                />
                            )}
                            <div className={styles.option_main}>
                                <div className={styles.option_title_row}>
                                    <span className={styles.option_title}>
                                        {option.title || option.label || option.id}
                                    </span>
                                    {option.isRecommended && (
                                        <span className={styles.recommended_badge}>
                                            Recommended
                                        </span>
                                    )}
                                    {option.badge && (
                                        <span
                                            className={styles.meta_badge}
                                            data-type={option.badgeType || "neutral"}
                                        >
                                            {option.badge}
                                        </span>
                                    )}
                                </div>

                                {option.subtitle && (
                                    <span className={styles.option_subtitle}>
                                        {option.subtitle}
                                    </span>
                                )}

                                {option.description && (
                                    <p className={styles.option_description}>
                                        {option.description}
                                    </p>
                                )}

                                {(option.size || option.computeTarget || option.vram) && (
                                    <div className={styles.option_specs}>
                                        {option.size && (
                                            <span className={styles.spec_chip}>
                                                💾 {option.size}
                                            </span>
                                        )}
                                        {option.computeTarget && (
                                            <span className={styles.spec_chip}>
                                                ⚡ {option.computeTarget}
                                            </span>
                                        )}
                                        {option.vram && (
                                            <span className={styles.spec_chip}>
                                                🧠 {option.vram}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className={styles.option_status_col}>
                                {option.isDownloaded === true && (
                                    <span className={styles.status_installed}>
                                        ✓ Installed
                                    </span>
                                )}
                                {option.isDownloaded === false && (
                                    <span className={styles.status_download_needed}>
                                        ↓ Download
                                    </span>
                                )}
                                {isSelected && (
                                    <span className={styles.check_icon} aria-hidden="true">
                                        ✓
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    ) : null;

    return (
        <div
            ref={containerRef}
            className={clsx(
                styles.select_container,
                {
                    [styles.is_open]: isOpen,
                    [styles.is_disabled]: disabled,
                },
                styles[`variant_${variant}`],
                className,
            )}
        >
            {label && (
                <label htmlFor={`${selectId}-button`} className={styles.field_label}>
                    {label}
                </label>
            )}

            <button
                id={`${selectId}-button`}
                ref={triggerRef}
                type="button"
                className={styles.trigger}
                onClick={toggleOpen}
                onKeyDown={handleKeyDown}
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                aria-controls={`${selectId}-listbox`}
                aria-label={ariaLabel || label || placeholder}
                style={{ "--accent-color": color }}
            >
                <div className={styles.trigger_content}>
                    {selectedOption ? (
                        <>
                            {(selectedOption.country || selectedOption.flagCountry) && (
                                <LanguageFlag
                                    country={selectedOption.country || selectedOption.flagCountry}
                                    className={styles.trigger_flag}
                                />
                            )}
                            <div className={styles.trigger_value_group}>
                                <span className={styles.trigger_title}>
                                    {selectedOption.title || selectedOption.label || selectedOption.id}
                                </span>
                                {selectedOption.subtitle && (
                                    <span className={styles.trigger_subtitle}>
                                        {selectedOption.subtitle}
                                    </span>
                                )}
                            </div>
                        </>
                    ) : (
                        <span className={styles.placeholder}>{placeholder}</span>
                    )}
                </div>

                {selectedOption?.badge && (
                    <span className={styles.trigger_badge} data-type={selectedOption.badgeType || "neutral"}>
                        {selectedOption.badge}
                    </span>
                )}

                <span className={styles.arrow} aria-hidden="true">
                    ▾
                </span>
            </button>

            {isOpen && typeof document !== "undefined" && createPortal(listbox, document.body)}
        </div>
    );
};
