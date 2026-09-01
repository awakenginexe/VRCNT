using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using VRCNT.RuntimeCore.Models;
using VRCNT.RuntimeCore.State;
using Xunit;

namespace VRCNT.RuntimeCore.Tests;

public sealed class RuntimeStateTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));

    [Fact]
    public void WriteAtomic_replaces_runtime_state_without_leaving_a_temporary_file()
    {
        var state = CreateState(Path.Combine(_root, "runtime"));

        new RuntimeStateStore().WriteAtomic(_root, state);

        Assert.Equal(state, new RuntimeStateStore().Read(_root));
        Assert.Empty(Directory.EnumerateFiles(_root, "runtime.json.*.tmp", SearchOption.TopDirectoryOnly));
    }

    [Fact]
    public void WriteAtomic_uses_the_shared_camel_case_runtime_state_contract()
    {
        new RuntimeStateStore().WriteAtomic(_root, CreateState(Path.Combine(_root, "runtime")));

        using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(_root, "runtime.json")));
        var state = document.RootElement;

        Assert.True(state.TryGetProperty("schema", out _));
        Assert.True(state.TryGetProperty("installPath", out _));
        Assert.True(state.TryGetProperty("markerBuildIdentity", out _));
        Assert.True(state.TryGetProperty("markerSha256", out _));
        Assert.True(state.TryGetProperty("updatedAtUtc", out _));
        Assert.False(state.TryGetProperty("Schema", out _));
    }

    [Theory]
    [InlineData(RuntimeStateStatus.Active, RuntimeStateStatus.Active)]
    [InlineData(RuntimeStateStatus.Activating, RuntimeStateStatus.Recovery)]
    [InlineData(RuntimeStateStatus.Recovery, RuntimeStateStatus.Recovery)]
    public void Validate_classifies_each_runtime_state_status(RuntimeStateStatus persistedStatus, RuntimeStateStatus expectedStatus)
    {
        var installPath = Path.Combine(_root, "runtime");
        var state = CreateState(installPath) with { Status = persistedStatus };
        WritePayload(installPath, IdentityFor(state));
        state = state with { MarkerSha256 = FileHash(Path.Combine(installPath, "VRCNT.runtime.json")) };

        var validated = new RuntimeStateValidator(new PayloadIdentityReader()).Validate(state, installPath, PackageFor(IdentityFor(state)));

        Assert.Equal(expectedStatus, validated.Status);
    }

    [Fact]
    public void Read_invalid_json_classifies_the_runtime_as_recovery()
    {
        Directory.CreateDirectory(_root);
        File.WriteAllText(Path.Combine(_root, "runtime.json"), "{not json");

        var state = new RuntimeStateStore().Read(_root);

        Assert.Equal(RuntimeStateStatus.Recovery, state.Status);
    }

    [Fact]
    public void Validate_missing_or_stale_install_path_classifies_the_runtime_as_recovery()
    {
        var state = CreateState(Path.Combine(_root, "missing-runtime"));

        var validated = new RuntimeStateValidator(new PayloadIdentityReader()).Validate(state, state.InstallPath, PackageFor(CreateIdentity()));

        Assert.Equal(RuntimeStateStatus.Recovery, validated.Status);
    }

    [Fact]
    public void Validate_malformed_install_path_classifies_the_runtime_as_recovery()
    {
        var state = CreateState("\0");
        var canonicalInstallPath = Path.Combine(_root, "runtime");

        var validated = new RuntimeStateValidator(new PayloadIdentityReader()).Validate(
            state, canonicalInstallPath, PackageFor(CreateIdentity()));

        Assert.Equal(RuntimeStateStatus.Recovery, validated.Status);
    }

    [Theory]
    [InlineData("Product")]
    [InlineData("Version")]
    [InlineData("Variant")]
    [InlineData("Architecture")]
    public void ReadAndValidate_rejects_marker_identity_field_mismatches(string mismatchedField)
    {
        var installPath = Path.Combine(_root, "runtime");
        var expected = CreateIdentity();
        var marker = mismatchedField switch
        {
            "Product" => expected with { Product = "Other" },
            "Version" => expected with { Version = "5.15.1" },
            "Variant" => expected with { Variant = RuntimeVariant.Cuda },
            "Architecture" => expected with { Architecture = "arm64" },
            _ => throw new ArgumentOutOfRangeException(nameof(mismatchedField)),
        };
        WriteMarker(installPath, marker);
        expected = expected with { MarkerSha256 = FileHash(Path.Combine(installPath, "VRCNT.runtime.json")) };

        Assert.Throws<InvalidDataException>(() => new PayloadIdentityReader().ReadAndValidate(installPath, "VRCNT.runtime.json", expected));
    }

    [Fact]
    public void ReadAndValidate_rejects_marker_hash_mismatch()
    {
        var installPath = Path.Combine(_root, "runtime");
        WriteMarker(installPath, CreateIdentity());

        Assert.Throws<CryptographicException>(() => new PayloadIdentityReader().ReadAndValidate(installPath, "VRCNT.runtime.json", CreateIdentity()));
    }

    [Fact]
    public void Validate_accepts_an_active_state_with_a_matching_marker()
    {
        var installPath = Path.Combine(_root, "runtime");
        var identity = CreateIdentity();
        WritePayload(installPath, identity);
        var state = CreateState(installPath) with
        {
            MarkerBuildIdentity = identity.BuildIdentity,
            MarkerSha256 = FileHash(Path.Combine(installPath, "VRCNT.runtime.json")),
        };

        var validated = new RuntimeStateValidator(new PayloadIdentityReader()).Validate(state, installPath, PackageFor(identity with { MarkerSha256 = state.MarkerSha256 }));

        Assert.Equal(RuntimeStateStatus.Active, validated.Status);
    }

    [Fact]
    public void Validate_accepts_a_matching_marker_hash_regardless_of_hex_casing()
    {
        var installPath = Path.Combine(_root, "runtime");
        var identity = CreateIdentity();
        WritePayload(installPath, identity);
        var state = CreateState(installPath) with
        {
            MarkerBuildIdentity = identity.BuildIdentity,
            MarkerSha256 = FileHash(Path.Combine(installPath, "VRCNT.runtime.json")).ToUpperInvariant(),
        };

        var validated = new RuntimeStateValidator(new PayloadIdentityReader()).Validate(state, installPath, PackageFor(identity with { MarkerSha256 = FileHash(Path.Combine(installPath, "VRCNT.runtime.json")) }));

        Assert.Equal(RuntimeStateStatus.Active, validated.Status);
    }

    [Fact]
    public void Validate_uses_authenticated_manifest_identity_instead_of_mutable_state_evidence()
    {
        var installPath = Path.Combine(_root, "runtime");
        var identity = CreateIdentity();
        WritePayload(installPath, identity);
        var markerSha256 = FileHash(Path.Combine(installPath, "VRCNT.runtime.json"));
        var state = CreateState(installPath) with { MarkerBuildIdentity = "tampered-state", MarkerSha256 = new string('b', 64) };

        var validated = new RuntimeStateValidator(new PayloadIdentityReader()).Validate(
            state, installPath, PackageFor(identity with { MarkerSha256 = markerSha256 }));

        Assert.Equal(RuntimeStateStatus.Recovery, validated.Status);
    }

    [Fact]
    public void Validate_missing_expected_runtime_executables_classifies_the_runtime_as_recovery()
    {
        var installPath = Path.Combine(_root, "runtime");
        var identity = CreateIdentity();
        WriteMarker(installPath, identity);
        var markerSha256 = FileHash(Path.Combine(installPath, "VRCNT.runtime.json"));
        var state = CreateState(installPath) with { MarkerSha256 = markerSha256 };

        var validated = new RuntimeStateValidator(new PayloadIdentityReader()).Validate(
            state, installPath, PackageFor(identity with { MarkerSha256 = markerSha256 }));

        Assert.Equal(RuntimeStateStatus.Recovery, validated.Status);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    private static RuntimeState CreateState(string installPath) => new(
        1, RuntimeStateStatus.Active, "VRCNT", "5.15.0", RuntimeVariant.Cpu, "x64", installPath,
        "cpu-build", new string('a', 64), DateTimeOffset.Parse("2026-08-28T00:00:00Z"));

    private static RuntimeIdentity CreateIdentity() => new("VRCNT", "5.15.0", RuntimeVariant.Cpu, "x64", "cpu-build", new string('a', 64));

    private static RuntimeIdentity IdentityFor(RuntimeState state) => new(
        state.Product, state.Version, state.Variant, state.Architecture, state.MarkerBuildIdentity, state.MarkerSha256);

    private static VariantPackage PackageFor(RuntimeIdentity identity) => new(
        "7z", 1, 1, [new PackagePart("payload.7z", 1, new string('c', 64))], identity.Variant == RuntimeVariant.Cuda,
        "VRCNT.runtime.json", identity);

    private static void WritePayload(string installPath, RuntimeIdentity identity)
    {
        WriteMarker(installPath, identity);
        File.WriteAllText(Path.Combine(installPath, "VRCNT.exe"), "app");
        File.WriteAllText(Path.Combine(installPath, "VRCNT-backend.exe"), "backend");
    }

    private static void WriteMarker(string installPath, RuntimeIdentity identity)
    {
        Directory.CreateDirectory(installPath);
        File.WriteAllText(Path.Combine(installPath, "VRCNT.runtime.json"), JsonSerializer.Serialize(identity));
    }

    private static string FileHash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant();
}
