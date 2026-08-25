import clsx from "clsx";
import { useSyncExternalStore } from "react";
import styles from "./MainPage.module.scss";
import { MainSection } from "./main_section/MainSection";
import { GuidedSetup } from "./guided_setup/GuidedSetup";
import { ModelsHub } from "./models/ModelsHub";
import { TranslationModelsHub } from "./translation_models/TranslationModelsHub";
import { OverlayStudio } from "./overlay_studio/OverlayStudio";
import { OscStudio } from "./osc_studio/OscStudio";
import { ColorCustomization } from "./color_customization/ColorCustomization";
import { OnboardingTour } from "./main_section/OnboardingTour";
import { useIsOpenedConfigPage } from "@logics_common";
import { useStore_ExperienceRoute } from "@store";
import {
    getOnboardingTourSnapshot,
    subscribeToOnboardingTour,
} from "@logics_common/onboardingTourState.js";

export const MainPage = () => {
    const { currentIsOpenedConfigPage } = useIsOpenedConfigPage();
    const { currentExperienceRoute } = useStore_ExperienceRoute();
    const onboardingSnapshot = useSyncExternalStore(
        subscribeToOnboardingTour,
        getOnboardingTourSnapshot,
        getOnboardingTourSnapshot,
    );
    const isProductTourActive = onboardingSnapshot.active && onboardingSnapshot.phase === "tour";

    return (
        <div className={clsx(styles.page, styles.main_page, {
            [styles.show_config]: currentIsOpenedConfigPage.data,
            [styles.show_main]: !currentIsOpenedConfigPage.data
        })}>
            <div
                className={styles.container}
                inert={isProductTourActive ? "" : undefined}
                aria-hidden={isProductTourActive || undefined}
            >
                {currentExperienceRoute.data === "setup" ? <GuidedSetup /> :
                    currentExperienceRoute.data === "engines" || currentExperienceRoute.data === "models" ? <ModelsHub /> :
                                currentExperienceRoute.data === "translation_models" ? <TranslationModelsHub /> :
                                    currentExperienceRoute.data === "overlay" ? <OverlayStudio /> :
                                        currentExperienceRoute.data === "osc" ? <OscStudio /> :
                                            currentExperienceRoute.data === "customize" ? <ColorCustomization /> : <MainSection />}
            </div>
            <OnboardingTour />
        </div>
    );
};
