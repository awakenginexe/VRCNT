import { useI18n } from "@useI18n";
import styles from "./SectionTitleBox.module.scss";
import { useStore_SelectedConfigTabId } from "@store";

export const SectionTitleBox = () => {
    const { t } = useI18n();
    const { currentSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const getTitle = () => {
        if (currentSelectedConfigTabId.data === "vr") return "VR";
        if (currentSelectedConfigTabId.data === "model_and_provider") {
            return t("config_page.focus_settings.section_labels.model_and_provider");
        }
        if (currentSelectedConfigTabId.data === "about") {
            return t("config_page.focus_settings.section_labels.about");
        }
        return t(`config_page.side_menu_labels.${currentSelectedConfigTabId.data}`);
    };
    return (
        <div className={styles.container}>
            <p className={styles.title}>{getTitle()}</p>
        </div>
    );
};
