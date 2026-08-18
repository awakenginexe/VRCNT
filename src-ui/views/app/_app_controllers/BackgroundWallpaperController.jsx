import { useEffect } from "react";
import { useCustomBackground } from "@logics_common";

export const BackgroundWallpaperController = () => {
    const { bgImage, blur, dim } = useCustomBackground();

    useEffect(() => {
        const root = document.documentElement;
        if (root) {
            root.style.setProperty("--app-bg-image", `url("${bgImage}")`);
            root.style.setProperty("--app-bg-blur", `${blur}px`);
            root.style.setProperty("--app-bg-dim", `${dim / 100}`);
        }
    }, [bgImage, blur, dim]);

    return null;
};
