import { useI18n } from "@useI18n";

import {
    MultiDropdownMenuContainer,
} from "../../_templates/Templates";
import { getTranscriptionComputeTypeChoices } from "../../../../../main_page/sidebar_section/language_settings/transcriptionRuntimeUtils.js";

// Compute device helpers
const transformDeviceArray = (devices) => {
    const name_counts = Object.values(devices).reduce((counts, device) => {
        const name = device.device_name;
        counts[name] = (counts[name] || 0) + 1;
        return counts;
    }, {});

    const name_indices = {};
    const result = {};

    Object.entries(devices).forEach(([key, device]) => {
        const name = device.device_name;

        if (name_counts[name] > 1) {
            name_indices[name] = (name_indices[name] || 0);
            const value = `${name}:${name_indices[name]}`;
            name_indices[name]++;
            result[key] = value;
        } else {
            result[key] = name;
        }
    });

    return result;
};

const findKeyByDeviceValue = (devices, target_value) => {
    for (const [key, value] of Object.entries(devices)) {
        if (
            value.device === target_value.device &&
            value.device_index === target_value.device_index &&
            value.device_name === target_value.device_name
        ) {
            return parseInt(key);
        }
    }
    return null;
};

export const ComputeDevice = ({
    label,
    dropdownIdPrefix,
    currentDeviceList,
    currentSelectedDevice,
    setSelectedDevice,
    currentSelectedComputeType,
    setSelectedComputeType,
    computeTypesOverride = null,
    showComputeType = true,
}) => {
    const { t } = useI18n();

    const list_for_ui = transformDeviceArray(currentDeviceList.data);

    const fallback_index = Object.keys(currentDeviceList.data ?? {})[0] ?? null;
    const target_index = findKeyByDeviceValue(currentDeviceList.data, currentSelectedDevice.data) ?? fallback_index;

    const computeTypesArray = computeTypesOverride ?? currentDeviceList.data?.[target_index]?.compute_types ?? ["auto"];

    const compute_type_choices = getTranscriptionComputeTypeChoices(computeTypesArray);

    const new_compute_types_labels = Object.fromEntries(compute_type_choices.map(({ id, memory, supported }) => [
        id,
        `${id === "auto" ? t("config_page.common.compute_device.type_template_auto") : id} — ${t(supported
            ? `main_page.engines_workspace.compute_type_${memory}_detail`
            : "main_page.engines_workspace.compute_type_unsupported")}`,
    ]));

    const selectFunction_ComputeDevice = (selected_data) => {
        const target_obj = currentDeviceList.data[selected_data.selected_id];
        setSelectedDevice(target_obj);
    };

    const selectFunction_ComputeType = (selected_data) => {
        setSelectedComputeType(selected_data.selected_id);
    };

    const is_disabled_selector = currentSelectedDevice.state === "pending"
        || (showComputeType && currentSelectedComputeType.state === "pending");

    const dropdownSettings = [
        {
            dropdown_id: `${dropdownIdPrefix}_compute_device`,
            secondary_label: t("config_page.common.compute_device.label_device"),
            selected_id: target_index,
            list: list_for_ui,
            selectFunction: selectFunction_ComputeDevice,
            state: currentSelectedDevice.state,
            is_disabled: is_disabled_selector,
        },
    ];
    if (showComputeType) {
        dropdownSettings.push({
            dropdown_id: `${dropdownIdPrefix}_compute_type`,
            secondary_label: t("config_page.common.compute_device.label_type"),
            selected_id: currentSelectedComputeType.data,
            list: new_compute_types_labels,
            disabled_ids: compute_type_choices.filter((choice) => !choice.supported).map((choice) => choice.id),
            selectFunction: selectFunction_ComputeType,
            state: currentSelectedComputeType.state,
            is_disabled: is_disabled_selector,
        });
    }

    return (
        <MultiDropdownMenuContainer
            label={label}
            desc={t("config_page.common.compute_device.desc")}
            dropdown_settings={dropdownSettings}
        />
    );
};
