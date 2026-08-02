const STATUS_KEYS = ["translation", "speaking", "listening"];

export const getSessionActionState = ({ backendReady, statuses }) => {
    const values = STATUS_KEYS.map((key) => statuses?.[key] ?? {});
    const isBusy = values.some((status) => status.state === "pending");
    const hasActivePipeline = values.some((status) => status.data === true);

    return {
        action: hasActivePipeline ? "stop" : "start",
        isBusy,
        isDisabled: backendReady !== true || isBusy,
    };
};

export const getSessionTransitionPlan = (action) => {
    const shouldEnable = action === "start";
    return [
        ["translation", shouldEnable],
        ["speaking", shouldEnable],
        ["listening", shouldEnable],
    ];
};

export const getSessionEndpoint = (action) => (
    `/set/${action === "start" ? "enable" : "disable"}/live_session`
);
