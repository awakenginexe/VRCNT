import clsx from "clsx";
import styles from "./MainPage.module.scss";
import { MainSection } from "./main_section/MainSection";
import { GuidedSetup } from "./guided_setup/GuidedSetup";
import { EnginesWorkspace } from "./engines/EnginesWorkspace";
import { ModelsHub } from "./models/ModelsHub";
import { useIsOpenedConfigPage } from "@logics_common";
import { useStore_ExperienceRoute } from "@store";

export const MainPage = () => {
    const { currentIsOpenedConfigPage } = useIsOpenedConfigPage();
    const { currentExperienceRoute } = useStore_ExperienceRoute();

    return (
        <div className={clsx(styles.page, styles.main_page, {
            [styles.show_config]: currentIsOpenedConfigPage.data,
            [styles.show_main]: !currentIsOpenedConfigPage.data
        })}>
            <div className={styles.container}>
                {currentExperienceRoute.data === "setup" ? <GuidedSetup /> :
                    currentExperienceRoute.data === "engines" ? <EnginesWorkspace /> :
                        currentExperienceRoute.data === "models" ? <ModelsHub /> : <MainSection />}
            </div>
        </div>
    );
};
