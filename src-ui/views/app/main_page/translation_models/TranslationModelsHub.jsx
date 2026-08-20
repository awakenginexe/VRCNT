import { useI18n } from "@useI18n";
import { useIsOpenedConfigPage } from "@logics_common";
import {
    useStore_ExperienceRoute,
    useStore_SelectedConfigTabId,
} from "@store";
import { TranslationModels } from "../../config_page/setting_section/setting_box/translation_models/TranslationModels";
import { TranslationRoutingCard } from "../engines/TranslationRoutingCard.jsx";
import { TopBar } from "../main_section/top_bar/TopBar";
import styles from "./TranslationModelsHub.module.scss";

export const TranslationModelsHub = () => {
    const { t } = useI18n();
    const { updateExperienceRoute } = useStore_ExperienceRoute();
    const { updateSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const { setIsOpenedConfigPage } = useIsOpenedConfigPage();

    const openAdvanced = () => {
        updateSelectedConfigTabId("model_and_provider");
        setIsOpenedConfigPage(true);
    };

    return (
        <div className={styles.container}>
            <TopBar />
            <main className={styles.content}>
                <section className={styles.hero}>
                    <div>
                        <p className={styles.eyebrow}>
                            {t("main_page.translation_models.eyebrow")}
                        </p>
                        <h1>{t("main_page.translation_models.title")}</h1>
                        <p>{t("main_page.translation_models.detail")}</p>
                    </div>
                    <button
                        type="button"
                        className={styles.back_button}
                        onClick={() => updateExperienceRoute("live")}
                    >
                        {t("main_page.translation_models.back_to_live")}
                    </button>
                </section>

                <TranslationRoutingCard />

                <section
                    className={styles.catalog}
                    aria-label={t("main_page.translation_models.title")}
                >
                    <TranslationModels mode="presets" showDescription={false} onOpenAdvanced={openAdvanced} />
                </section>
            </main>
        </div>
    );
};
