import { useStore_SelectedConfigTabId } from "@store";

import {
    Device,
    Appearance,
    Translation,
    Transcription,
    Others,
    AdvancedSettings,
    Vr,
    Hotkeys,
    AboutVrct,
} from "@setting_box";
import { ModelAndProvider } from "./model_and_provider/ModelAndProvider";

export const SettingBox = () => {
    const { currentSelectedConfigTabId } = useStore_SelectedConfigTabId();
    switch (currentSelectedConfigTabId.data) {
        case "device":
            return <Device />;
        case "appearance":
            return <Appearance />;
        case "translation":
            return <Translation />;
        case "transcription":
            return <Transcription />;
        case "model_and_provider":
            return <ModelAndProvider />;
        case "others":
            return <Others />;
        case "vr":
            return <Vr />;
        case "hotkeys":
            return <Hotkeys />;
        case "advanced_settings":
            return <AdvancedSettings />;
        case "about":
            return <AboutVrct />;

        default:
            return null;
    }
};
