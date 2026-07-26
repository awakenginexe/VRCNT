import { useSyncExternalStore } from "react";

let snapshot = {};
const listeners = new Set();

const emit = () => listeners.forEach((listener) => listener());

export const updateProviderCooldowns = (payload) => {
    snapshot = payload && typeof payload === "object" ? payload : {};
    emit();
};

export const useProviderCooldowns = () => useSyncExternalStore(
    (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot,
);

export const useTranslationProviderCooldowns = () => ({
    updateProviderCooldowns,
});
