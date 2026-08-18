import { useI18n } from "@useI18n";
import { useAppearance } from "@logics_configs";

import {
    KeyEventController,
    StartPythonController,
    FirstRunSetupController,
    GlobalHotKeyController,
    UiLanguageController,
    ConfigPageCloseTriggerController,
    UiSizeController,
    FontFamilyController,
    TransparencyController,
    CornerRadiusController,
    PerformanceModeController,
    ColorThemeController,
    BackgroundWallpaperController,
} from "./_app_controllers";

import styles from "./App.module.scss";

import { MainPage } from "./main_page/MainPage";
import { ConfigPage } from "./config_page/ConfigPage";
import { DesktopOverlayBridge } from "./desktop_overlay/DesktopOverlayBridge";

import {
    WindowTitleBar,
    StartupStatusBanner,
    UpdateNotificationController,
    UpdatingComponent,
    ModalController,
    SnackbarController,
    AppErrorBoundary,
    BlockingOperationOverlay,
    ColorResetMigrationGate,
} from "./others";

import {
    useBlockingOperation,
    useCustomBackground,
    isColorResetMigrationRequired as shouldRequireColorResetMigration,
    useIsBackendReady,
    useIsSoftwareUpdating,
    useWindow,
} from "@logics_common";
import { getMainFunctionPendingCopyKey } from "@logics_common/blockingOperationState.js";
import { isTauriRuntime } from "@logics_common/tauriRuntime.js";

export const App = () => {
    const { i18n } = useI18n();
    const isTauri = isTauriRuntime();
    const { bgImage, blur, dim } = useCustomBackground();

    return (
        <div className={styles.container}>
            <div
                className={styles.background_layer}
                style={{
                    backgroundImage: `url("${bgImage}")`,
                    filter: `blur(${blur}px)`,
                }}
                aria-hidden="true"
            />
            <div
                className={styles.background_overlay}
                style={{
                    backgroundColor: `rgba(6, 8, 16, ${dim / 100})`,
                }}
                aria-hidden="true"
            />
            <AppErrorBoundary >
                <KeyEventController />
                {isTauri && <StartPythonController />}
                {isTauri && <FirstRunSetupController />}
                {isTauri && <GlobalHotKeyController />}
                <UiLanguageController />
                <ConfigPageCloseTriggerController />
                <UiSizeController />
                <FontFamilyController />
                <TransparencyController />
                <CornerRadiusController />
                <PerformanceModeController />
                <ColorThemeController />
                <BackgroundWallpaperController />
                <DesktopOverlayBridge />
                <Contents key={i18n.language} />

                <SnackbarController />
            </AppErrorBoundary>
        </div>
    );
};

const Contents = () => {
    const { t } = useI18n();
    const { WindowGeometryController } = useWindow();
    const { currentIsSoftwareUpdating } = useIsSoftwareUpdating();
    const { isBlocking, operation } = useBlockingOperation();
    const { currentIsBackendReady } = useIsBackendReady();
    const { currentColorReset590 } = useAppearance();
    const isColorResetMigrationRequired = shouldRequireColorResetMigration({
        isTauri: isTauriRuntime(),
        isBackendReady: currentIsBackendReady.data,
        flagValue: currentColorReset590.data,
    });
    const overlayProps = operation === null
        ? null
        : (() => {
            const isStartup = operation.id === "startup";
            const phase = isStartup
                ? (operation.phaseKey
                    ? t(operation.phaseKey)
                    : operation.phase ?? "")
                : t(getMainFunctionPendingCopyKey(
                    operation.id,
                    operation.elapsedMs,
                ));
            const detail = operation.detailKey
                ? t(operation.detailKey)
                : operation.detail ?? "";
            const progressText = operation.progress.kind === "determinate"
                ? t("blocking_operation.progress_steps", {
                    current: operation.progress.value,
                    total: operation.progress.max,
                })
                : t("blocking_operation.progress_indeterminate");

            return {
                operationId: operation.id,
                title: t(operation.titleKey),
                phase,
                detail,
                progress: operation.progress,
                progressLabel: t("blocking_operation.progress_label"),
                progressText,
                elapsedText: t("blocking_operation.elapsed", {
                    seconds: Math.floor(operation.elapsedMs / 1000),
                }),
            };
        })();

    return (
        <>
            <WindowGeometryController />

            <WindowTitleBar />
            <div className={styles.app_body}>
                <StartupStatusBanner />
                <UpdateNotificationController />
                <div
                    className={styles.pages_wrapper}
                    inert={isBlocking || isColorResetMigrationRequired ? "" : undefined}
                >
                    {currentIsSoftwareUpdating.data === false ? (
                        <>
                            <ConfigPage />
                            <MainPage />
                            <ModalController />
                        </>
                    ) : <UpdatingComponent />}
                </div>
                <ColorResetMigrationGate />
                {overlayProps ? (
                    <BlockingOperationOverlay
                        open={isBlocking}
                        operationId={overlayProps.operationId}
                        title={overlayProps.title}
                        phase={overlayProps.phase}
                        detail={overlayProps.detail}
                        progress={overlayProps.progress}
                        progressLabel={overlayProps.progressLabel}
                        progressText={overlayProps.progressText}
                        elapsedText={overlayProps.elapsedText}
                    />
                ) : null}
            </div>
        </>
    );
};
