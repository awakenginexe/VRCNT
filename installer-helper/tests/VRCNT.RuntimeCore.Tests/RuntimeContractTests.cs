using System.Text.Json;
using VRCNT.RuntimeCore.Models;
using Xunit;

namespace VRCNT.RuntimeCore.Tests;

public sealed class RuntimeContractTests
{
    [Fact]
    public void PackageManifest_round_trips_with_string_enum_values()
    {
        var cpuIdentity = new RuntimeIdentity(
            "VRCNT",
            "5.15.0",
            RuntimeVariant.Cpu,
            "x64",
            "cpu-build",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        var cudaIdentity = new RuntimeIdentity(
            "VRCNT",
            "5.15.0",
            RuntimeVariant.Cuda,
            "x64",
            "cuda-build",
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
        var manifest = new PackageManifest(
            1,
            "VRCNT",
            "5.15.0",
            "x64",
            new BootstrapperMetadata("VRCNT-setup.exe", 128, "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", 1, 1, 1, 1),
            new Dictionary<string, VariantPackage>
            {
                ["cpu"] = new("7z", 100, 200, [new PackagePart("cpu.7z", 100, "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd")], false, "VRCNT.runtime.json", cpuIdentity),
                ["cuda"] = new("7z", 300, 400, [new PackagePart("cuda.7z", 300, "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee")], true, "VRCNT.runtime.json", cudaIdentity),
            });

        var json = JsonSerializer.Serialize(manifest);
        var roundTripped = JsonSerializer.Deserialize<PackageManifest>(json);

        Assert.Contains("\"Cpu\"", json, StringComparison.Ordinal);
        Assert.Contains("\"Cuda\"", json, StringComparison.Ordinal);
        Assert.NotNull(roundTripped);
        Assert.Equal(RuntimeVariant.Cpu, roundTripped.Variants["cpu"].Identity.Variant);
        Assert.Equal(RuntimeVariant.Cuda, roundTripped.Variants["cuda"].Identity.Variant);
        Assert.False(roundTripped.Variants["cpu"].RequiresNvidia);
        Assert.True(roundTripped.Variants["cuda"].RequiresNvidia);
    }

    [Theory]
    [InlineData(RuntimeVariant.Cpu)]
    [InlineData(RuntimeVariant.Cuda)]
    public void RuntimeVariant_has_the_supported_values(RuntimeVariant variant)
    {
        Assert.Contains(variant, Enum.GetValues<RuntimeVariant>());
        Assert.Equal(2, Enum.GetValues<RuntimeVariant>().Length);
    }

    [Theory]
    [InlineData(RuntimeStateStatus.Active)]
    [InlineData(RuntimeStateStatus.Activating)]
    [InlineData(RuntimeStateStatus.Recovery)]
    public void RuntimeStateStatus_has_the_supported_values(RuntimeStateStatus status)
    {
        Assert.Contains(status, Enum.GetValues<RuntimeStateStatus>());
        Assert.Equal(3, Enum.GetValues<RuntimeStateStatus>().Length);
    }

    [Fact]
    public void TransactionPhase_has_the_shared_transaction_sequence()
    {
        var phases = Enum.GetValues<TransactionPhase>();

        Assert.Equal(
            [
                TransactionPhase.Preflight,
                TransactionPhase.Acquire,
                TransactionPhase.Verify,
                TransactionPhase.Stage,
                TransactionPhase.Quiesce,
                TransactionPhase.Replace,
                TransactionPhase.Activate,
                TransactionPhase.Commit,
                TransactionPhase.Cleanup,
            ],
            phases);
    }
}
