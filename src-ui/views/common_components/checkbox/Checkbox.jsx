import clsx from "clsx";
import styles from "./Checkbox.module.scss";
import { isCheckboxInputDisabled } from "./checkboxState.js";
export const Checkbox = ({
    checkboxId,
    variable,
    is_available = true,
    toggleFunction,
    size = "2.8rem",
    borderWidth = "0.2rem",
    padding = "2rem",
}) => {

    const is_disabled = isCheckboxInputDisabled({ is_available, variable });

    const wrapper_class_names = clsx(styles.checkbox_wrapper, {
        [styles.is_disabled]: !is_available,
        [styles.is_pending]: variable.state === "pending",
    });

    return (
        <div className={styles.checkbox_container}>
            <label
                className={wrapper_class_names}
                htmlFor={checkboxId}
                style={{
                    "--checkbox-size": size,
                    "--checkbox-border-width": borderWidth,
                    "--checkbox-padding": padding,
                }}
            >
                {variable.state === "pending" ? (
                    <span className={styles.loader}></span>
                ) : (
                    <input
                        type="checkbox"
                        id={checkboxId}
                        checked={variable.data}
                        disabled={is_disabled}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => {
                            if (toggleFunction) {
                                toggleFunction();
                            }
                        }}
                    />
                )}
                <span className={styles.cbx}>
                    <svg viewBox="0 0 12 12">
                        <polyline points="1 6.29411765 4.5 10 11 1"></polyline>
                    </svg>
                </span>
            </label>
        </div>
    );
};
