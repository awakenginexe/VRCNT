import { useI18n } from "@useI18n";
import styles from "./MainSection.module.scss";

import { TopBar } from "./top_bar/TopBar";
import { MessageContainer } from "./message_container/MessageContainer";
import { LanguageSelector } from "./language_selector/LanguageSelector";
import { ResourceMonitor } from "./resource_monitor/ResourceMonitor";
import { ProviderCooldowns } from "./provider_cooldowns/ProviderCooldowns";
import { LiveControlRail } from "./live_control_rail/LiveControlRail";

import { useStore_IsOpenedLanguageSelector } from "@store";
import { useLanguageSettings } from "@logics_main";
import { useEffect } from "react";

export const MainSection = () => {
    const { t } = useI18n();

    return (
        <div className={styles.container}>
            <TopBar />
            <div className={styles.workspace}>
                <LiveControlRail />
                <section className={styles.chat_panel} aria-label={t("main_page.live_weave.conversation_title")}>
                    <header className={styles.workspace_header}>
                        <div className={styles.workspace_copy}>
                            <h1 className={styles.workspace_title}>{t("main_page.live_weave.conversation_title")}</h1>
                            <p className={styles.workspace_detail}>{t("main_page.live_weave.conversation_detail")}</p>
                        </div>
                        <div className={styles.resource_cluster}>
                            <ProviderCooldowns />
                            <ResourceMonitor />
                        </div>
                    </header>
                    <MessageContainer compactComposer />
                </section>
            </div>
            <HandleLanguageSelector />
        </div>
    );
};


const HandleLanguageSelector = () => {
    const { t } = useI18n();
    const { currentIsOpenedLanguageSelector, updateIsOpenedLanguageSelector } = useStore_IsOpenedLanguageSelector();
    const {
        currentSelectedPresetTabNumber,
        currentSelectedYourLanguages,
        setSelectedYourLanguages,
        currentSelectedYourTranslationLanguages,
        setSelectedYourTranslationLanguages,
        currentSelectedTargetLanguages,
        setSelectedTargetLanguages,
        getCurrentTargetLanguages,
    } = useLanguageSettings();

    useEffect(() => {
        updateIsOpenedLanguageSelector({
            your_language: false,
            your_translation_language: false,
            target_language: false,
            target_key: "1"
        });

    }, [currentSelectedPresetTabNumber.data, currentSelectedYourLanguages.data, currentSelectedYourTranslationLanguages.data, currentSelectedTargetLanguages.data]);

    const getTitle = (target_selector_key) => {
        if (target_selector_key === "your_language") {
            const targetKey = currentIsOpenedLanguageSelector.data.target_key;
            return targetKey === "1"
                ? t("main_page.language_panels.your_speaking_language")
                : t("main_page.language_panels.your_speaking_language_indexed", { index: targetKey });
        }
        if (target_selector_key === "your_translation_language") return t("main_page.language_panels.your_translation_language");
        if (target_selector_key === "target_language") {
            const targetLanguages = getCurrentTargetLanguages();
            if (targetLanguages?.["2"]?.enable === false) return t("main_page.language_selector.title_target_language");
            return `${t("main_page.language_selector.title_target_language")} (${currentIsOpenedLanguageSelector.data.target_key})`;
        }
    };



    if (currentIsOpenedLanguageSelector.data.your_language === true) {
        const onclickFunction_YourLanguage = (payload) => {
            updateIsOpenedLanguageSelector({ your_language: false, your_translation_language: false, target_language: false, target_key: currentIsOpenedLanguageSelector.data.target_key });
            setSelectedYourLanguages({
                ...payload,
                target_key: currentIsOpenedLanguageSelector.data.target_key,
            });
        };
        const title = getTitle("your_language");
        return (
            <LanguageSelector
                title={title}
                onClickFunction={onclickFunction_YourLanguage}
                selectorType="your_language"
            />
        );
    } else if (currentIsOpenedLanguageSelector.data.your_translation_language === true) {
        const onclickFunction_YourTranslationLanguage = (payload) => {
            updateIsOpenedLanguageSelector({ your_language: false, your_translation_language: false, target_language: false, target_key: currentIsOpenedLanguageSelector.data.target_key });
            setSelectedYourTranslationLanguages({
                ...payload,
                target_key: currentIsOpenedLanguageSelector.data.target_key,
            });
        };
        const title = getTitle("your_translation_language");
        return (
            <LanguageSelector
                title={title}
                onClickFunction={onclickFunction_YourTranslationLanguage}
                selectorType="your_translation_language"
            />
        );
    } else if (currentIsOpenedLanguageSelector.data.target_language === true) {
        const onclickFunction_TargetLanguage = (payload) => {
            updateIsOpenedLanguageSelector({ your_language: false, your_translation_language: false, target_language: false, target_key: currentIsOpenedLanguageSelector.data.target_key });
            setSelectedTargetLanguages({
                ...payload,
                target_key: currentIsOpenedLanguageSelector.data.target_key,
            });
        };
        const title = getTitle("target_language");
        return (
            <LanguageSelector
                title={title}
                onClickFunction={onclickFunction_TargetLanguage}
                selectorType="target_language"
            />
        );
    } else {
        return null;
    }
};
