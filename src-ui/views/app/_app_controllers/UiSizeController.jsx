import { useEffect } from "react";
import { useAppearance } from "@logics_configs";

export const UI_BASE_FONT_SIZE_PERCENT = 70;

export const UiSizeController = () => {
    const { currentUiScaling } = useAppearance();
    const font_size = UI_BASE_FONT_SIZE_PERCENT * currentUiScaling.data / 100;

    useEffect(() => {
        document.documentElement.style.setProperty("font-size", `${font_size}%`);
    }, [currentUiScaling.data]);

    return null;
};
