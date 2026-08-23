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

export const createStartWithVrchatCheckboxProps = ({
    isTauri,
    startWithVrchatState,
}) => ({
    variable: {
        data: startWithVrchatState.registration === true,
        state: startWithVrchatState.state,
    },
    is_available: Boolean(isTauri && startWithVrchatState.isInteractive),
});

export const readStartWithVrchatStatus = async ({
    isTauri,
    getRegistrationStatus,
}) => {
    if (!isTauri) return createInitialStartWithVrchatState(false);
    try {
        return createConfirmedStartWithVrchatState(await getRegistrationStatus());
    } catch {
        return createUnknownStartWithVrchatState();
    }
};

export const shouldShowStartWithVrchatStatusError = ({ isTauri, state }) => (
    isTauri && !state.isInteractive
);

export const reconcileStartWithVrchatMutation = async ({
    changeRegistration,
    getRegistrationStatus,
}) => {
    try {
        return {
            state: createConfirmedStartWithVrchatState(await changeRegistration()),
            hasError: false,
        };
    } catch {
        return {
            state: await readStartWithVrchatStatus({
                isTauri: true,
                getRegistrationStatus,
            }),
            hasError: true,
        };
    }
};

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

export const dismissStartWithVrchatConfirmation = ({ isSaving = false, closeModal }) => {
    if (isSaving) return { type: "blocked" };
    closeModal();
    return { type: "dismissed" };
};

export const confirmStartWithVrchatRegistration = ({
    enableRegistration,
    getRegistrationStatus,
}) => reconcileStartWithVrchatMutation({
    changeRegistration: enableRegistration,
    getRegistrationStatus,
});

export const getStartWithVrchatConfirmationOutcome = (result) => ({
    shouldClose: result.state.registration && !result.hasError,
    shouldShowError: !result.state.registration || result.hasError,
});
