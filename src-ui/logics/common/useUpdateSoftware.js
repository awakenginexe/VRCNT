import { useStdoutToPython } from "@useStdoutToPython";

export const useUpdateSoftware = () => {
    const { asyncStdoutToPython } = useStdoutToPython();
    const updateSoftware = () => {
        asyncStdoutToPython("/run/update_software");
    };

    return {
        updateSoftware,
    };
};
