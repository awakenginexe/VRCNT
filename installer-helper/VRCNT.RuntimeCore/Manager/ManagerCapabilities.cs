using VRCNT.RuntimeCore.Models;

namespace VRCNT.RuntimeCore.Manager;

public sealed record ManagerCapabilities(
    string Version,
    int ManagerProtocol,
    int ManifestSchema,
    int RuntimeStateSchema,
    int ActivationProtocol)
{
    public static ManagerCapabilities Current { get; } = new("5.15.0", 1, 2, 1, 1);

    public bool IsCompatibleWith(PackageManifest manifest) =>
        manifest.Schema == ManifestSchema &&
        manifest.Bootstrapper is not null &&
        manifest.Bootstrapper.ManagerProtocol == ManagerProtocol &&
        manifest.Bootstrapper.ManifestSchema == ManifestSchema &&
        manifest.Bootstrapper.RuntimeStateSchema == RuntimeStateSchema &&
        manifest.Bootstrapper.ActivationProtocol == ActivationProtocol;

    public bool IsCompatibleWith(BootstrapperMetadata bootstrapper) =>
        bootstrapper.ManagerProtocol == ManagerProtocol &&
        bootstrapper.ManifestSchema == ManifestSchema &&
        bootstrapper.RuntimeStateSchema == RuntimeStateSchema &&
        bootstrapper.ActivationProtocol == ActivationProtocol;
}
