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

export const confirmRuntimeSwitch = async ({ runtime, targetVariant, launch }) => {
    const request = requestRuntimeSwitch({ runtime, targetVariant });
    if (typeof launch !== "function") {
        throw new Error("Runtime switch launch is unavailable.");
    }
    await launch(request.targetVariant);
    return { started: true };
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
});

const runtimeManagerAdapter = createRuntimeManagerAdapter();

export const getRuntimeState = () => runtimeManagerAdapter.getRuntimeState();
export const launchRuntimeSwitch = (variant) => runtimeManagerAdapter.launchRuntimeSwitch(variant);
