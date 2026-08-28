import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Command } from "@tauri-apps/plugin-shell";
import { useEffect, useRef } from "react";

import { useStdoutToPython } from "@useStdoutToPython";
import { useReceiveRoutes } from "@useReceiveRoutes";
import { store, useStore_SelectableFontFamilyList } from "@store";
import { arrayToObject } from "@utils";
import { useI18n } from "@useI18n";

import {
    useInitStatus,
    useInitProgress,
    useIsBackendReady,
    useNotificationStatus,
} from "@logics_common";
import { useMainFunction } from "@logics_main";
import { useLanguageSettings } from "@logics_main";
import { isBenignSidecarStderr } from "@logics_common/sidecarStderrUtils.js";
import { buildFontFamilyOptions } from "@logics_common";
import {
    createBackendProcessLifecycle,
    createRuntimeActivationHandshake,
    RUNTIME_ACTIVATION_READINESS_ENDPOINT,
    spawnBackendWithTimeout,
} from "@logics_common/backendLifecycle.js";
import { createBackendSessionGuard } from "@logics_common/backendSessionGuard.js";
import {
    RESIDENT_ACTIVATE_EVENT,
    RESIDENT_BACKEND_SHUTDOWN_DELAY_MS,
    RESIDENT_CLOSE_REQUESTED_EVENT,
    resolveResidentStartup,
} from "@logics_common/residentTray.js";

export const StartPythonController = () => {
    const { updateInitStatus } = useInitStatus();
    const {
        asyncStartPython,
        startWatchdog,
    } = useStartPython();
    const { asyncFetchFonts } = useAsyncFetchFonts();
    const startPythonRef = useRef(asyncStartPython);
    const startWatchdogRef = useRef(startWatchdog);
    const fetchFontsRef = useRef(asyncFetchFonts);
    const closeInProgressRef = useRef(false);

    startPythonRef.current = asyncStartPython;
    startWatchdogRef.current = startWatchdog;
    fetchFontsRef.current = asyncFetchFonts;

    useEffect(() => {
        let isDisposed = false;
        let unlistenActivate;
        let unlistenClose;

        const startBackend = async () => {
            if (isDisposed) return;
            const hasLiveBackend = Boolean(store.backend_subprocess);
            if (!hasLiveBackend) {
                updateInitStatus({
                    visible: true,
                    phase: "starting",
                    message: "",
                    message_key: "blocking_operation.startup_operation",
                    detail: "Launching the VRCNT backend.",
                });
            }
            try {
                await startPythonRef.current();
                if (isDisposed) return;
                startWatchdogRef.current();
                fetchFontsRef.current();
            } catch (error) {
                console.error(error);
            }
        };

        const handleResidentActivation = () => startBackend();
        const handleResidentClose = async () => {
            if (closeInProgressRef.current) return;
            closeInProgressRef.current = true;
            try {
                await invoke("enter_background_mode");
            } catch (error) {
                console.error("Unable to enter VRCNT resident mode:", error);
            } finally {
                closeInProgressRef.current = false;
            }
        };

        const setup = async () => {
            const setupListeners = async () => {
                try {
                    const [activateUnlisten, closeUnlisten] = await Promise.all([
                        listen(RESIDENT_ACTIVATE_EVENT, handleResidentActivation),
                        listen(RESIDENT_CLOSE_REQUESTED_EVENT, handleResidentClose),
                    ]);
                    if (isDisposed) {
                        activateUnlisten();
                        closeUnlisten();
                        return;
                    }
                    unlistenActivate = activateUnlisten;
                    unlistenClose = closeUnlisten;
                } catch (error) {
                    console.error("Unable to initialize VRCNT resident listeners:", error);
                }
            };

            setupListeners();

            const shouldStartBackend = await resolveResidentStartup({
                isBackgroundStartup: () => invoke("is_background_startup"),
                consumeResidentActivation: () => invoke("consume_resident_activation"),
            });
            if (shouldStartBackend) {
                await startBackend();
            } else {
                updateInitStatus({
                    visible: false,
                    phase: "done",
                    message: "VRCNT is waiting in the system tray.",
                    detail: "It will start when VRChat launches.",
                });
            }
        };

        setup();

        return () => {
            isDisposed = true;
            unlistenActivate?.();
            unlistenClose?.();
        };
    }, []);

    return null;
};

const useStartPython = () => {
    const { asyncStdoutToPython } = useStdoutToPython();
    const { receiveRoutes } = useReceiveRoutes();
    const { showNotification_Error } = useNotificationStatus();
    const { updateInitStatus } = useInitStatus();
    const { updateInitProgress } = useInitProgress();
    const { updateIsBackendReady } = useIsBackendReady();
    const { currentIsBackendReady } = useIsBackendReady();
    const { clearPendingMainFunctionStatuses } = useMainFunction();
    const { settleSelectedTranslationEngineSelection } = useLanguageSettings();
    const { t } = useI18n();
    const backendReadyRef = useRef(currentIsBackendReady.data);
    const startupErrorNotifiedRef = useRef(false);
    const activeBackendRef = useRef(null);
    const sessionGuardRef = useRef(createBackendSessionGuard());
    const startPromiseRef = useRef(null);
    const watchdogIntervalRef = useRef(null);
    backendReadyRef.current = currentIsBackendReady.data;

    const markBackendStartupError = (error) => {
        const messageKey = "blocking_operation.startup_failed";
        const detailKey = "blocking_operation.startup_failed_detail";
        updateInitStatus({
            visible: true,
            phase: "error",
            message: t(messageKey),
            detail: t(detailKey),
            message_key: "blocking_operation.startup_failed",
            detail_key: "blocking_operation.startup_failed_detail",
        });

        if (!startupErrorNotifiedRef.current) {
            startupErrorNotifiedRef.current = true;
            showNotification_Error(t(messageKey), {
                hide_duration: null,
                category_id: "backend_startup_failed",
            });
        }
        console.error("Backend startup failed.", error);
    };

    const asyncStartPython = async () => {
        if (store.backend_subprocess) return store.backend_subprocess;
        if (startPromiseRef.current) return startPromiseRef.current;

        startupErrorNotifiedRef.current = false;

        const startPromise = (async () => {
            const sessionId = sessionGuardRef.current.begin();
            const lifecycle = createBackendProcessLifecycle();
            const backendRecord = { lifecycle, sessionId, subprocess: null };
            activeBackendRef.current = backendRecord;
            updateIsBackendReady(false);
            updateInitProgress(0);
            updateInitStatus({
                visible: true,
                phase: "starting",
                message: "",
                message_key: "blocking_operation.startup_operation",
                detail: "Preparing the backend process.",
            });
            const runtimeActivationContext = await invoke("get_runtime_activation_context");
            const runtimeActivationArgs = runtimeActivationContext
                ? [
                    "--runtime-activation-pipe",
                    runtimeActivationContext.pipeName,
                    "--runtime-activation-token",
                    runtimeActivationContext.activationToken,
                    "--runtime-activation-nonce",
                    runtimeActivationContext.nonce,
                    "--runtime-activation-app-version",
                    runtimeActivationContext.appVersion,
                    "--runtime-activation-runtime-variant",
                    runtimeActivationContext.runtimeVariant,
                    "--runtime-activation-generation",
                    String(sessionId),
                ]
                : [];
            let runtimeActivationHandshake = null;
            const command = runtimeActivationArgs.length === 0
                ? Command.sidecar("bin/VRCNT-backend")
                : Command.sidecar("bin/VRCNT-backend", runtimeActivationArgs);
            updateInitStatus({
                visible: true,
                phase: "starting",
                message: "",
                message_key: "blocking_operation.startup_operation",
                detail: "Connecting to the backend process.",
            });
            command.on("error", (error) => {
                if (!sessionGuardRef.current.isCurrent(sessionId)) return;
                if (!lifecycle.wasIntentionallyStopped()) markBackendStartupError(error);
            });
            let backend_subprocess_ref = null;
            command.on("close", (termination) => {
                if (!sessionGuardRef.current.isCurrent(sessionId)) return;
                sessionGuardRef.current.invalidate(sessionId);
                if (store.backend_subprocess === backend_subprocess_ref) {
                    store.backend_subprocess = null;
                    if (activeBackendRef.current === backendRecord) {
                        activeBackendRef.current = null;
                    }
                }
                if (lifecycle.wasIntentionallyStopped()) return;
                if (backendReadyRef.current !== true) {
                    markBackendStartupError(termination);
                    return;
                }
                clearPendingMainFunctionStatuses();
                settleSelectedTranslationEngineSelection();
                showNotification_Error(
                    t("blocking_operation.backend_disconnected"),
                    {
                        hide_duration: null,
                        category_id: "backend_disconnected",
                    },
                );
                console.error("Backend disconnected.", termination);
            });
            command.stdout.on("data", (line) => {
                if (!sessionGuardRef.current.isCurrent(sessionId)) return;
                let parsed_data = "";
                try {
                    parsed_data = JSON.parse(line);
                    receiveRoutes(parsed_data);
                    if (runtimeActivationHandshake) {
                        runtimeActivationHandshake.accept(parsed_data);
                    }
                } catch (error) {
                    console.log(error, line);
                }
            });
            command.stderr.on("data", line => {
                if (!sessionGuardRef.current.isCurrent(sessionId)) return;
                if (isBenignSidecarStderr(line)) {
                    console.debug("stderr", line);
                    return;
                }
                showNotification_Error(
                    `An error occurred. Please restart VRCNT or contact the developers. The last line:${JSON.stringify(line)}`, { hide_duration: null }
                );
                console.error("stderr", line);
            });
            try {
                updateInitStatus({
                    visible: true,
                    phase: "starting",
                    message: "",
                    message_key: "blocking_operation.startup_operation",
                    detail: "Waiting for the backend process to start.",
                });
                const backend_subprocess = await spawnBackendWithTimeout(
                    () => command.spawn(),
                );
                backend_subprocess_ref = backend_subprocess;
                backendRecord.subprocess = backend_subprocess;
                store.backend_subprocess = backend_subprocess;
                if (runtimeActivationContext) {
                    runtimeActivationHandshake = createRuntimeActivationHandshake({
                        activationToken: runtimeActivationContext.activationToken,
                        generation: sessionId,
                        backendPid: backend_subprocess.pid,
                    });
                    const readinessResponse = runtimeActivationHandshake.waitForResponse();
                    const readinessRequest = await asyncStdoutToPython(
                        RUNTIME_ACTIVATION_READINESS_ENDPOINT,
                        {
                            activation_token: runtimeActivationContext.activationToken,
                            generation: sessionId,
                        },
                    );
                    if (!readinessRequest.ok) {
                        throw readinessRequest.error;
                    }
                    await readinessResponse;
                }
                return backend_subprocess;
            } catch (error) {
                if (sessionGuardRef.current.isCurrent(sessionId)) {
                    markBackendStartupError(error);
                }
                throw error;
            }
        })();

        startPromiseRef.current = startPromise;
        try {
            return await startPromise;
        } finally {
            if (startPromiseRef.current === startPromise) {
                startPromiseRef.current = null;
            }
        }
    };

    const startWatchdog = () => {
        if (watchdogIntervalRef.current) return;
        watchdogIntervalRef.current = setInterval(() => {
            asyncStdoutToPython("/run/feed_watchdog");
        }, 20000);
    };

    const stopWatchdog = () => {
        if (!watchdogIntervalRef.current) return;
        clearInterval(watchdogIntervalRef.current);
        watchdogIntervalRef.current = null;
    };

    const asyncStopPython = async () => {
        const activeBackend = activeBackendRef.current;
        if (activeBackend) {
            sessionGuardRef.current.invalidate(activeBackend.sessionId);
            activeBackend.lifecycle.requestStop();
        }
        stopWatchdog();

        if (startPromiseRef.current) {
            try {
                await startPromiseRef.current;
            } catch {
                return;
            }
        }

        const backend_subprocess = store.backend_subprocess;
        if (!backend_subprocess) return;

        if (activeBackendRef.current?.subprocess === backend_subprocess) {
            activeBackendRef.current.lifecycle.requestStop();
        }

        await asyncStdoutToPython("/run/shutdown");
        await new Promise(resolve => setTimeout(resolve, RESIDENT_BACKEND_SHUTDOWN_DELAY_MS));
        try {
            await backend_subprocess.kill();
        } catch (error) {
            console.error("Unable to stop VRCNT backend:", error);
        } finally {
            if (store.backend_subprocess === backend_subprocess) {
                store.backend_subprocess = null;
            }
            if (activeBackendRef.current?.subprocess === backend_subprocess) {
                activeBackendRef.current = null;
            }
        }
    };

    return { asyncStartPython, asyncStopPython, startWatchdog };
};

const useAsyncFetchFonts = () => {
    const { updateSelectableFontFamilyList } = useStore_SelectableFontFamilyList();
    const asyncFetchFonts = async () => {
        try {
            let fonts = await invoke("get_font_list");
            fonts = fonts.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
            updateSelectableFontFamilyList(buildFontFamilyOptions(fonts));
        } catch (error) {
            console.error("Error fetching fonts:", error);
        }
    };
    return { asyncFetchFonts };
};
