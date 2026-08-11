import { useEffect, useRef } from "react";

import { useOnboarding } from "@logics_configs";
import {
    useIsBackendReady,
    useIsOpenedConfigPage,
} from "@logics_common";
import { shouldOpenFirstRunSetup } from "@logics_common/firstRunSetupState.js";
import { useStore_ExperienceRoute } from "@store";

export const FirstRunSetupController = () => {
    const { currentIsBackendReady } = useIsBackendReady();
    const { currentSetupCompleted } = useOnboarding();
    const { setIsOpenedConfigPage } = useIsOpenedConfigPage();
    const { updateExperienceRoute } = useStore_ExperienceRoute();
    const hasDecidedRef = useRef(false);

    useEffect(() => {
        if (hasDecidedRef.current) return;
        if (currentIsBackendReady.data !== true) return;
        if (currentSetupCompleted.state !== "ok") return;

        const shouldOpen = shouldOpenFirstRunSetup({
            isBackendReady: currentIsBackendReady.data,
            setupCompleted: currentSetupCompleted.data,
            alreadyDecided: hasDecidedRef.current,
        });

        hasDecidedRef.current = true;

        if (!shouldOpen) return;

        setIsOpenedConfigPage(false);
        updateExperienceRoute("setup");
    }, [
        currentIsBackendReady.data,
        currentSetupCompleted.data,
        currentSetupCompleted.state,
        setIsOpenedConfigPage,
        updateExperienceRoute,
    ]);

    return null;
};
