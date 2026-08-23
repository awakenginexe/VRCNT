import { isTauriRuntime } from "./tauriRuntime.js";


const loadAutostartBindings = async () => import("@tauri-apps/plugin-autostart");

export const createStartWithVrchatAdapter = ({
    isTauri = isTauriRuntime,
    loadBindings = loadAutostartBindings,
} = {}) => {
    const getBindings = async () => {
        if (!isTauri()) return null;
        return loadBindings();
    };

    return {
        getStatus: async () => {
            const bindings = await getBindings();
            return bindings ? bindings.isEnabled() : false;
        },
        enable: async () => {
            const bindings = await getBindings();
            if (!bindings) return false;
            await bindings.enable();
            return bindings.isEnabled();
        },
        disable: async () => {
            const bindings = await getBindings();
            if (!bindings) return false;
            await bindings.disable();
            return bindings.isEnabled();
        },
    };
};

const startWithVrchatAdapter = createStartWithVrchatAdapter();

export const getStartWithVrchatStatus = () => startWithVrchatAdapter.getStatus();
export const enableStartWithVrchat = () => startWithVrchatAdapter.enable();
export const disableStartWithVrchat = () => startWithVrchatAdapter.disable();
