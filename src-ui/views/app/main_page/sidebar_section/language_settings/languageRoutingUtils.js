export const getRecognitionProfileForSelector = ({
    selectorType,
    sendProfile,
    receiveProfile,
}) => {
    if (selectorType === "your_language") return sendProfile ?? null;
    if (selectorType === "target_language") return receiveProfile ?? null;
    return null;
};

export const getRecognitionEngineForGroup = ({ group, sendProfile, receiveProfile }) => {
    const profile = group === "target" ? receiveProfile : sendProfile;
    return profile?.engine ?? "";
};

export const getProfileModel = (profile, engine) => profile?.models?.[engine] ?? "";
