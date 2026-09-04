import { isTauriRuntime } from "./tauriRuntime.js";
import { invoke as invokeTauri } from "@tauri-apps/api/core";

const RUNTIME_VARIANTS = new Set(["cpu", "cuda"]);

const recoveryRuntime = () => ({
    status: "recovery",
    schema: 1,
    product: "VRCNT",
    version: "",
    variant: null,
    architecture: "",
    installPath: "",
    updatedAtUtc: "",
});

const isNonEmptyString = (value) => typeof value === "string" && value.trim() !== "";

export const getSwitchTarget = (variant) => {
    if (!RUNTIME_VARIANTS.has(variant)) {
        throw new Error("A runtime variant must be cpu or cuda.");
    }
    return variant === "cpu" ? "cuda" : "cpu";
};

export const normalizeRuntimeState = (state) => {
    if (
        !state ||
        state.schema !== 1 ||
        state.status !== "active" ||
        state.product !== "VRCNT" ||
        !RUNTIME_VARIANTS.has(state.variant) ||
        !isNonEmptyString(state.version) ||
        !isNonEmptyString(state.architecture) ||
        !isNonEmptyString(state.installPath) ||
        !isNonEmptyString(state.updatedAtUtc)
    ) {
        return recoveryRuntime();
    }

    return {
        schema: state.schema,
        status: "active",
        product: state.product,
        version: state.version,
        variant: state.variant,
        architecture: state.architecture,
        installPath: state.installPath,
        updatedAtUtc: state.updatedAtUtc,
    };
};

export const getRuntimePresentation = (runtime) => {
    if (runtime?.status !== "active" || !RUNTIME_VARIANTS.has(runtime.variant)) {
        return {
            status: "recovery",
            currentVariant: null,
            targetVariant: null,
            canSwitch: false,
        };
    }

    return {
        status: "active",
        currentVariant: runtime.variant,
        targetVariant: getSwitchTarget(runtime.variant),
        canSwitch: true,
    };
};

export const getRuntimeBadge = (runtime) => {
    const presentation = getRuntimePresentation(runtime);
    if (presentation.status !== "active") return "Runtime unknown";
    return presentation.currentVariant === "cuda" ? "CUDA Runtime" : "CPU Runtime";
};

export const requestRuntimeSwitch = ({ runtime, targetVariant }) => {
    const presentation = getRuntimePresentation(runtime);
    if (!presentation.canSwitch) {
        throw new Error("Runtime recovery is required before switching.");
    }
    if (!RUNTIME_VARIANTS.has(targetVariant)) {
        throw new Error("A runtime variant must be cpu or cuda.");
    }
    if (targetVariant === presentation.currentVariant) {
        throw new Error("The selected runtime is already active.");
    }

    return { targetVariant, requiresConfirmation: true };
};

const SWITCH_TERMINAL_STATES = new Set(["succeeded", "failed", "cancelled", "stale"]);
const SWITCH_ACTIVE_STATES = new Set(["pending", "accepted", "running", "shutdown_requested", "shutdown_acknowledged"]);

const wait = (intervalMs) => new Promise((resolve) => setTimeout(resolve, intervalMs));

export const normalizeRuntimeSwitchStatus = (status) => {
    if (!status || !["idle", ...SWITCH_ACTIVE_STATES, ...SWITCH_TERMINAL_STATES].includes(status.status)) {
        return { status: "stale", errorCode: "invalid_switch_status", message: "Runtime switch recovery is required." };
    }
    return {
        status: status.status,
        targetVariant: RUNTIME_VARIANTS.has(status.targetVariant) ? status.targetVariant : null,
        nonce: isNonEmptyString(status.nonce) ? status.nonce : null,
        errorCode: status.errorCode ?? null,
        message: status.message ?? null,
        updatedAtUtc: status.updatedAtUtc ?? null,
    };
};

export const reconcilePersistedRuntimeSwitch = async ({ getStatus, refreshRuntime }) => {
    const status = normalizeRuntimeSwitchStatus(await getStatus());
    const isTerminal = SWITCH_TERMINAL_STATES.has(status.status);
    const runtime = await refreshRuntime();
    return {
        status,
        runtime,
        switchState: createRuntimeSwitchState({
            isBusy: SWITCH_ACTIVE_STATES.has(status.status),
            pendingTarget: null,
        }),
        isTerminal,
    };
};

export const consumePersistedRuntimeSwitch = async ({ consumeReceipt, refreshRuntime }) => {
    const receipt = typeof consumeReceipt === "function" ? await consumeReceipt() : null;
    const status = receipt
        ? normalizeRuntimeSwitchStatus(receipt)
        : { status: "idle", targetVariant: null, nonce: null, errorCode: null, message: null, updatedAtUtc: null };
    const runtime = await refreshRuntime();
    return {
        status,
        runtime,
        switchState: createRuntimeSwitchState({ isBusy: false, pendingTarget: null }),
        isTerminal: SWITCH_TERMINAL_STATES.has(status.status),
    };
};

export const waitForRuntimeSwitchAcceptance = async ({ getStatus, targetVariant, timeoutMs = 10000, intervalMs = 100 }) => {
    if (typeof getStatus !== "function") return { accepted: true, targetVariant };
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
        const status = normalizeRuntimeSwitchStatus(await getStatus());
        if (status.targetVariant && status.targetVariant !== targetVariant) throw new Error("The runtime switch target was changed.");
        if (["accepted", "running", "shutdown_requested", "shutdown_acknowledged"].includes(status.status)) return { accepted: true, targetVariant };
        if (SWITCH_TERMINAL_STATES.has(status.status)) throw new Error(status.message || status.errorCode || "Runtime switch was not accepted.");
        await wait(intervalMs);
    }
    throw new Error("The setup manager did not acknowledge the runtime switch.");
};

export const confirmRuntimeSwitch = async ({ runtime, targetVariant, launch, getStatus, waitOptions }) => {
    const request = requestRuntimeSwitch({ runtime, targetVariant });
    if (typeof launch !== "function") {
        throw new Error("Runtime switch launch is unavailable.");
    }
    await launch(request.targetVariant);
    return waitForRuntimeSwitchAcceptance({
        getStatus,
        targetVariant: request.targetVariant,
        ...waitOptions,
    });
};

export const waitForRuntimeSwitchOutcome = async ({ getStatus, refreshRuntime, timeoutMs = 10 * 60 * 1000, intervalMs = 250 }) => {
    if (typeof getStatus !== "function") throw new Error("Runtime switch status is unavailable.");
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
        const status = normalizeRuntimeSwitchStatus(await getStatus());
        if (SWITCH_TERMINAL_STATES.has(status.status)) {
            const runtime = typeof refreshRuntime === "function" ? await refreshRuntime() : null;
            return { ...status, runtime };
        }
        await wait(intervalMs);
    }
    const runtime = typeof refreshRuntime === "function" ? await refreshRuntime() : null;
    return { status: "stale", errorCode: "switch_timeout", message: "Runtime switch status became stale.", runtime };
};

export const createRuntimeSwitchState = ({ isBusy = false, pendingTarget = null } = {}) => ({
    isBusy: Boolean(isBusy),
    pendingTarget,
    controlsDisabled: Boolean(isBusy),
});

const loadInvoke = async () => invokeTauri;

export const createRuntimeManagerAdapter = ({
    isTauri = isTauriRuntime,
    loadTauriInvoke = loadInvoke,
} = {}) => ({
    getRuntimeState: async () => {
        if (!isTauri()) return recoveryRuntime();
        try {
            const invoke = await loadTauriInvoke();
            return normalizeRuntimeState(await invoke("get_runtime_state"));
        } catch {
            return recoveryRuntime();
        }
    },
    launchRuntimeSwitch: async (variant) => {
        if (!RUNTIME_VARIANTS.has(variant)) {
            throw new Error("A runtime variant must be cpu or cuda.");
        }
        if (!isTauri()) {
            throw new Error("Runtime switching is available only in the installed VRCNT application.");
        }
        const invoke = await loadTauriInvoke();
        await invoke("launch_runtime_switch", { variant });
    },
    getRuntimeSwitchStatus: async () => {
        if (!isTauri()) return { status: "idle" };
        try {
            const invoke = await loadTauriInvoke();
            return normalizeRuntimeSwitchStatus(await invoke("get_runtime_switch_status"));
        } catch {
            return { status: "stale", errorCode: "switch_status_unavailable" };
        }
    },
    consumeRuntimeSwitchReceipt: async () => {
        if (!isTauri()) return null;
        const invoke = await loadTauriInvoke();
        return invoke("consume_runtime_switch_receipt");
    },
});

const runtimeManagerAdapter = createRuntimeManagerAdapter();

export const getRuntimeState = () => runtimeManagerAdapter.getRuntimeState();
export const launchRuntimeSwitch = (variant) => runtimeManagerAdapter.launchRuntimeSwitch(variant);
export const getRuntimeSwitchStatus = () => runtimeManagerAdapter.getRuntimeSwitchStatus();
export const consumeRuntimeSwitchReceipt = () => runtimeManagerAdapter.consumeRuntimeSwitchReceipt();
