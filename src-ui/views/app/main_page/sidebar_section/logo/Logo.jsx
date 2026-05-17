import styles from "./Logo.module.scss";
import logoBadge from "@images/vrcnt_logo_badge.png";

export const Logo = () => {
    return (
        <div className={styles.container}>
            <LogoBox />
        </div>
    );
};


import { useIsMainPageCompactMode } from "@logics_main";

export const LogoBox = () => {
    const { currentIsMainPageCompactMode } = useIsMainPageCompactMode();
    if (currentIsMainPageCompactMode.data === true) {
        return <img className={styles.compact_mark} src={logoBadge} alt="VRCNT" />;
    } else {
        return (
            <div className={styles.logo} aria-label="VRCNT">
                <img className={styles.logo_badge} src={logoBadge} alt="" />
                <div className={styles.brand_text}>
                    <p className={styles.brand_name}>VRCNT</p>
                    <p className={styles.brand_subtitle}>Next Translation</p>
                </div>
            </div>
        );
    }
};
