using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using VRCNT.RuntimeCore.Manifest;
using VRCNT.RuntimeCore.Models;
using Xunit;

namespace VRCNT.RuntimeCore.Tests;

public sealed class ManifestValidationTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task LoadAndVerifyAsync_accepts_cpu_manifest_with_one_part()
    {
        var (manifestPath, signaturePath) = await WriteManifestAsync(CreateManifest(cpuParts: 1, cudaParts: 3));
        var loader = new ManifestLoader(new AcceptingSignatureVerifier());

        var verified = await loader.LoadAndVerifyAsync(manifestPath, signaturePath, "5.15.0", default);

        Assert.Single(verified.Manifest.Variants["cpu"].Parts);
        Assert.Equal(3, verified.Manifest.Variants["cuda"].Parts.Count);
    }

    [Theory]
    [InlineData("duplicate")]
    [InlineData("traversal")]
    public async Task LoadAndVerifyAsync_rejects_unsafe_package_asset_names(string invalidName)
    {
        var manifest = CreateManifest();
        var cpu = manifest.Variants["cpu"];
        var name = invalidName == "duplicate" ? cpu.Parts[0].Name : "..\\payload.7z";
        manifest = manifest with { Variants = new Dictionary<string, VariantPackage>(manifest.Variants)
        {
            ["cuda"] = manifest.Variants["cuda"] with { Parts = [new PackagePart(name, 4, Hash("cuda"))] },
        }};
        var (manifestPath, signaturePath) = await WriteManifestAsync(manifest);

        await Assert.ThrowsAsync<InvalidDataException>(() => new ManifestLoader(new AcceptingSignatureVerifier())
            .LoadAndVerifyAsync(manifestPath, signaturePath, "5.15.0", default));
    }

    [Fact]
    public async Task LoadAndVerifyAsync_rejects_version_mismatch_and_invalid_signature_before_trusting_manifest()
    {
        var (manifestPath, signaturePath) = await WriteManifestAsync(CreateManifest());

        await Assert.ThrowsAsync<CryptographicException>(() => new ManifestLoader(new RejectingSignatureVerifier())
            .LoadAndVerifyAsync(manifestPath, signaturePath, "5.15.0", default));
        await Assert.ThrowsAsync<InvalidDataException>(() => new ManifestLoader(new AcceptingSignatureVerifier())
            .LoadAndVerifyAsync(manifestPath, signaturePath, "5.15.1", default));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    private async Task<(string ManifestPath, string SignaturePath)> WriteManifestAsync(PackageManifest manifest)
    {
        Directory.CreateDirectory(_root);
        var manifestPath = Path.Combine(_root, "package-manifest.json");
        var signaturePath = Path.Combine(_root, "package-manifest.json.sig");
        await File.WriteAllTextAsync(manifestPath, JsonSerializer.Serialize(manifest));
        await File.WriteAllTextAsync(signaturePath, "test-signature");
        return (manifestPath, signaturePath);
    }

    internal static PackageManifest CreateManifest(int cpuParts = 1, int cudaParts = 1)
    {
        VariantPackage Variant(string prefix, RuntimeVariant variant, int count)
        {
            var parts = Enumerable.Range(1, count).Select(i => new PackagePart($"{prefix}.{i:000}", Encoding.UTF8.GetByteCount($"{prefix}{i}"), Hash($"{prefix}{i}"))).ToArray();
            return new(
            "7z", parts.Sum(part => part.Size), parts.Sum(part => part.Size) * 2,
            parts,
            variant == RuntimeVariant.Cuda, "VRCNT.exe",
            new RuntimeIdentity("VRCNT", "5.15.0", variant, "x64", $"{prefix}-build", Hash(prefix)));
        }
        return new PackageManifest(1, "VRCNT", "5.15.0", "x64",
            new BootstrapperMetadata("VRCNT-setup.exe", 4, Hash("bootstrapper"), 1, 1, 1, 1),
            new Dictionary<string, VariantPackage> { ["cpu"] = Variant("cpu", RuntimeVariant.Cpu, cpuParts), ["cuda"] = Variant("cuda", RuntimeVariant.Cuda, cudaParts) });
    }

    internal static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    private sealed class AcceptingSignatureVerifier : IManifestSignatureVerifier
    {
        public Task VerifyAsync(string manifestPath, string signaturePath, CancellationToken cancellationToken) => Task.CompletedTask;
    }

    private sealed class RejectingSignatureVerifier : IManifestSignatureVerifier
    {
        public Task VerifyAsync(string manifestPath, string signaturePath, CancellationToken cancellationToken) => throw new CryptographicException("invalid signature");
    }
}
