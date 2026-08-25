import { useEffect, useRef } from "react";

import { useI18n } from "@useI18n";
import { useAppearance, useOnboarding } from "@logics_configs";
import { useMainFunction } from "@logics_main";
import { useStdoutToPython } from "@useStdoutToPython";
import { useStore_QuickWakeUpRestoreState } from "@store";

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
    useInitStatus,
    useIsBackendReady,
    useIsSoftwareUpdating,
    useWindow,
} from "@logics_common";
import {
    getMainFunctionPendingCopyKey,
    isPageBlockingOperation,
} from "@logics_common/blockingOperationState.js";
import { isTauriRuntime } from "@logics_common/tauriRuntime.js";
import {
    advanceQuickWakeUpRestoreState,
    applyQuickWakeUpRestoreEvent,
    beginQuickWakeUpRestore,
    resetQuickWakeUpRestore,
} from "@logics_common/quickWakeUpState.js";

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
                <QuickWakeUpRestoreController />
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

const QuickWakeUpRestoreController = () => {
    const { currentIsBackendReady } = useIsBackendReady();
    const { currentInitStatus } = useInitStatus();
    const { currentEnableQuickWakeUp } = useOnboarding();
    const { asyncStdoutToPython } = useStdoutToPython();
    const {
        currentQuickWakeUpRestoreState,
        updateQuickWakeUpRestoreState,
    } = useStore_QuickWakeUpRestoreState();
    const {
        pendingTranslationStatus,
        pendingTranscriptionSendStatus,
        pendingTranscriptionReceiveStatus,
        clearPendingMainFunctionStatuses,
    } = useMainFunction();
    const restoreStateRef = useRef("unconfirmed");
    const restoreCycleStartedRef = useRef(false);
    const isInitializationComplete = currentInitStatus.data.phase === "done"
        && currentInitStatus.data.visible === false;

    useEffect(() => {
        if (currentIsBackendReady.data !== true) {
            restoreStateRef.current = "unconfirmed";
            restoreCycleStartedRef.current = false;
            updateQuickWakeUpRestoreState(resetQuickWakeUpRestore());
            return;
        }

        if (
            currentEnableQuickWakeUp.state !== "ok"
            || currentEnableQuickWakeUp.data !== true
        ) {
            restoreCycleStartedRef.current = false;
            updateQuickWakeUpRestoreState(resetQuickWakeUpRestore());
            return;
        }

        const restoreTransition = advanceQuickWakeUpRestoreState({
            isBackendReady: currentIsBackendReady.data,
            isInitializationComplete,
            enabled: currentEnableQuickWakeUp.data,
            restoreState: restoreStateRef.current,
        });
        restoreStateRef.current = restoreTransition.restoreState;

        if (!restoreTransition.shouldRequest || restoreCycleStartedRef.current) return;
        restoreCycleStartedRef.current = true;

        updateQuickWakeUpRestoreState((current) => beginQuickWakeUpRestore(
            current.data,
            current.data.generation + 1,
        ));
        pendingTranslationStatus();
        pendingTranscriptionSendStatus();
        pendingTranscriptionReceiveStatus();

        asyncStdoutToPython("/run/restore_quick_wake_up")
            .then((transportResult) => {
                if (transportResult?.ok === true) return;
                updateQuickWakeUpRestoreState((current) => applyQuickWakeUpRestoreEvent(
                    current.data,
                    {
                        generation: current.data.generation,
                        phase: "failed",
                        restoring: {
                            translation: false,
                            transcription_send: false,
                            transcription_receive: false,
                        },
                        failed: { restore: "backend_unavailable" },
                    },
                ));
                clearPendingMainFunctionStatuses();
            })
            .catch(() => {
                updateQuickWakeUpRestoreState((current) => applyQuickWakeUpRestoreEvent(
                    current.data,
                    {
                        generation: current.data.generation,
                        phase: "failed",
                        restoring: {
                            translation: false,
                            transcription_send: false,
                            transcription_receive: false,
                        },
                        failed: { restore: "backend_unavailable" },
                    },
                ));
                clearPendingMainFunctionStatuses();
            });
    }, [
        asyncStdoutToPython,
        clearPendingMainFunctionStatuses,
        currentEnableQuickWakeUp.data,
        currentEnableQuickWakeUp.state,
        currentIsBackendReady.data,
        currentInitStatus.data.phase,
        currentInitStatus.data.visible,
        isInitializationComplete,
        pendingTranscriptionReceiveStatus,
        pendingTranscriptionSendStatus,
        pendingTranslationStatus,
        updateQuickWakeUpRestoreState,
    ]);

    useEffect(() => {
        if (
            currentQuickWakeUpRestoreState.data.phase === "ready"
            || currentQuickWakeUpRestoreState.data.phase === "failed"
        ) {
            clearPendingMainFunctionStatuses();
        }
    }, [
        clearPendingMainFunctionStatuses,
        currentQuickWakeUpRestoreState.data.phase,
    ]);

    return null;
};

const Contents = () => {
    const { t } = useI18n();
    const { WindowGeometryController } = useWindow();
    const { currentIsSoftwareUpdating } = useIsSoftwareUpdating();
    const {
        isBlocking: isBlockingOperation,
        operation,
    } = useBlockingOperation();
    const isBlocking = isPageBlockingOperation({
        isBlocking: isBlockingOperation,
        operation,
    });
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
                    current: Math.min(
                        operation.progress.max,
                        Math.max(1, operation.progress.value),
                    ),
                    total: operation.progress.max,
                })
                : t("blocking_operation.progress_indeterminate");

            return {
                operationId: operation.id,
                terminalError: operation.terminalError === true,
                title: t(operation.titleKey),
                phase,
                detail,
                progress: operation.progress,
                phaseLabel: t("blocking_operation.phase_label"),
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
                        open={isBlockingOperation}
                        operationId={overlayProps.operationId}
                        terminalError={overlayProps.terminalError}
                        title={overlayProps.title}
                        phaseLabel={overlayProps.phaseLabel}
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
