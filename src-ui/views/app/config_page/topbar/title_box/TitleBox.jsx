import { useI18n } from "@useI18n";
import logoBadge from "@images/vrcnt_logo_badge.png";

import styles from "./TitleBox.module.scss";

export const TitleBox = () => {
    const { t } = useI18n();
    return (
        <div className={styles.container}>
            <img className={styles.logo_mark} src={logoBadge} alt="VRCNT" />
            <div>
                <p id="config-page-title" className={styles.title}>VRCNT</p>
                <p className={styles.subtitle}>{t("config_page.focus_settings.settings_title")}</p>
            </div>
        </div>
    );
};
