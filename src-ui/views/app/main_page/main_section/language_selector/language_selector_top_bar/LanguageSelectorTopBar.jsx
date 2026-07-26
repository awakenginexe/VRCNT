import { useI18n } from "@useI18n";
import styles from "./LanguageSelectorTopBar.module.scss";
import { useStore_IsOpenedLanguageSelector } from "@store";

export const LanguageSelectorTopBar = ({ title, titleId }) => {
    const { t } = useI18n();
    const { updateIsOpenedLanguageSelector } = useStore_IsOpenedLanguageSelector();
    const closeLanguageSelector = () => {
        updateIsOpenedLanguageSelector({
            your_language: false,
            your_translation_language: false,
            target_language: false,
            target_key: "1"
        });
    };

    return (
        <div className={styles.container}>
            <div className={styles.title_copy}>
                <p className={styles.title} id={titleId}>{title}</p>
                <p className={styles.subtitle}>{t("main_page.language_selector.picker_detail")}</p>
            </div>
            <button
                type="button"
                className={styles.close_button}
                onClick={closeLanguageSelector}
                aria-label={t("main_page.language_selector.close")}
            >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m6.7 5.3 5.3 5.3 5.3-5.3 1.4 1.4-5.3 5.3 5.3 5.3-1.4 1.4-5.3-5.3-5.3 5.3-1.4-1.4 5.3-5.3-5.3-5.3 1.4-1.4Z" />
                </svg>
            </button>
        </div>
    );
};
