import { useStore_SelectedPresetTabNumber, useStore_SelectedYourLanguages, useStore_SelectedYourTranslationLanguages, useStore_SelectedTargetLanguages, useStore_TranscriptionLanguageCapabilities, useStore_TranslationEngines, useStore_SelectedTranslationEngines, useStore_TranslationEngineSelectionTransition, useStore_CTranslate2AutoFallback, useStore_SelectableLanguageList } from "@store";
import { useStdoutToPython } from "@useStdoutToPython";
import { translator_status } from "@ui_configs";
import { useI18n } from "@useI18n";
import { useNotificationStatus } from "../common/useNotificationStatus";
import {
    enabledSlotKeys,
    findDuplicateSlot,
    nextDisabledSlotKey,
    removeLanguageSlot,
    setLanguageSlot,
} from "../common/languageProfileUtils.js";

export const useLanguageSettings = () => {
    const { asyncStdoutToPython } = useStdoutToPython();
    const { showNotification_Error } = useNotificationStatus();
    const { t } = useI18n();

    const {
        currentSelectedYourLanguages,
        updateSelectedYourLanguages,
        pendingSelectedYourLanguages,
    } = useStore_SelectedYourLanguages();
    const {
        currentSelectedYourTranslationLanguages,
        updateSelectedYourTranslationLanguages,
        pendingSelectedYourTranslationLanguages,
    } = useStore_SelectedYourTranslationLanguages();
    const {
        currentSelectedTargetLanguages,
        updateSelectedTargetLanguages,
        pendingSelectedTargetLanguages,
    } = useStore_SelectedTargetLanguages();
    const {
        currentTranscriptionLanguageCapabilities,
        updateTranscriptionLanguageCapabilities,
    } = useStore_TranscriptionLanguageCapabilities();
    const {
        currentSelectedPresetTabNumber,
        updateSelectedPresetTabNumber,
        pendingSelectedPresetTabNumber,
    } = useStore_SelectedPresetTabNumber();
    const {
        currentTranslationEngines,
        updateTranslationEngines,
        pendingTranslationEngines,
    } = useStore_TranslationEngines();
    const {
        currentSelectedTranslationEngines,
        updateSelectedTranslationEngines: commitSelectedTranslationEngines,
        pendingSelectedTranslationEngines,
    } = useStore_SelectedTranslationEngines();
    const {
        currentTranslationEngineSelectionTransition,
        updateTranslationEngineSelectionTransition,
    } = useStore_TranslationEngineSelectionTransition();
    const {
        currentCTranslate2AutoFallback,
        updateCTranslate2AutoFallback,
        pendingCTranslate2AutoFallback,
    } = useStore_CTranslate2AutoFallback();

    const {
        currentSelectableLanguageList,
        updateSelectableLanguageList,
    } = useStore_SelectableLanguageList();

    const getPresetKey = () => currentSelectedPresetTabNumber.data ?? "1";

    const createFallbackYourLanguages = () => ({
        1: { language: "", country: "", enable: true },
        2: { language: "English", country: "United States", enable: false },
        3: { language: "Chinese Simplified", country: "China", enable: false },
    });

    const createFallbackTargetLanguages = () => ({
        1: { language: "", country: "", enable: true },
        2: { language: "", country: "", enable: false },
        3: { language: "", country: "", enable: false },
    });

    const getCurrentYourLanguages = () => {
        const presetKey = getPresetKey();
        return {
            ...createFallbackYourLanguages(),
            ...(currentSelectedYourLanguages.data?.[presetKey] ?? {}),
        };
    };

    const getCurrentTargetLanguages = () => {
        const presetKey = getPresetKey();
        return {
            ...createFallbackTargetLanguages(),
            ...(currentSelectedTargetLanguages.data?.[presetKey] ?? {}),
        };
    };


    const getSelectedPresetTabNumber = () => {
        pendingSelectedPresetTabNumber();
        asyncStdoutToPython("/get/data/selected_tab_no");
    };

    const setSelectedPresetTabNumber = (preset_number) => {
        pendingSelectedPresetTabNumber();

        asyncStdoutToPython("/set/data/selected_tab_no", preset_number);
    };


    const getSelectedYourLanguages = () => {
        pendingSelectedPresetTabNumber();
        asyncStdoutToPython("/get/data/selected_your_languages");
    };

    const setSelectedYourLanguages = (selected_language_data) => {
        const presetKey = getPresetKey();
        const send_obj = structuredClone(currentSelectedYourLanguages.data ?? {});
        send_obj[presetKey] = {
            ...createFallbackYourLanguages(),
            ...(send_obj[presetKey] ?? {}),
        };
        const targetKey = selected_language_data.target_key ?? "1";
        if (findDuplicateSlot(send_obj[presetKey], selected_language_data, targetKey)) {
            showNotification_Error(
                t("main_page.language_panels.duplicate_language"),
                { category_id: "duplicate_language" },
            );
            return false;
        }
        send_obj[presetKey] = setLanguageSlot(
            send_obj[presetKey],
            targetKey,
            selected_language_data,
        );
        pendingSelectedYourLanguages();
        asyncStdoutToPython("/set/data/selected_your_languages", send_obj);
        return true;
    };

    const addYourLanguage = () => {
        return nextDisabledSlotKey(getCurrentYourLanguages());
    };

    const removeYourLanguage = (targetKey) => {
        const presetKey = getPresetKey();
        const send_obj = structuredClone(currentSelectedYourLanguages.data ?? {});
        send_obj[presetKey] = {
            ...createFallbackYourLanguages(),
            ...(send_obj[presetKey] ?? {}),
        };
        const removalKey = targetKey ?? enabledSlotKeys(send_obj[presetKey]).at(-1);
        const updated = removeLanguageSlot(send_obj[presetKey], removalKey);
        if (updated === send_obj[presetKey]) return false;
        send_obj[presetKey] = updated;
        pendingSelectedYourLanguages();
        asyncStdoutToPython("/set/data/selected_your_languages", send_obj);
        return true;
    };

    const getSelectedYourTranslationLanguages = () => {
        pendingSelectedYourTranslationLanguages();
        asyncStdoutToPython("/get/data/selected_your_translation_languages");
    };

    const setSelectedYourTranslationLanguages = (selected_language_data) => {
        pendingSelectedYourTranslationLanguages();
        const presetKey = getPresetKey();
        const send_obj = structuredClone(currentSelectedYourTranslationLanguages.data ?? {});
        send_obj[presetKey] = {
            ...createFallbackYourLanguages(),
            ...(send_obj[presetKey] ?? {}),
        };
        send_obj[presetKey] = setLanguageSlot(send_obj[presetKey], "1", selected_language_data);
        send_obj[presetKey]["2"].enable = false;
        send_obj[presetKey]["3"].enable = false;
        asyncStdoutToPython("/set/data/selected_your_translation_languages", send_obj);
    };


    const getSelectedTargetLanguages = () => {
        pendingSelectedTargetLanguages();
        asyncStdoutToPython("/get/data/selected_target_languages");
    };

    const setSelectedTargetLanguages = (selected_language_data) => {
        const presetKey = getPresetKey();
        const send_obj = structuredClone(currentSelectedTargetLanguages.data ?? {});
        send_obj[presetKey] = {
            ...createFallbackTargetLanguages(),
            ...(send_obj[presetKey] ?? {}),
        };
        const targetKey = selected_language_data.target_key ?? "1";
        if (findDuplicateSlot(send_obj[presetKey], selected_language_data, targetKey)) {
            showNotification_Error(
                t("main_page.language_panels.duplicate_language"),
                { category_id: "duplicate_language" },
            );
            return false;
        }
        send_obj[presetKey] = setLanguageSlot(
            send_obj[presetKey],
            targetKey,
            selected_language_data,
        );
        pendingSelectedTargetLanguages();
        asyncStdoutToPython("/set/data/selected_target_languages", send_obj);
        return true;
    };

    const addTargetLanguage = () => {
        return nextDisabledSlotKey(getCurrentTargetLanguages());
    };
    const removeTargetLanguage = (targetKey) => {
        const presetKey = getPresetKey();
        const send_obj = structuredClone(currentSelectedTargetLanguages.data ?? {});
        send_obj[presetKey] = {
            ...createFallbackTargetLanguages(),
            ...(send_obj[presetKey] ?? {}),
        };
        const removalKey = targetKey ?? enabledSlotKeys(send_obj[presetKey]).at(-1);
        const updated = removeLanguageSlot(send_obj[presetKey], removalKey);
        if (updated === send_obj[presetKey]) return false;
        send_obj[presetKey] = updated;
        pendingSelectedTargetLanguages();
        asyncStdoutToPython("/set/data/selected_target_languages", send_obj);
        return true;
    };


    const getTranslationEngines = () => {
        pendingTranslationEngines();
        asyncStdoutToPython("/get/data/selectable_translation_engines");
    };

    const updateTranslatorAvailability = (payload) => {
        const keys = payload;
        const updated_list = translator_status.map(translator => ({
            ...translator,
            is_available: keys.includes(translator.id),
        }));
        updateTranslationEngines(updated_list);
    };


    const getSelectedTranslationEngines = () => {
        pendingSelectedTranslationEngines();
        asyncStdoutToPython("/get/data/selected_translation_engines");
    };

    const settleSelectedTranslationEngineSelection = () => {
        commitSelectedTranslationEngines((current) => current.data);
        updateTranslationEngineSelectionTransition(null);
    };

    const updateSelectedTranslationEngines = (payload) => {
        commitSelectedTranslationEngines(payload);
        updateTranslationEngineSelectionTransition(null);
    };

    const setSelectedTranslationEngines = async (selected_translator) => {
        if (currentSelectedTranslationEngines.state === "pending") return;
        const presetKey = getPresetKey();
        const currentSelection = currentSelectedTranslationEngines.data?.[presetKey] ?? "";
        pendingSelectedTranslationEngines();
        updateTranslationEngineSelectionTransition({
            preset_key: presetKey,
            current: currentSelection,
            proposed: selected_translator,
        });
        const send_obj = structuredClone(currentSelectedTranslationEngines.data ?? {});
        send_obj[presetKey] = selected_translator;
        const transportResult = await asyncStdoutToPython(
            "/set/data/selected_translation_engines",
            send_obj,
        );
        if (!transportResult.ok) {
            settleSelectedTranslationEngineSelection();
            showNotification_Error(
                t("blocking_operation.backend_unavailable"),
                { category_id: "backend_unavailable" },
            );
        }
        return transportResult;
    };

    const getCTranslate2AutoFallback = () => {
        pendingCTranslate2AutoFallback();
        asyncStdoutToPython("/get/data/ctranslate2_auto_fallback");
    };

    const setCTranslate2AutoFallback = async (enabled) => {
        if (currentCTranslate2AutoFallback.state === "pending") return;
        pendingCTranslate2AutoFallback();
        const transportResult = await asyncStdoutToPython(
            "/set/data/ctranslate2_auto_fallback",
            Boolean(enabled),
        );
        if (!transportResult.ok) {
            updateCTranslate2AutoFallback((current) => current.data);
            showNotification_Error(
                t("blocking_operation.backend_unavailable"),
                { category_id: "backend_unavailable" },
            );
        }
        return transportResult;
    };

    const refreshCTranslate2AutoFallback = () => {
        pendingCTranslate2AutoFallback();
        asyncStdoutToPython("/get/data/ctranslate2_auto_fallback");
    };

    const swapSelectedLanguages = () => {
        pendingSelectedYourLanguages();
        pendingSelectedYourTranslationLanguages();
        pendingSelectedTargetLanguages();
        asyncStdoutToPython("/run/swap_your_language_and_target_language");
    };

    const updateBothSelectedLanguages = (payload) => {
        updateSelectedYourLanguages(payload.your);
        updateSelectedTargetLanguages(payload.target);
    };


    const getSelectableLanguageList = () => {
        asyncStdoutToPython("/get/data/selectable_language_list");
    };


    return {
        currentSelectedPresetTabNumber,
        getSelectedPresetTabNumber,
        updateSelectedPresetTabNumber,
        setSelectedPresetTabNumber,

        currentSelectedYourLanguages,
        getSelectedYourLanguages,
        updateSelectedYourLanguages,
        setSelectedYourLanguages,
        getCurrentYourLanguages,
        addYourLanguage,
        removeYourLanguage,

        currentSelectedYourTranslationLanguages,
        getSelectedYourTranslationLanguages,
        updateSelectedYourTranslationLanguages,
        setSelectedYourTranslationLanguages,

        currentSelectedTargetLanguages,
        getSelectedTargetLanguages,
        updateSelectedTargetLanguages,
        setSelectedTargetLanguages,
        getCurrentTargetLanguages,

        addTargetLanguage,
        removeTargetLanguage,

        currentTranscriptionLanguageCapabilities,
        updateTranscriptionLanguageCapabilities,

        currentTranslationEngines,
        getTranslationEngines,
        updateTranslationEngines,
        updateTranslatorAvailability,

        currentSelectedTranslationEngines,
        getSelectedTranslationEngines,
        updateSelectedTranslationEngines,
        setSelectedTranslationEngines,
        settleSelectedTranslationEngineSelection,
        currentTranslationEngineSelectionTransition,
        currentCTranslate2AutoFallback,
        getCTranslate2AutoFallback,
        updateCTranslate2AutoFallback,
        setCTranslate2AutoFallback,
        refreshCTranslate2AutoFallback,

        swapSelectedLanguages,
        updateBothSelectedLanguages,

        currentSelectableLanguageList,
        getSelectableLanguageList,
        updateSelectableLanguageList,
    };
};
