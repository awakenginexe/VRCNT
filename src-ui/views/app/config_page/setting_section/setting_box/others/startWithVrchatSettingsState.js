export const createUnknownStartWithVrchatState = () => ({
    registration: null,
    state: "pending",
    isInteractive: false,
});

export const createInitialStartWithVrchatState = (isTauri) => (
    isTauri
        ? createUnknownStartWithVrchatState()
        : {
            registration: false,
            state: "ok",
            isInteractive: false,
        }
);

export const createConfirmedStartWithVrchatState = (registration) => ({
    registration,
    state: "ok",
    isInteractive: true,
});

export const requestStartWithVrchatChange = async ({
    registration,
    isInteractive,
    onRequestConfirmation,
}) => {
    if (!isInteractive) return { type: "unavailable" };
    if (!registration) {
        onRequestConfirmation();
        return { type: "confirmation" };
    }
    return { type: "disable" };
};

export const dismissStartWithVrchatConfirmation = ({ closeModal }) => {
    closeModal();
    return { type: "dismissed" };
};

export const confirmStartWithVrchatRegistration = async ({ enableRegistration }) => ({
    registration: await enableRegistration(),
});
