import { useI18n } from "@useI18n";
import { Translation } from "../translation/Translation";
import { Transcription } from "../transcription/Transcription";
import styles from "./ModelAndProvider.module.scss";

export const ModelAndProvider = () => {
    const { t } = useI18n();

    return (
        <div className={styles.workspace}>
            <section
                className={styles.column}
                aria-labelledby="model-provider-translation-heading"
                data-settings-pane="translation"
            >
                <header className={styles.column_header}>
                    <h2 id="model-provider-translation-heading">
                        {t("config_page.side_menu_labels.translation")}
                    </h2>
                </header>
                <div className={styles.column_content}>
                    <Translation />
                </div>
            </section>

            <div className={styles.divider} aria-hidden="true" />

            <section
                className={styles.column}
                aria-labelledby="model-provider-transcription-heading"
                data-settings-pane="transcription"
            >
                <header className={styles.column_header}>
                    <h2 id="model-provider-transcription-heading">
                        {t("config_page.side_menu_labels.transcription")}
                    </h2>
                </header>
                <div className={styles.column_content}>
                    <Transcription />
                </div>
            </section>
        </div>
    );
};
