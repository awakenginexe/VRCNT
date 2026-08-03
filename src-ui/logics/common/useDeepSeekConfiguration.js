import { useCallback, useEffect, useRef } from "react";
import { useStore_DeepSeekAuthStatus } from "@store";
import { useStdoutToPython } from "@useStdoutToPython";
import { useLanguageSettings } from "@logics_main";
import { refreshDeepSeekStatusOnce } from "./deepSeekRefreshGuard.js";
import { useIsBackendReady } from "./useIsBackendReady.js";

const HEALTH_VALUES = new Set([
    "not_configured",
    "configured",
    "invalid_credentials",
    "insufficient_balance",
    "failed",
]);

const normalizeStatus = (payload) => {
    const configured = payload?.configured === true;
    const health = HEALTH_VALUES.has(payload?.health)
        ? payload.health
        : configured
            ? "configured"
            : "not_configured";
    return { configured, health };
};

export const useDeepSeekConfiguration = () => {
    const statusRefreshStateRef = useRef(false);
    const { currentIsBackendReady } = useIsBackendReady();
    const { asyncStdoutToPython } = useStdoutToPython();
    const {
        currentDeepSeekAuthStatus,
        updateDeepSeekAuthStatus,
        pendingDeepSeekAuthStatus,
    } = useStore_DeepSeekAuthStatus();
    const { getTranslationEngines } = useLanguageSettings();

    const updateStatus = useCallback((payload) => {
        updateDeepSeekAuthStatus(normalizeStatus(payload));
        getTranslationEngines();
    }, [getTranslationEngines, updateDeepSeekAuthStatus]);

    const refreshStatus = useCallback(async () => {
        pendingDeepSeekAuthStatus();
        return asyncStdoutToPython("/get/data/deepseek_auth_key");
    }, [asyncStdoutToPython, pendingDeepSeekAuthStatus]);

    const saveKey = useCallback(async (value) => {
        if (typeof value !== "string" || !value.trim()) return { ok: false };
        pendingDeepSeekAuthStatus();
        return asyncStdoutToPython("/set/data/deepseek_auth_key", value);
    }, [asyncStdoutToPython, pendingDeepSeekAuthStatus]);

    const deleteKey = useCallback(async () => {
        pendingDeepSeekAuthStatus();
        return asyncStdoutToPython("/delete/data/deepseek_auth_key");
    }, [asyncStdoutToPython, pendingDeepSeekAuthStatus]);

    const testConnection = useCallback(async () => {
        pendingDeepSeekAuthStatus();
        return asyncStdoutToPython("/run/deepseek_connection");
    }, [asyncStdoutToPython, pendingDeepSeekAuthStatus]);

    useEffect(() => {
        refreshDeepSeekStatusOnce(
            statusRefreshStateRef,
            currentIsBackendReady.data === true,
            refreshStatus,
        );
    }, [currentIsBackendReady.data, refreshStatus]);

    return {
        currentDeepSeekAuthStatus,
        updateStatus,
        refreshStatus,
        saveKey,
        deleteKey,
        testConnection,
    };
};
