import { useI18n } from "@useI18n";
import { useTranslation } from "@logics_configs";
import { ComputeDevice } from "../_components/compute_device/ComputeDevice";

export const CTranslate2ComputeDevice = () => {
    const { t } = useI18n();
    const {
        currentSelectableTranslationComputeDeviceList,
        currentSelectedTranslationComputeDevice,
        setSelectedTranslationComputeDevice,
        currentSelectedTranslationComputeType,
        setSelectedTranslationComputeType,
    } = useTranslation();

    return (
        <ComputeDevice
            label={t("config_page.translation.translation_compute_device.label")}
            dropdownIdPrefix="translation"
            currentDeviceList={currentSelectableTranslationComputeDeviceList}
            currentSelectedDevice={currentSelectedTranslationComputeDevice}
            setSelectedDevice={setSelectedTranslationComputeDevice}
            currentSelectedComputeType={currentSelectedTranslationComputeType}
            setSelectedComputeType={setSelectedTranslationComputeType}
        />
    );
};
