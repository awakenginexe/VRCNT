import { useEffect, useState } from "react";
import defaultBgUrl from "@images/default_background.jpg";

const STORAGE_KEY = "vrcnt_wallpaper_custom_v1";

export const DEFAULT_BG_SETTINGS = {
    customImage: null, // null means use defaultBgUrl
    blur: 8,           // Gaussian blur in px
    dim: 20,           // Dark overlay opacity in %
};

const listeners = new Set();
let memoryState = null;

const loadInitialState = () => {
    if (memoryState) return memoryState;
    try {
        if (typeof window !== "undefined" && window.localStorage) {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                memoryState = {
                    customImage: parsed.customImage || null,
                    blur: typeof parsed.blur === "number" ? parsed.blur : DEFAULT_BG_SETTINGS.blur,
                    dim: typeof parsed.dim === "number" ? parsed.dim : DEFAULT_BG_SETTINGS.dim,
                };
                return memoryState;
            }
        }
    } catch {
        // Fallback to default
    }
    memoryState = { ...DEFAULT_BG_SETTINGS };
    return memoryState;
};

const saveState = (nextState) => {
    memoryState = nextState;
    try {
        if (typeof window !== "undefined" && window.localStorage) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
        }
    } catch {
        // Ignore storage errors
    }
    listeners.forEach((listener) => listener(memoryState));
};

export const useCustomBackground = () => {
    const [state, setState] = useState(loadInitialState);

    useEffect(() => {
        listeners.add(setState);
        return () => {
            listeners.delete(setState);
        };
    }, []);

    const setCustomImage = (dataUrl) => {
        saveState({
            ...memoryState,
            customImage: dataUrl,
        });
    };

    const setBlur = (blur) => {
        saveState({
            ...memoryState,
            blur: Math.max(0, Math.min(50, Number(blur))),
        });
    };

    const setDim = (dim) => {
        saveState({
            ...memoryState,
            dim: Math.max(0, Math.min(90, Number(dim))),
        });
    };

    const resetToDefault = () => {
        saveState({ ...DEFAULT_BG_SETTINGS });
    };

    const activeImageUrl = state.customImage || defaultBgUrl;
    const isCustom = Boolean(state.customImage);

    return {
        bgImage: activeImageUrl,
        isCustom,
        blur: state.blur,
        dim: state.dim,
        setCustomImage,
        setBlur,
        setDim,
        resetToDefault,
        defaultBgUrl,
        DEFAULT_BG_SETTINGS,
    };
};

export const processWallpaperFile = (file) => new Promise((resolve, reject) => {
    if (!file) {
        reject(new Error("No file provided"));
        return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = (e) => {
        const rawDataUrl = e.target?.result;
        if (typeof rawDataUrl !== "string") {
            reject(new Error("Invalid file content"));
            return;
        }

        const img = new Image();
        img.onerror = () => resolve(rawDataUrl);
        img.onload = () => {
            try {
                const MAX_WIDTH = 2560;
                const MAX_HEIGHT = 1440;
                let { width, height } = img;

                if (width > MAX_WIDTH || height > MAX_HEIGHT) {
                    const ratio = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
                    width = Math.round(width * ratio);
                    height = Math.round(height * ratio);
                }

                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                if (!ctx) {
                    resolve(rawDataUrl);
                    return;
                }
                ctx.drawImage(img, 0, 0, width, height);
                const optimizedDataUrl = canvas.toDataURL("image/jpeg", 0.88);
                resolve(optimizedDataUrl);
            } catch {
                resolve(rawDataUrl);
            }
        };
        img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
});
