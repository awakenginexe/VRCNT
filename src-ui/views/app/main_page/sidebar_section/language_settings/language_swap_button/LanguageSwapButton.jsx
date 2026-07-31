import clsx from "clsx";
import { useI18n } from "@useI18n";
import NarrowArrowDownSvg from "@images/narrow_arrow_down.svg?react";
import { useLanguageSettings } from "@logics_main";
import styles from "./LanguageSwapButton.module.scss";


export const LanguageSwapButton = () => {
    const { t } = useI18n();
    const { swapSelectedLanguages } = useLanguageSettings();
    const label = t("main_page.language_panels.swap_complete_profiles");

    return (
        <div className={styles.container}>
            <button
                type="button"
                className={styles.swap_button_wrapper}
                onClick={swapSelectedLanguages}
                aria-label={label}
            >
                <NarrowArrowDownSvg
                    className={clsx(styles.narrow_arrow_down_svg, styles.reverse)}
                    aria-hidden="true"
                />
                <span className={styles.label}>{label}</span>
                <NarrowArrowDownSvg className={styles.narrow_arrow_down_svg} aria-hidden="true" />
            </button>
        </div>
    );
};
