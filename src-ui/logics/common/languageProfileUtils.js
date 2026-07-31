export const LANGUAGE_SLOT_KEYS = Object.freeze(["1", "2", "3"]);

const copySlot = (slot = {}) => ({
    language: typeof slot.language === "string" ? slot.language : "",
    country: typeof slot.country === "string" ? slot.country : "",
    enable: slot.enable === true,
});

const copySlots = (slots = {}) => Object.fromEntries(
    LANGUAGE_SLOT_KEYS.map((key) => [key, copySlot(slots[key])]),
);

export const enabledSlotKeys = (slots = {}) => LANGUAGE_SLOT_KEYS.filter(
    (key) => slots[key]?.enable === true,
);

export const enabledSlotCount = (slots = {}) => enabledSlotKeys(slots).length;

export const canAddLanguage = (slots = {}) => enabledSlotCount(slots) < LANGUAGE_SLOT_KEYS.length;

export const canRemoveLanguage = (slots = {}, targetKey) => (
    slots[targetKey]?.enable === true && enabledSlotCount(slots) > 1
);

export const nextDisabledSlotKey = (slots = {}) => (
    LANGUAGE_SLOT_KEYS.find((key) => slots[key]?.enable !== true) ?? null
);

export const findDuplicateSlot = (slots = {}, candidate = {}, excludedKey = null) => {
    if (!candidate.language || !candidate.country) return null;
    return LANGUAGE_SLOT_KEYS.find((key) => (
        key !== String(excludedKey)
        && slots[key]?.enable === true
        && slots[key]?.language === candidate.language
        && slots[key]?.country === candidate.country
    )) ?? null;
};

export const setLanguageSlot = (slots = {}, targetKey, languageData = {}) => {
    const key = String(targetKey);
    if (!LANGUAGE_SLOT_KEYS.includes(key)) return slots;
    const updated = copySlots(slots);
    updated[key] = {
        language: languageData.language ?? "",
        country: languageData.country ?? "",
        enable: true,
    };
    return updated;
};

export const removeLanguageSlot = (slots = {}, targetKey) => {
    const key = String(targetKey);
    if (!canRemoveLanguage(slots, key)) return slots;

    const enabled = enabledSlotKeys(slots)
        .filter((slotKey) => slotKey !== key)
        .map((slotKey) => copySlot(slots[slotKey]));
    const disabled = [
        copySlot(slots[key]),
        ...LANGUAGE_SLOT_KEYS
            .filter((slotKey) => slots[slotKey]?.enable !== true)
            .map((slotKey) => copySlot(slots[slotKey])),
    ];

    return Object.fromEntries(LANGUAGE_SLOT_KEYS.map((slotKey, index) => {
        if (index < enabled.length) {
            return [slotKey, { ...enabled[index], enable: true }];
        }
        return [
            slotKey,
            {
                ...(disabled[index - enabled.length] ?? copySlot()),
                enable: false,
            },
        ];
    }));
};

export const recognitionState = (capability = {}, targetKey, group) => {
    const slotNumber = Number.parseInt(targetKey, 10);
    const maximum = group === "target"
        ? Number(capability.received_max ?? 1)
        : Number(capability.microphone_max ?? 1);
    if (!Number.isFinite(slotNumber) || slotNumber <= maximum) return "active";
    return group === "target" ? "outgoing-only" : "paused";
};
