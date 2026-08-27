using System.Security.Cryptography;
using System.Text.Json;
using VRCNT.RuntimeCore.Models;

namespace VRCNT.RuntimeCore.Manifest;

public sealed record VerifiedManifest(PackageManifest Manifest, string ManifestPath);

public interface IManifestSignatureVerifier
{
    Task VerifyAsync(string manifestPath, string signaturePath, CancellationToken cancellationToken);
}

public interface IManifestLoader
{
    Task<VerifiedManifest> LoadAndVerifyAsync(string manifestPath, string signaturePath, string expectedVersion, CancellationToken cancellationToken);
}

public sealed class ManifestLoader(IManifestSignatureVerifier verifier) : IManifestLoader
{
    private const long MaxGitHubAssetBytes = 2_000_000_000;

    public async Task<VerifiedManifest> LoadAndVerifyAsync(string manifestPath, string signaturePath, string expectedVersion, CancellationToken cancellationToken)
    {
        await verifier.VerifyAsync(manifestPath, signaturePath, cancellationToken);
        await using var stream = File.OpenRead(manifestPath);
        var manifest = await JsonSerializer.DeserializeAsync<PackageManifest>(stream, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }, cancellationToken)
            ?? throw new InvalidDataException("The package manifest is empty.");
        Validate(manifest, expectedVersion);
        return new VerifiedManifest(manifest, manifestPath);
    }

    private static void Validate(PackageManifest manifest, string expectedVersion)
    {
        if (manifest.Schema != 1 || !string.Equals(manifest.Product, "VRCNT", StringComparison.Ordinal) ||
            !string.Equals(manifest.Version, expectedVersion, StringComparison.Ordinal) || !string.Equals(manifest.Architecture, "x64", StringComparison.Ordinal))
            throw new InvalidDataException("Package manifest identity does not match this installer.");
        if (manifest.Variants is null || manifest.Variants.Count == 0) throw new InvalidDataException("Package manifest has no variants.");
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (key, package) in manifest.Variants)
        {
            if (!TryVariant(key, out var variant) || package is null || package.Parts is null || package.Parts.Count == 0 ||
                package.Identity is null || !string.Equals(package.MarkerPath, "VRCNT.runtime.json", StringComparison.Ordinal) ||
                string.IsNullOrWhiteSpace(package.Identity.BuildIdentity) || !IsSha256(package.Identity.MarkerSha256) || package.RequiresNvidia != (variant == RuntimeVariant.Cuda) ||
                package.Identity.Variant != variant || !string.Equals(package.Identity.Product, manifest.Product, StringComparison.Ordinal) ||
                !string.Equals(package.Identity.Version, manifest.Version, StringComparison.Ordinal) || !string.Equals(package.Identity.Architecture, manifest.Architecture, StringComparison.Ordinal))
                throw new InvalidDataException($"Package manifest variant '{key}' is invalid.");
            foreach (var part in package.Parts)
            {
                if (!IsSafeAssetName(part.Name) || !names.Add(part.Name) || part.Size <= 0 || part.Size >= MaxGitHubAssetBytes || !IsSha256(part.Sha256))
                    throw new InvalidDataException($"Package part '{part.Name}' is invalid.");
            }
        }
    }

    private static bool TryVariant(string key, out RuntimeVariant variant) => key switch { "cpu" => Set(RuntimeVariant.Cpu, out variant), "cuda" => Set(RuntimeVariant.Cuda, out variant), _ => Set(default, out variant) && false };
    private static bool Set(RuntimeVariant value, out RuntimeVariant variant) { variant = value; return true; }
    internal static bool IsSafeAssetName(string? name) => !string.IsNullOrWhiteSpace(name) && name == Path.GetFileName(name) && !name.Contains("..", StringComparison.Ordinal) && !name.Contains('/') && !name.Contains('\\');
    internal static bool IsSha256(string? value) => value?.Length == 64 && value.All(Uri.IsHexDigit);
}
