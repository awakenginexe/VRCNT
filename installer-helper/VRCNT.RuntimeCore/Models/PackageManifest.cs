namespace VRCNT.RuntimeCore.Models;

public sealed record PackagePart(string Name, long Size, string Sha256);

public sealed record BootstrapperMetadata(
    string Name,
    long Size,
    string Sha256,
    int ManagerProtocol,
    int ManifestSchema,
    int RuntimeStateSchema,
    int ActivationProtocol);

public sealed record VariantPackage(
    string ArchiveFormat,
    long CompressedSize,
    long InstalledSize,
    IReadOnlyList<PackagePart> Parts,
    bool RequiresNvidia,
    string MarkerPath,
    RuntimeIdentity Identity);

public sealed record PackageManifest(
    int Schema,
    string Product,
    string Version,
    string Architecture,
    BootstrapperMetadata Bootstrapper,
    IReadOnlyDictionary<string, VariantPackage> Variants);
