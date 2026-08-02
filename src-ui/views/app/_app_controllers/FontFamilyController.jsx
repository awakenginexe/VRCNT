import { useEffect } from "react";
import { useAppearance } from "@logics_configs";
import { applyManagedFontVariables } from "@logics_common";

export const FontFamilyController = () => {
    const { currentSelectedFontFamily } = useAppearance();
    useEffect(() => {
        applyManagedFontVariables(document.documentElement, currentSelectedFontFamily.data);
    }, [currentSelectedFontFamily.data]);

    return null;
};
