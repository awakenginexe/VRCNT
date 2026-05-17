import { useI18n } from "@useI18n";

import {
    KeyEventController,
    StartPythonController,
    GlobalHotKeyController,
    UiLanguageController,
    ConfigPageCloseTriggerController,
    UiSizeController,
    FontFamilyController,
    TransparencyController,
    CornerRadiusController,
} from "./_app_controllers";

import styles from "./App.module.scss";

import { MainPage } from "./main_page/MainPage";
import { ConfigPage } from "./config_page/ConfigPage";

import {
    WindowTitleBar,
    StartupStatusBanner,
    UpdatingComponent,
    ModalController,
    SnackbarController,
    AppErrorBoundary,
} from "./others";

import { useIsBackendReady, useIsSoftwareUpdating, useWindow } from "@logics_common";

export const App = () => {
    const { i18n } = useI18n();

    return (
        <div className={styles.container}>
            <AppErrorBoundary >
                <KeyEventController />
                <StartPythonController />
                <GlobalHotKeyController />
                <UiLanguageController />
                <ConfigPageCloseTriggerController />
                <UiSizeController />
                <FontFamilyController />
                <TransparencyController />
                <CornerRadiusController />
                <Contents key={i18n.language} />

                <SnackbarController />
            </AppErrorBoundary>
        </div>
    );
};

const Contents = () => {
    const { WindowGeometryController } = useWindow();
    const { currentIsSoftwareUpdating } = useIsSoftwareUpdating();
    return (
        <>
            <WindowGeometryController />

            <WindowTitleBar />
            <StartupStatusBanner />
            {currentIsSoftwareUpdating.data === false
            ?
            <div className={styles.pages_wrapper}>
                <ConfigPage />
                <MainPage />
                <ModalController />
            </div>
            :
            <UpdatingComponent />
            }
        </>
    );
};
