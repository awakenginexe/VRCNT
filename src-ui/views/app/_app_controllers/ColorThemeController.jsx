import { useLayoutEffect, useRef } from "react";

import { useAppearance } from "@logics_configs";
import { getAppCssVariables, useIsBackendReady } from "@logics_common";

export const ColorThemeController = () => {
    const { currentAppColorPalette, getAppColorPalette } = useAppearance();
    const { currentIsBackendReady } = useIsBackendReady();
    const appliedVariableNames = useRef(new Set());
    const hasRequestedPalette = useRef(false);

    useLayoutEffect(() => {
        if (currentIsBackendReady.data !== true) return;
        if (hasRequestedPalette.current) return;
        hasRequestedPalette.current = true;
        getAppColorPalette?.();
    }, [getAppColorPalette, currentIsBackendReady.data]);

    useLayoutEffect(() => {
        const palette = currentAppColorPalette?.data;
        if (!palette || typeof document === "undefined") return;

        const root = document.documentElement;
        const variables = getAppCssVariables(palette);
        for (const variableName of appliedVariableNames.current) {
            if (!Object.hasOwn(variables, variableName)) {
                root.style.removeProperty(variableName);
            }
        }
        for (const [variableName, value] of Object.entries(variables)) {
            root.style.setProperty(variableName, value);
        }
        appliedVariableNames.current = new Set(Object.keys(variables));
    }, [currentAppColorPalette?.data]);

    return null;
};
