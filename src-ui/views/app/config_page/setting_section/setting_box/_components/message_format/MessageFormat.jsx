import styles from "./MessageFormat.module.scss";
import clsx from "clsx";
import { useTranslation } from "react-i18next";
import { _Entry } from "../_atoms/_entry/_Entry";
import SwapImg from "@images/swap_icon.png";
import ArrowLeftSvg from "@images/arrow_left.svg?react";
import {
    useStore_IsBreakPoint,
    useStore_MessageFormat_ExampleViewFilter,
} from "@store";
import { useAppearance } from "@logics_configs";
import { ui_configs } from "@ui_configs";
import { ResetButton } from "@common_components";
import { useState, useEffect, useRef } from "react";

const EXAMPLE_TEXTS = {
    en: "Hello",
    ja: "こんにちは",
    ko: "안녕하세요",
    fr: "Bonjour",
};

export const MessageFormat = (props) => {
    const { currentIsBreakPoint } = useStore_IsBreakPoint();
    const message_format_container_class = clsx(styles.container, {
        [styles.is_break_point]: currentIsBreakPoint.data,
    });

    return (
        <div className={message_format_container_class}>
            <div className={styles.format_layout}>
                <ExampleComponent
                    format={props.variable.data}
                    format_id={props.format_id}
                />
                <InputComponent
                    variable={props.variable.data}
                    setFunction={props.setFunction}
                    format_id={props.format_id}
                />
            </div>
        </div>
    );
};

const ExampleComponent = ({ format, format_id }) => {
    const { currentUiLanguage } = useAppearance();
    const { t } = useTranslation();
    const {
        currentMessageFormat_ExampleViewFilter,
        updateMessageFormat_ExampleViewFilter,
    } = useStore_MessageFormat_ExampleViewFilter();

    const locale_base_path = "config_page.others.message_format_common.example_view.";

    const label_title = t(locale_base_path + "title");
    const label_original_translated = t(locale_base_path + "original_translated");
    const label_original_translated_multi = t(locale_base_path + "original_translated_multi");
    const label_translated_only_multi = t(locale_base_path + "translated_only_multi");
    const label_translated_only = t(locale_base_path + "translated_only");
    const label_original_only = t(locale_base_path + "original_only");

    const createExampleMessage = (id) => {
        let example_text_order = [];
        switch (currentUiLanguage.data) {
            case "ja":
                example_text_order = ["ja", "en", "ko", "fr"];
                break;
            case "ko":
                example_text_order = ["ko", "ja", "en", "fr"];
                break;
            default:
                example_text_order = ["en", "ja", "ko", "fr"];
                break;
        }

        const original = EXAMPLE_TEXTS[example_text_order[0]];
        const translations = example_text_order.slice(1).map(lang => EXAMPLE_TEXTS[lang]);

        const originalPart = `${format.message.prefix}${original}${format.message.suffix}`;
        const translationSingle = `${format.translation.prefix}${translations[0]}${format.translation.suffix}`;
        const translationMulti = `${format.translation.prefix}${translations.join(format.translation.separator)}${format.translation.suffix}`;

        switch (id) {
            case "original_translated":
                return format.translation_first
                    ? `${translationSingle}${format.separator}${originalPart}`
                    : `${originalPart}${format.separator}${translationSingle}`;

            case "original_only":
                return originalPart;

            case "translated_only":
                return translationSingle;

            case "translated_only_multi":
                return translationMulti;

            case "original_translated_multi":
                return format.translation_first
                    ? `${translationMulti}${format.separator}${originalPart}`
                    : `${originalPart}${format.separator}${translationMulti}`;

            default:
                return originalPart;
        }
    };

    const ExampleBox = ({ label, example_text_id }) => {
        return (
            <div className={styles.example_wrapper}>
                <div className={styles.example_meta}>
                    <span className={styles.example_label}>{label}</span>
                </div>
                <div className={styles.example_chatbox}>
                    <p className={styles.example_text}>{createExampleMessage(example_text_id)}</p>
                </div>
            </div>
        );
    };

    const svg_class_names = clsx(styles.arrow_left_svg, {
        [styles.to_down]: currentMessageFormat_ExampleViewFilter.data[format_id] === "Simplified",
        [styles.to_up]: currentMessageFormat_ExampleViewFilter.data[format_id] === "All"
    });

    const FilteredExampleBox = ({ format_id, id }) => {
        if (format_id === "send" && id === "Simplified") {
            return (
                <>
                    <ExampleBox label={label_original_translated} example_text_id="original_translated" />
                    <ExampleBox label={label_original_translated_multi} example_text_id="original_translated_multi" />
                </>
            );
        } else if (format_id === "send" && id === "All") {
            return (
                <>
                    <ExampleBox label={label_original_translated} example_text_id="original_translated" />
                    <ExampleBox label={label_original_translated_multi} example_text_id="original_translated_multi" />
                    <ExampleBox label={label_translated_only_multi} example_text_id="translated_only_multi" />
                    <ExampleBox label={label_translated_only} example_text_id="translated_only" />
                    <ExampleBox label={label_original_only} example_text_id="original_only" />
                </>
            );
        } else if (format_id === "received") {
            return (
                <>
                    <ExampleBox label={label_original_translated} example_text_id="original_translated" />
                    <ExampleBox label={label_original_only} example_text_id="original_only" />
                    <ExampleBox label={label_translated_only} example_text_id="translated_only" />
                </>
            );
        }
        return <ExampleBox label={label_original_translated} example_text_id="original_translated" />;
    };

    const exampleViewFilterToggleFunction = (format_id) => {
        if (["send", "received"].includes(format_id) === false) return;

        updateMessageFormat_ExampleViewFilter({
            ...currentMessageFormat_ExampleViewFilter.data,
            [format_id]: currentMessageFormat_ExampleViewFilter.data[format_id] === "Simplified"
                ? "All"
                : "Simplified"
        });
    };

    const isAll = currentMessageFormat_ExampleViewFilter.data[format_id] === "All";

    return (
        <section className={styles.example_container} aria-label={label_title}>
            <div className={styles.section_header}>
                <span className={styles.section_title}>{label_title}</span>
                <span className={styles.chatbox_badge}>VRChat Chatbox</span>
            </div>
            <div className={styles.example_view_container}>
                <FilteredExampleBox format_id={format_id} id={currentMessageFormat_ExampleViewFilter.data[format_id]} />
            </div>
            {format_id === "send" && (
                <button
                    type="button"
                    className={styles.show_more_container}
                    onClick={() => exampleViewFilterToggleFunction(format_id)}
                    aria-expanded={isAll}
                >
                    <span>{isAll ? "Show less" : "Show all examples"}</span>
                    <ArrowLeftSvg className={svg_class_names} />
                </button>
            )}
        </section>
    );
};

const InputComponent = ({ variable, setFunction, format_id }) => {
    const { t } = useTranslation();

    const locale_base_path = "config_page.others.message_format_common.settings.";
    const label_title = t(locale_base_path + "title");

    const LABEL_ORIGINAL = t(locale_base_path + "original");
    const LABEL_TRANSLATED = t(locale_base_path + "translated");
    const LABEL_FOR_MULTI_TRANSLATION = t(locale_base_path + "for_multi_translation");
    const LABEL_PREFIX = t(locale_base_path + "prefix") || "Prefix";
    const LABEL_SUFFIX = t(locale_base_path + "suffix") || "Suffix";
    const LABEL_SEPARATOR = t(locale_base_path + "separator") || "Line Separator (\\n)";
    const LABEL_MULTI_SEPARATOR = t(locale_base_path + "multi_separator") || "Separator (\\n)";
    const LABEL_SWAP = t(locale_base_path + "swap_order") || "Swap Order";

    const replaceValue = (value) => {
        if (value === "") return "";
        return value.replace(/\\n/g, "\n");
    };

    const [local_var, setLocalVar] = useState(variable);
    const debounce_ref = useRef(null);

    useEffect(() => {
        setLocalVar(variable);
    }, [variable]);

    useEffect(() => {
        return () => {
            if (debounce_ref.current) {
                clearTimeout(debounce_ref.current);
                debounce_ref.current = null;
            }
        };
    }, []);

    const scheduleUpdate = (new_var) => {
        if (debounce_ref.current) clearTimeout(debounce_ref.current);
        debounce_ref.current = setTimeout(() => {
            setFunction(new_var);
            debounce_ref.current = null;
        }, 500);
    };

    const handleChange = (parent_key, child_key) => (e) => {
        const raw_value = e.target.value;
        const parsed_value = replaceValue(raw_value);

        if (child_key !== undefined) {
            const new_var = {
                ...local_var,
                [parent_key]: {
                    ...local_var[parent_key],
                    [child_key]: parsed_value,
                },
            };
            setLocalVar(new_var);
            scheduleUpdate(new_var);
        } else {
            const new_var = {
                ...local_var,
                [parent_key]: parsed_value,
            };
            setLocalVar(new_var);
            scheduleUpdate(new_var);
        }
    };

    const toUiValue = (v) => {
        if (typeof v === "string") {
            return v.replace(/\n/g, "\\n");
        }
        return v ?? "";
    };

    const resetFunction = () => {
        const new_val = format_id === "send" ? ui_configs.send_message_format_parts : ui_configs.received_message_format_parts;
        setLocalVar(new_val);
        setFunction(new_val);
    };

    const swapMessageAndTranslate = () => {
        const new_var = { ...local_var, translation_first: !local_var.translation_first };
        setLocalVar(new_var);
        setFunction(new_var);
    };

    const OriginalBlock = () => (
        <div className={styles.input_contents}>
            <_Entry
                ui_variable={toUiValue(local_var.message.prefix)}
                placeholder={LABEL_PREFIX}
                onChange={handleChange("message", "prefix")}
            />
            <span className={styles.token_chip_original}>{LABEL_ORIGINAL}</span>
            <_Entry
                ui_variable={toUiValue(local_var.message.suffix)}
                placeholder={LABEL_SUFFIX}
                onChange={handleChange("message", "suffix")}
            />
        </div>
    );

    const TranslationBlock = () => (
        <div className={styles.input_contents}>
            <_Entry
                ui_variable={toUiValue(local_var.translation.prefix)}
                placeholder={LABEL_PREFIX}
                onChange={handleChange("translation", "prefix")}
            />
            <span className={styles.token_chip_translation}>{LABEL_TRANSLATED}</span>
            <_Entry
                ui_variable={toUiValue(local_var.translation.suffix)}
                placeholder={LABEL_SUFFIX}
                onChange={handleChange("translation", "suffix")}
            />
        </div>
    );

    const SeparatorBlock = () => (
        <div className={styles.separator_row}>
            <div className={styles.separator_line} />
            <div className={styles.separator_entry_box}>
                <_Entry
                    ui_variable={toUiValue(local_var.separator)}
                    placeholder={LABEL_SEPARATOR}
                    onChange={handleChange("separator")}
                />
            </div>
            <div className={styles.separator_line} />
        </div>
    );

    return (
        <section className={styles.message_format_settings_container} aria-label={label_title}>
            <div className={styles.settings_top_bar}>
                <span className={styles.section_title}>{label_title}</span>
                <div className={styles.settings_actions}>
                    <button
                        type="button"
                        className={styles.swap_button_wrapper}
                        onClick={swapMessageAndTranslate}
                        title={LABEL_SWAP}
                    >
                        <span className={styles.swap_text}>
                            {local_var.translation_first
                                ? `${LABEL_TRANSLATED} ➔ ${LABEL_ORIGINAL}`
                                : `${LABEL_ORIGINAL} ➔ ${LABEL_TRANSLATED}`}
                        </span>
                        <img className={styles.swap_img} src={SwapImg} alt="Swap" />
                    </button>
                    <ResetButton onClickFunction={resetFunction} />
                </div>
            </div>

            <div className={styles.builder_card}>
                <div className={styles.input_wrapper}>
                    {!local_var.translation_first ? (
                        <>
                            <OriginalBlock />
                            <SeparatorBlock />
                            <TranslationBlock />
                        </>
                    ) : (
                        <>
                            <TranslationBlock />
                            <SeparatorBlock />
                            <OriginalBlock />
                        </>
                    )}
                </div>

                {format_id === "send" && (
                    <div className={styles.multi_translation_input_wrapper}>
                        <div className={styles.multi_translation_header}>
                            <span className={styles.multi_translation_title}>{LABEL_FOR_MULTI_TRANSLATION}</span>
                        </div>
                        <div className={styles.multi_translation_row}>
                            <span className={styles.token_chip_translation_sub}>{LABEL_TRANSLATED} 1</span>
                            <div className={styles.multi_separator_entry}>
                                <_Entry
                                    ui_variable={toUiValue(local_var.translation.separator)}
                                    placeholder={LABEL_MULTI_SEPARATOR}
                                    onChange={handleChange("translation", "separator")}
                                />
                            </div>
                            <span className={styles.token_chip_translation_sub}>{LABEL_TRANSLATED} 2</span>
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
};
