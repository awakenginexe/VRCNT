import { useLayoutEffect } from "react";
import { useStore_EnablePerformanceMode } from "@store";

export const PerformanceModeController = () => {
    const { currentEnablePerformanceMode } = useStore_EnablePerformanceMode();

    useLayoutEffect(() => {
        if (currentEnablePerformanceMode.data) {
            document.documentElement.classList.add("performance_mode");
            document.documentElement.dataset.performanceMode = "true";
        } else {
            document.documentElement.classList.remove("performance_mode");
            delete document.documentElement.dataset.performanceMode;
        }
    }, [currentEnablePerformanceMode.data]);

    return null;
};
