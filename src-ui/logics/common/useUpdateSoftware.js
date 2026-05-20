import { useStdoutToPython } from "@useStdoutToPython";
import { useSoftwareVersion } from "./useSoftwareVersion";

export const useUpdateSoftware = () => {
    const { asyncStdoutToPython } = useStdoutToPython();
    const { currentLatestSoftwareVersionInfo } = useSoftwareVersion();

    const updateSoftware = () => {
        const releaseUrl = currentLatestSoftwareVersionInfo.data.release_url;
        if (releaseUrl) {
            window.open(releaseUrl, "_blank", "noopener,noreferrer");
            return;
        }
        asyncStdoutToPython("/run/update_software");
    };

    return {
        updateSoftware,
    };
};
