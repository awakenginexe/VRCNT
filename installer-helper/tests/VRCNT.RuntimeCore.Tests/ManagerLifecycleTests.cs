using System.Security.Cryptography;
using System.Text;
using VRCNT.RuntimeCore.Manager;
using VRCNT.RuntimeCore.Models;
using VRCNT.Setup.CommandLine;
using Xunit;

namespace VRCNT.RuntimeCore.Tests;

public sealed class ManagerLifecycleTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "vrcnt-manager", Guid.NewGuid().ToString("N"));

    [Fact]
    public void Current_capabilities_are_embedded_for_the_5_15_manager_contract()
    {
        Assert.Equal(new ManagerCapabilities("5.15.0", 1, 1, 1, 1), ManagerCapabilities.Current);
    }

    [Fact]
    public async Task CheckAsync_rejects_a_manager_hash_mismatch_without_using_manager_state_as_trust()
    {
        var managerPath = WriteFile("VRCNT.Setup.exe", "known-manageR");
        var manifest = CreateManifest(managerBytes: "known-manager");
        var stateStore = CreateStateStore(managerPath);
        stateStore.Write(new ManagerState(managerPath, Hash("known-manager"), "5.15.0", 1, 1, 1, 1, true, null, DateTimeOffset.UtcNow));

        var result = await CreateLifecycle(managerPath, manifest, stateStore).CheckAsync(default);

        Assert.False(result.IsIntact);
        Assert.False(result.IsCompatible);
        Assert.Equal("manager_hash_mismatch", result.FailureCode);
    }

    [Fact]
    public async Task CheckAsync_fails_closed_when_diagnostic_manager_state_is_missing()
    {
        var managerPath = WriteFile("VRCNT.Setup.exe", "known-manager");
        var result = await CreateLifecycle(managerPath, CreateManifest(), CreateStateStore(managerPath)).CheckAsync(default);

        Assert.False(result.IsIntact);
        Assert.False(result.IsCompatible);
        Assert.Equal("manager_state_missing", result.FailureCode);
    }

    [Fact]
    public async Task CheckAsync_rejects_incompatible_signed_manifest_capabilities()
    {
        var managerPath = WriteFile("VRCNT.Setup.exe", "known-manager");
        var manifest = CreateManifest() with
        {
            Bootstrapper = CreateManifest().Bootstrapper with { RuntimeStateSchema = 2 },
        };
        var stateStore = CreateStateStore(managerPath);
        stateStore.Write(new ManagerState(managerPath, Hash("known-manager"), "5.15.0", 1, 1, 2, 1, true, null, DateTimeOffset.UtcNow));

        var result = await CreateLifecycle(managerPath, manifest, stateStore).CheckAsync(default);

        Assert.False(result.IsIntact);
        Assert.False(result.IsCompatible);
        Assert.Equal("manager_incompatible", result.FailureCode);
    }

    [Fact]
    public async Task RepairAsync_promotes_a_signed_and_hashed_candidate_and_records_diagnostics_after_self_check()
    {
        var managerPath = WriteFile("VRCNT.Setup.exe", "old-manager");
        var candidatePath = WriteFile(Path.Combine("repair", "VRCNT.Setup.exe"), "new-manager");
        WriteFile(Path.Combine("repair", "VRCNT.Setup.exe.sig"), "signature");
        WriteFile(Path.Combine("repair", "VRCNT.Setup.exe.sig"), "signature");
        var manifest = CreateManifest(managerBytes: "new-manager");
        var stateStore = CreateStateStore(managerPath);
        stateStore.Write(new ManagerState(managerPath, Hash("old-manager"), "5.15.0", 1, 1, 1, 1, true, null, DateTimeOffset.UtcNow));
        var observedDuringSelfCheck = false;
        var handoff = new ManagerHandoff(
            managerPath,
            async (path, _) =>
            {
                observedDuringSelfCheck = File.Exists(path + ".last-known-good");
                return new ManagerSelfCheckResult(true, true, null);
            },
            _ => Task.CompletedTask);
        var lifecycle = CreateLifecycle(managerPath, manifest, stateStore, new FixedRepairSource(candidatePath), handoff);

        var result = await lifecycle.RepairAsync(new Uri("https://example.test/latest.json"), default);

        Assert.True(result.Succeeded);
        Assert.Equal(Path.GetFullPath(managerPath), result.PromotedPath);
        Assert.Equal("new-manager", await File.ReadAllTextAsync(managerPath));
        Assert.True(observedDuringSelfCheck);
        Assert.False(File.Exists(managerPath + ".last-known-good"));
        Assert.Equal(Hash("new-manager"), stateStore.Read()!.ManagerSha256);
    }

    [Theory]
    [InlineData("signature")]
    [InlineData("hash")]
    public async Task RepairAsync_does_not_replace_the_last_known_good_manager_on_verification_failure(string failure)
    {
        var managerPath = WriteFile("VRCNT.Setup.exe", "old-manager");
        var candidatePath = WriteFile(Path.Combine("repair", "VRCNT.Setup.exe"), "new-manager");
        WriteFile(Path.Combine("repair", "VRCNT.Setup.exe.sig"), "signature");
        var manifest = CreateManifest(managerBytes: failure == "hash" ? "new-manageR" : "new-manager");
        var stateStore = CreateStateStore(managerPath);
        stateStore.Write(new ManagerState(managerPath, Hash("old-manager"), "5.15.0", 1, 1, 1, 1, true, null, DateTimeOffset.UtcNow));
        var verifier = new FixedSignatureVerifier(failure != "signature");
        var lifecycle = CreateLifecycle(managerPath, manifest, stateStore, new FixedRepairSource(candidatePath), handoff: null, verifier);

        var result = await lifecycle.RepairAsync(new Uri("https://example.test/latest.json"), default);

        Assert.False(result.Succeeded);
        Assert.Equal("new-manager", await File.ReadAllTextAsync(candidatePath));
        Assert.Equal("old-manager", await File.ReadAllTextAsync(managerPath));
        Assert.Equal(failure == "signature" ? "manager_signature_invalid" : "manager_hash_mismatch", result.FailureCode);
    }

    [Fact]
    public async Task Handoff_exits_the_old_manager_before_atomic_promotion_and_rolls_back_if_new_self_check_fails()
    {
        var managerPath = WriteFile("VRCNT.Setup.exe", "old-manager");
        var candidatePath = WriteFile(Path.Combine("repair", "VRCNT.Setup.exe"), "new-manager");
        WriteFile(Path.Combine("repair", "VRCNT.Setup.exe.sig"), "signature");
        var events = new List<string>();
        var handoff = new ManagerHandoff(
            managerPath,
            async (path, _) =>
            {
                events.Add("self-check");
                Assert.True(File.Exists(path + ".last-known-good"));
                return new ManagerSelfCheckResult(false, true, "manager_incompatible");
            },
            _ =>
            {
                events.Add("exit-old-manager");
                return Task.CompletedTask;
            });

        await Assert.ThrowsAsync<ManagerHandoffException>(() => handoff.PromoteAsync(candidatePath, default));

        Assert.Equal(new[] { "exit-old-manager", "self-check" }, events);
        Assert.Equal("old-manager", await File.ReadAllTextAsync(managerPath));
        Assert.False(File.Exists(managerPath + ".last-known-good"));
    }

    [Fact]
    public void Command_line_parser_preserves_update_passive_switch_repair_install_and_current_app_handoff()
    {
        var options = SetupCommandLine.Parse([
            "/UPDATE", "/passive", "--switch", "--variant", "cuda", "--repair-manager",
            "--install-path", "C:\\VRCNT", "--current-app", "C:\\VRCNT\\VRCNT.exe",
        ]);

        Assert.True(options.IsUpdate);
        Assert.True(options.IsPassive);
        Assert.True(options.IsSwitch);
        Assert.True(options.IsRepairManager);
        Assert.Equal(RuntimeVariant.Cuda, options.Variant);
        Assert.Equal(Path.GetFullPath("C:\\VRCNT"), options.InstallPath);
        Assert.Equal(Path.GetFullPath("C:\\VRCNT\\VRCNT.exe"), options.CurrentAppPath);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    private SetupManagerLifecycle CreateLifecycle(
        string managerPath,
        PackageManifest manifest,
        ManagerStateStore stateStore,
        IManagerRepairSource? repairSource = null,
        ManagerHandoff? handoff = null,
        ISetupSignatureVerifier? verifier = null) =>
        new(
            managerPath,
            manifest,
            new ManagerSelfCheck(ManagerCapabilities.Current, verifier ?? new FixedSignatureVerifier(true)),
            stateStore,
            repairSource ?? new FixedRepairSource(WriteFile(Path.Combine("repair", "default.exe"), "new-manager")),
            handoff ?? new ManagerHandoff(managerPath));

    private ManagerStateStore CreateStateStore(string managerPath) => new(_root, ManagerCapabilities.Current, managerPath);

    private string WriteFile(string relativePath, string contents)
    {
        var path = Path.Combine(_root, relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, contents);
        return path;
    }

    private static PackageManifest CreateManifest(string managerBytes = "known-manager") =>
        new(
            1,
            "VRCNT",
            "5.15.0",
            "x64",
            new BootstrapperMetadata(
                "VRCNT.Setup.exe",
                Encoding.UTF8.GetByteCount(managerBytes),
                Hash(managerBytes),
                1,
                1,
                1,
                1),
            new Dictionary<string, VariantPackage>());

    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    private sealed class FixedRepairSource(string candidatePath) : IManagerRepairSource
    {
        public Task<VerifiedManagerUpdate> AcquireAsync(Uri latestJsonUri, CancellationToken cancellationToken) =>
            Task.FromResult(new VerifiedManagerUpdate(candidatePath, candidatePath + ".sig"));
    }

    private sealed class FixedSignatureVerifier(bool succeeds) : ISetupSignatureVerifier
    {
        public Task VerifyAsync(string setupPath, string signaturePath, CancellationToken cancellationToken) =>
            succeeds ? Task.CompletedTask : Task.FromException(new CryptographicException("invalid setup signature"));
    }
}
