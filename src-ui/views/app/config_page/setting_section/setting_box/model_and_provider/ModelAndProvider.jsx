import { useI18n } from "@useI18n";
import { TranslationModels } from "../translation_models/TranslationModels";
import { CloudTranslationProviders } from "../translation/Translation";
import { Transcription } from "../transcription/Transcription";
import styles from "./ModelAndProvider.module.scss";

export const ModelAndProvider = () => {
    const { t } = useI18n();

    return (
        <div className={styles.workspace}>
            <section
                className={styles.column}
                aria-labelledby="model-provider-speech-heading"
                data-settings-pane="transcription"
            >
                <header className={styles.column_header}>
                    <h2 id="model-provider-speech-heading">
                        {t("config_page.model_and_provider.speech_models")}
                    </h2>
                </header>
                <div className={styles.column_content}>
                    <Transcription />
                </div>
            </section>

            <div className={styles.divider} aria-hidden="true" />

            <section
                className={styles.column}
                aria-labelledby="model-provider-translation-models-heading"
                data-settings-pane="translation_models"
            >
                <header className={styles.column_header}>
                    <h2 id="model-provider-translation-models-heading">
                        {t("config_page.translation_models.title")}
                    </h2>
                </header>
                <div className={styles.column_content}>
                    <TranslationModels />
                </div>
            </section>

            <section
                className={styles.provider_section}
                aria-labelledby="model-provider-cloud-heading"
                data-settings-pane="translation"
            >
                <header className={styles.provider_header}>
                    <h2 id="model-provider-cloud-heading">
                        {t("config_page.model_and_provider.cloud_translation_providers.title")}
                    </h2>
                    <p>
                        {t("config_page.model_and_provider.cloud_translation_providers.description")}
                    </p>
                </header>
                <div className={styles.provider_content}>
                    <CloudTranslationProviders />
                </div>
            </section>
        </div>
    );
};
