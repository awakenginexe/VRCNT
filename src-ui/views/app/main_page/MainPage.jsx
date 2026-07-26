import clsx from "clsx";
import styles from "./MainPage.module.scss";
import { MainSection } from "./main_section/MainSection";
import { useIsOpenedConfigPage } from "@logics_common";

export const MainPage = () => {
    const { currentIsOpenedConfigPage } = useIsOpenedConfigPage();

    return (
        <div className={clsx(styles.page, styles.main_page, {
            [styles.show_config]: currentIsOpenedConfigPage.data,
            [styles.show_main]: !currentIsOpenedConfigPage.data
        })}>
            <div className={styles.container}>
                <MainSection />
            </div>
        </div>
    );
};
