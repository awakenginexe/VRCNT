import { createCategoryHook } from "./config_page_setter/ui_config_setter.js";

export const UI_SCALE_MIN = 40;
export const UI_SCALE_MAX = 200;
export const UI_SCALE_STEP = 10;
export const UI_SCALE_MARKS = [40, 60, 80, 100, 120, 140, 160, 180, 200];

export const useAppearance = createCategoryHook("Appearance");
export const useDevice = createCategoryHook("Device");
export const useTranslation = createCategoryHook("Translation");
export const useTranscription = createCategoryHook("Transcription");
export const useVr = createCategoryHook("Vr");
export const useOthers = createCategoryHook("Others");
export const useAdvancedSettings = createCategoryHook("AdvancedSettings");

// Exceptional exports that are not part of SETTINGS_ARRAY or have custom logic.
export { useHotkeys } from "./config_page_setter/hotkeys/useHotkeys.js";
export { useSupporters } from "./config_page_setter/supporters/useSupporters.js";

export { useSettingBoxScrollPosition } from "./config_page_setter/_aux/useSettingBoxScrollPosition.js";


export {
    useSliderLogic,
    useSaveButtonLogic,
} from "./config_page_setter/useSettingsLogics.js";
