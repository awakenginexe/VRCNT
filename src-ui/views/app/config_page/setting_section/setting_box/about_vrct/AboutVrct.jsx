import styles from "./AboutVrct.module.scss";
import logoBadge from "@images/vrcnt_logo_badge.png";
import ExternalLink from "@images/external_link.svg?react";
import { useI18n } from "@useI18n";
import packageInfo from "@root/package.json";

export const AboutVrct = () => {
    const { t } = useI18n();
    const version = packageInfo.version;

    return (
        <div className={styles.container}>
            <section className={styles.hero}>
                <img className={styles.logo_mark} src={logoBadge} alt="VRCNT" />
                <div className={styles.hero_text}>
                    <div className={styles.identity_line}>
                        <span className={styles.product_name}>VRCNT</span>
                        <span className={styles.version}>
                            {t("about_page.version", { version })}
                        </span>
                    </div>
                    <h1 className={styles.title}>{t("about_page.title")}</h1>
                    <p className={styles.description}>
                        {t("about_page.description")}
                    </p>
                </div>
            </section>

            <section className={styles.repositories} aria-labelledby="about-repositories">
                <div className={styles.section_heading}>
                    <h2 id="about-repositories">{t("about_page.repositories_title")}</h2>
                    <p>{t("about_page.repositories_description")}</p>
                </div>
                <div className={styles.repository_links}>
                    <a
                        className={styles.repository_link}
                        href="https://github.com/awakenginexe/VRCNT"
                        target="_blank"
                        rel="noreferrer"
                    >
                        <span>
                            <strong>{t("about_page.vrcnt_repository")}</strong>
                            <small>github.com/awakenginexe/VRCNT</small>
                        </span>
                        <ExternalLink aria-hidden="true" />
                    </a>
                    <a
                        className={styles.repository_link}
                        href="https://github.com/misyaguziya/VRCT"
                        target="_blank"
                        rel="noreferrer"
                    >
                        <span>
                            <strong>{t("about_page.vrct_repository")}</strong>
                            <small>github.com/misyaguziya/VRCT</small>
                        </span>
                        <ExternalLink aria-hidden="true" />
                    </a>
                </div>
            </section>

            <section className={styles.lineage} aria-labelledby="about-lineage">
                <div className={styles.section_heading}>
                    <h2 id="about-lineage">{t("about_page.lineage_title")}</h2>
                    <p>{t("about_page.lineage_description")}</p>
                </div>
                <dl className={styles.lineage_summary}>
                    <div>
                        <dt>{t("about_page.origin_label")}</dt>
                        <dd>{t("about_page.origin_value")}</dd>
                    </div>
                    <div>
                        <dt>{t("about_page.current_label")}</dt>
                        <dd>{t("about_page.current_value")}</dd>
                    </div>
                </dl>
            </section>

            <section className={styles.disclaimer}>
                <h2>{t("about_page.independence_title")}</h2>
                <p>{t("about_page.independence_description")}</p>
            </section>

            <section className={styles.disclaimer} aria-labelledby="about-fonts">
                <h2 id="about-fonts">Third-party fonts</h2>
                <p>
                    VRCNT Noto uses Google Fonts Noto assets under OFL-1.1. The exact source revision is
                    {" "}2796410152d4f9524b68ed46e69c1b60f8e0f7c3; see the bundled NOTICE.md and each pack’s OFL.txt.
                </p>
            </section>
        </div>
    );
};
