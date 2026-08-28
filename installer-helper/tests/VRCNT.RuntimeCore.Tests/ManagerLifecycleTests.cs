using System.Security.Cryptography;
using System.Text;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using VRCNT.RuntimeCore.Manager;
using VRCNT.RuntimeCore.Models;
using VRCNT.Setup.CommandLine;
using VRCNT.Setup;
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
        var managerPath = WriteFile(Path.Combine("VRCNTInstaller", "VRCNT.Setup.exe"), "known-manageR");
        var manifest = CreateManifest(managerBytes: "known-manager");
        var stateStore = CreateStateStore(managerPath);
        stateStore.Write(new ManagerState(managerPath, Hash("known-manager"), "5.15.0", 1, 1, 1, 1, true, null, DateTimeOffset.UtcNow));

        var result = await CreateLifecycle(managerPath, manifest, stateStore).CheckAsync(default);

        Assert.False(result.IsIntact);
        Assert.False(result.IsCompatible);
        Assert.Equal("manager_hash_mismatch", result.FailureCode);
    }

    [Fact]
    public async Task CheckAsync_ignores_a_missing_diagnostic_manager_state_when_the_manager_is_verified()
    {
        var managerPath = WriteFile(Path.Combine("VRCNTInstaller", "VRCNT.Setup.exe"), "known-manager");
        var result = await CreateLifecycle(managerPath, CreateManifest(), CreateStateStore(managerPath)).CheckAsync(default);

        Assert.True(result.IsIntact);
        Assert.True(result.IsCompatible);
        Assert.Null(result.FailureCode);
    }

    [Fact]
    public async Task CheckAsync_ignores_corrupt_diagnostic_manager_state_when_the_manager_is_verified()
    {
        var managerPath = WriteFile(Path.Combine("VRCNTInstaller", "VRCNT.Setup.exe"), "known-manager");
        var stateStore = CreateStateStore(managerPath);
        Directory.CreateDirectory(Path.GetDirectoryName(stateStore.StatePath)!);
        await File.WriteAllTextAsync(stateStore.StatePath, "{ not valid json");

        var result = await CreateLifecycle(managerPath, CreateManifest(), stateStore).CheckAsync(default);

        Assert.True(result.IsIntact);
        Assert.True(result.IsCompatible);
        Assert.Null(result.FailureCode);
    }

    [Fact]
    public async Task CheckAsync_rejects_incompatible_signed_manifest_capabilities()
    {
        var managerPath = WriteFile(Path.Combine("VRCNTInstaller", "VRCNT.Setup.exe"), "known-manager");
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
        var managerPath = WriteFile(Path.Combine("VRCNTInstaller", "VRCNT.Setup.exe"), "old-manager");
        var candidatePath = WriteFile(Path.Combine("VRCNTInstaller", "repair", "VRCNT.Setup.exe"), "new-manager");
        WriteFile(Path.Combine("VRCNTInstaller", "repair", "VRCNT.Setup.exe.sig"), "signature");
        var manifest = CreateManifest(managerBytes: "new-manager");
        var stateStore = CreateStateStore(managerPath);
        stateStore.Write(new ManagerState(managerPath, Hash("old-manager"), "5.15.0", 1, 1, 1, 1, true, null, DateTimeOffset.UtcNow));
        var handoff = new ManagerHandoff(
            managerPath,
            (_, _) => Task.FromResult(new ManagerSelfCheckResult(true, true, null)),
            async (_, _) => new ManagerSelfCheckResult(true, true, null),
            _ => Task.CompletedTask);
        var lifecycle = CreateLifecycle(managerPath, manifest, stateStore, new FixedRepairSource(candidatePath), handoff);

        var result = await lifecycle.RepairAsync(new Uri("https://example.test/latest.json"), default);

        Assert.True(result.Succeeded);
        Assert.Equal(Path.GetFullPath(managerPath), result.PromotedPath);
        Assert.Equal("new-manager", await File.ReadAllTextAsync(managerPath));
        Assert.False(File.Exists(managerPath + ".last-known-good"));
        Assert.Equal(Hash("new-manager"), stateStore.Read()!.ManagerSha256);
    }

    [Theory]
    [InlineData("signature")]
    [InlineData("hash")]
    public async Task RepairAsync_does_not_replace_the_last_known_good_manager_on_verification_failure(string failure)
    {
        var managerPath = WriteFile(Path.Combine("VRCNTInstaller", "VRCNT.Setup.exe"), "old-manager");
        var candidatePath = WriteFile(Path.Combine("VRCNTInstaller", "repair", "VRCNT.Setup.exe"), "new-manager");
        WriteFile(Path.Combine("VRCNTInstaller", "repair", "VRCNT.Setup.exe.sig"), "signature");
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
        var managerPath = WriteFile(Path.Combine("VRCNTInstaller", "VRCNT.Setup.exe"), "old-manager");
        var candidatePath = WriteFile(Path.Combine("VRCNTInstaller", "repair", "VRCNT.Setup.exe"), "new-manager");
        WriteFile(Path.Combine("VRCNTInstaller", "repair", "VRCNT.Setup.exe.sig"), "signature");
        var events = new List<string>();
        var handoff = new ManagerHandoff(
            managerPath,
            async (path, _) =>
            {
                events.Add("candidate-self-check");
                return new ManagerSelfCheckResult(true, true, null);
            },
            async (_, _) =>
            {
                events.Add("promoted-self-check");
                return new ManagerSelfCheckResult(false, true, "manager_incompatible");
            },
            _ =>
            {
                events.Add("exit-old-manager");
                return Task.CompletedTask;
            });

        await Assert.ThrowsAsync<ManagerHandoffException>(() => PromoteCandidateAsync(handoff, candidatePath));

        Assert.Equal(new[] { "candidate-self-check", "exit-old-manager", "candidate-self-check", "promoted-self-check" }, events);
        Assert.Equal("old-manager", await File.ReadAllTextAsync(managerPath));
        Assert.False(File.Exists(managerPath + ".last-known-good"));
    }

    [Fact]
    public async Task Handoff_rechecks_the_candidate_after_the_exit_signal_and_restores_old_manager_when_the_candidate_changes()
    {
        var managerPath = WriteFile(Path.Combine("VRCNTInstaller", "VRCNT.Setup.exe"), "old-manager");
        var candidatePath = WriteFile(Path.Combine("VRCNTInstaller", "repair", "VRCNT.Setup.exe"), "new-manager");
        WriteFile(Path.Combine("VRCNTInstaller", "repair", "VRCNT.Setup.exe.sig"), "signature");
        var events = new List<string>();
        var handoff = new ManagerHandoff(
            managerPath,
            async (path, _) =>
            {
                events.Add("candidate-self-check");
                return new ManagerSelfCheckResult(await File.ReadAllTextAsync(path) == "new-manager", true, "candidate_changed");
            },
            async (path, _) =>
            {
                events.Add("promoted-self-check");
                return new ManagerSelfCheckResult(await File.ReadAllTextAsync(path) == "new-manager", true, "candidate_changed");
            },
            _ =>
            {
                events.Add("exit-old-manager");
                File.WriteAllText(candidatePath, "tampered-manager");
                return Task.CompletedTask;
            });

        await Assert.ThrowsAsync<ManagerHandoffException>(() => PromoteCandidateAsync(handoff, candidatePath));

        Assert.Equal(new[] { "candidate-self-check", "exit-old-manager", "candidate-self-check" }, events);
        Assert.Equal("old-manager", await File.ReadAllTextAsync(managerPath));
        Assert.False(File.Exists(managerPath + ".last-known-good"));
    }

    [Fact]
    public async Task Handoff_rejects_a_candidate_tampered_after_the_final_callback_verification()
    {
        var managerPath = WriteFile(Path.Combine("VRCNTInstaller", "VRCNT.Setup.exe"), "old-manager");
        var candidatePath = WriteFile(Path.Combine("VRCNTInstaller", "repair", "VRCNT.Setup.exe"), "new-manager");
        WriteFile(Path.Combine("VRCNTInstaller", "repair", "VRCNT.Setup.exe.sig"), "signature");
        var checks = 0;
        var handoff = new ManagerHandoff(
            managerPath,
            async (path, _) =>
            {
                checks++;
                var result = new ManagerSelfCheckResult(true, true, null);
                if (checks == 2) await File.WriteAllTextAsync(path, "tampered-manager");
                return result;
            },
            (_, _) => Task.FromResult(new ManagerSelfCheckResult(true, true, null)),
            _ => Task.CompletedTask);

        await Assert.ThrowsAsync<ManagerHandoffException>(() => PromoteCandidateAsync(handoff, candidatePath));

        Assert.Equal("old-manager", await File.ReadAllTextAsync(managerPath));
        Assert.Equal("tampered-manager", await File.ReadAllTextAsync(candidatePath));
        Assert.False(File.Exists(managerPath + ".last-known-good"));
    }

    [Fact]
    public async Task Handoff_preserves_the_old_manager_when_the_filesystem_swap_fails()
    {
        var managerPath = Path.Combine(_root, "VRCNTInstaller", "VRCNT.Setup.exe");
        Directory.CreateDirectory(managerPath);
        var candidatePath = WriteFile(Path.Combine("VRCNTInstaller", "repair", "VRCNT.Setup.exe"), "new-manager");
        WriteFile(Path.Combine("VRCNTInstaller", "repair", "VRCNT.Setup.exe.sig"), "signature");
        var handoff = new ManagerHandoff(
            managerPath,
            (_, _) => Task.FromResult(new ManagerSelfCheckResult(true, true, null)),
            (_, _) => Task.FromResult(new ManagerSelfCheckResult(true, true, null)),
            _ => Task.CompletedTask);

        var exception = await Assert.ThrowsAsync<ManagerHandoffException>(() => PromoteCandidateAsync(handoff, candidatePath));

        Assert.Equal("manager_handoff_failed", exception.FailureCode);
        Assert.True(Directory.Exists(managerPath));
        Assert.Equal("new-manager", await File.ReadAllTextAsync(candidatePath));
        Assert.False(File.Exists(managerPath + ".last-known-good"));
    }

    [Fact]
    public async Task RepairAsync_succeeds_when_diagnostic_persistence_fails_after_verified_promotion()
    {
        var managerPath = WriteFile(Path.Combine("VRCNTInstaller", "VRCNT.Setup.exe"), "old-manager");
        var candidatePath = WriteFile(Path.Combine("VRCNTInstaller", "repair", "VRCNT.Setup.exe"), "new-manager");
        WriteFile(Path.Combine("VRCNTInstaller", "repair", "VRCNT.Setup.exe.sig"), "signature");
        var stateRoot = Path.Combine(_root, "diagnostics");
        Directory.CreateDirectory(stateRoot);
        File.WriteAllText(Path.Combine(stateRoot, "VRCNTInstaller"), "not-a-directory");
        var stateStore = new ManagerStateStore(stateRoot, ManagerCapabilities.Current, managerPath);
        var lifecycle = CreateLifecycle(managerPath, CreateManifest(managerBytes: "new-manager"), stateStore, new FixedRepairSource(candidatePath));

        var result = await lifecycle.RepairAsync(new Uri("https://example.test/latest.json"), default);

        Assert.True(result.Succeeded);
        Assert.Equal("new-manager", await File.ReadAllTextAsync(managerPath));
        Assert.False(File.Exists(managerPath + ".last-known-good"));
    }

    [Fact]
    public void Command_line_parser_preserves_update_passive_switch_repair_install_and_current_app_handoff()
    {
        var options = SetupCommandLine.Parse([
            "/UPDATE", "/passive", "--switch", "--variant", "cuda", "--repair-manager",
            "--install-path", "C:\\VRCNT", "--current-app", "C:\\VRCNT\\VRCNT.exe",
            "--switch-token", "handoff-token", "--switch-status", "C:\\VRCNTData\\runtime-switch-status.json",
        ]);

        Assert.True(options.IsUpdate);
        Assert.True(options.IsPassive);
        Assert.True(options.IsSwitch);
        Assert.True(options.IsRepairManager);
        Assert.Equal(RuntimeVariant.Cuda, options.Variant);
        Assert.Equal(Path.GetFullPath("C:\\VRCNT"), options.InstallPath);
        Assert.Equal(Path.GetFullPath("C:\\VRCNT\\VRCNT.exe"), options.CurrentAppPath);
        Assert.Equal("handoff-token", options.SwitchToken);
        Assert.Equal(Path.GetFullPath("C:\\VRCNTData\\runtime-switch-status.json"), options.SwitchStatusPath);
    }

    [Fact]
    public async Task Command_dispatcher_rejects_a_switch_without_an_explicit_target()
    {
        var operations = new RecordingSetupOperations();
        var options = new SetupCommandLineOptions(false, false, true, false, false, null, "C:\\VRCNT", null, [], null);

        await Assert.ThrowsAsync<ArgumentException>(() => new SetupCommandDispatcher(operations).DispatchAsync(options, default));
        Assert.Empty(operations.Calls);
    }

    [Fact]
    public async Task Command_dispatcher_executes_runtime_operation_and_current_app_handoff_without_deciding_ui_policy()
    {
        var operations = new RecordingSetupOperations();
        var options = SetupCommandLine.Parse(["/UPDATE", "/passive", "--current-app", "C:\\VRCNT\\VRCNT.exe", "--current-app-arg", "--resume"]);

        var exitCode = await new SetupCommandDispatcher(operations).DispatchAsync(options, default);

        Assert.Equal(0, exitCode);
        Assert.Equal(new[] { "runtime", "handoff" }, operations.Calls);
        Assert.True(operations.ReceivedOptions!.IsPassive);
        Assert.Equal(["--resume"], operations.ReceivedOptions.CurrentAppArguments);
    }

    [Fact]
    public async Task Command_dispatcher_defers_current_app_handoff_to_the_out_of_process_repair_worker()
    {
        var operations = new RecordingSetupOperations();
        var options = SetupCommandLine.Parse(["--repair-manager", "--current-app", "C:\\VRCNT\\VRCNT.exe"]);

        var exitCode = await new SetupCommandDispatcher(operations).DispatchAsync(options, default);

        Assert.Equal(0, exitCode);
        Assert.Equal(["repair-manager"], operations.Calls);
    }

    [Fact]
    public async Task Command_dispatcher_hands_off_the_current_app_from_the_repair_worker()
    {
        var operations = new RecordingSetupOperations();
        var options = SetupCommandLine.Parse(["--repair-manager", "--manager-repair-worker", "--current-app", "C:\\VRCNT\\VRCNT.exe"]);

        var exitCode = await new SetupCommandDispatcher(operations).DispatchAsync(options, default);

        Assert.Equal(0, exitCode);
        Assert.Equal(["repair-manager", "handoff"], operations.Calls);
    }

    [Fact]
    public async Task Production_manager_repair_source_rejects_file_metadata_sources_before_network_access()
    {
        var source = new HttpManagerRepairSource(
            ManagerCapabilities.Current,
            new ThrowingManifestLoader(),
            new FixedSignatureVerifier(true),
            new Uri("https://github.com/awakenginexe/VRCNT/releases/latest/download/"),
            Path.Combine(_root, "VRCNTInstaller"));

        await Assert.ThrowsAsync<InvalidDataException>(() => source.AcquireAsync(new Uri("file:///tmp/latest.json"), default));
    }

    [Fact]
    public async Task Production_manager_repair_source_stages_downloads_below_the_manager_directory()
    {
        var managerDirectory = Path.Combine(_root, "VRCNTInstaller");
        var releaseEndpoint = new Uri("https://example.test/releases/");
        var bootstrapperBytes = Encoding.UTF8.GetBytes("new-manager");
        var manifest = CreateManifest(managerBytes: "new-manager");
        var latest = JsonSerializer.Serialize(new
        {
            version = "5.15.0",
            platforms = new Dictionary<string, object>
            {
                ["windows-x86_64"] = new
                {
                    url = "https://example.test/releases/VRCNT.Setup.exe",
                    signature = "signature",
                },
            },
        });
        var http = new HttpClient(new FixtureHttpHandler(new Dictionary<string, byte[]>
        {
            ["https://example.test/releases/latest.json"] = Encoding.UTF8.GetBytes(latest),
            ["https://example.test/releases/package-manifest.json"] = Encoding.UTF8.GetBytes("manifest"),
            ["https://example.test/releases/package-manifest.json.sig"] = Encoding.UTF8.GetBytes("manifest-signature"),
            ["https://example.test/releases/VRCNT.Setup.exe"] = bootstrapperBytes,
        }));
        var source = new HttpManagerRepairSource(
            ManagerCapabilities.Current,
            new FixedManifestLoader(manifest),
            new FixedSignatureVerifier(true),
            releaseEndpoint,
            managerDirectory,
            http);

        var update = await source.AcquireAsync(new Uri("https://example.test/releases/latest.json"), default);

        Assert.StartsWith(Path.GetFullPath(managerDirectory), Path.GetFullPath(update.SetupPath), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(Path.Combine(Path.GetTempPath(), "VRCNTInstaller"), update.SetupPath, StringComparison.OrdinalIgnoreCase);
        Assert.Equal("new-manager", await File.ReadAllTextAsync(update.SetupPath));
    }

    [Fact]
    public async Task Handoff_requires_real_verification_and_exit_callbacks()
    {
        var managerPath = WriteFile(Path.Combine("VRCNTInstaller", "VRCNT.Setup.exe"), "old-manager");
        var candidatePath = WriteFile(Path.Combine("VRCNTInstaller", "repair", "VRCNT.Setup.exe"), "new-manager");

        Assert.Throws<ArgumentNullException>(() => new ManagerHandoff(managerPath, null!, (_, _) => Task.FromResult(new ManagerSelfCheckResult(true, true, null)), _ => Task.CompletedTask));
        Assert.Throws<ArgumentNullException>(() => new ManagerHandoff(managerPath, (_, _) => Task.FromResult(new ManagerSelfCheckResult(true, true, null)), null!, _ => Task.CompletedTask));
        Assert.Throws<ArgumentNullException>(() => new ManagerHandoff(managerPath, (_, _) => Task.FromResult(new ManagerSelfCheckResult(true, true, null)), (_, _) => Task.FromResult(new ManagerSelfCheckResult(true, true, null)), null!));

        Assert.False(string.IsNullOrWhiteSpace(candidatePath));
    }

    [Fact]
    public async Task Public_lifecycle_promotion_rejects_a_version_matching_but_unsigned_candidate()
    {
        var managerPath = WriteFile(Path.Combine("VRCNTInstaller", "VRCNT.Setup.exe"), "old-manager");
        var candidatePath = WriteFile(Path.Combine("VRCNTInstaller", "repair", "VRCNT.Setup.exe"), "new-manager");
        var lifecycle = CreateLifecycle(managerPath, CreateManifest(), CreateStateStore(managerPath), new FixedRepairSource(candidatePath));

        await Assert.ThrowsAsync<ManagerHandoffException>(() => lifecycle.PromoteAsync(candidatePath, default));

        Assert.Equal("old-manager", await File.ReadAllTextAsync(managerPath));
        Assert.Equal("new-manager", await File.ReadAllTextAsync(candidatePath));
    }

    [Fact]
    public async Task Repair_rejects_forged_matching_metadata_when_signature_path_is_null()
    {
        var managerPath = WriteFile(Path.Combine("VRCNTInstaller", "VRCNT.Setup.exe"), "old-manager");
        var candidatePath = WriteFile(Path.Combine("VRCNTInstaller", "repair", "VRCNT.Setup.exe"), "new-manager");
        var source = new FixedUpdateSource(new VerifiedManagerUpdate(candidatePath, null!));
        var lifecycle = CreateLifecycle(managerPath, CreateManifest(managerBytes: "new-manager"), CreateStateStore(managerPath), source);

        var result = await lifecycle.RepairAsync(new Uri("https://example.test/latest.json"), default);

        Assert.False(result.Succeeded);
        Assert.Equal("manager_signature_missing", result.FailureCode);
        Assert.Equal("old-manager", await File.ReadAllTextAsync(managerPath));
    }

    [Fact]
    public void Published_layout_requires_and_copies_both_authenticated_tool_inputs_for_a_worker()
    {
        var source = Path.Combine(_root, "published");
        var worker = Path.Combine(_root, "VRCNTInstaller", "repair", "worker");
        WriteFile(Path.Combine("published", "minisign.exe"), "verified-minisign");
        WriteFile(Path.Combine("published", "7za.exe"), "verified-7za");

        var layout = SetupToolLayout.CreateTestFixture(source);
        SetupToolLayout.CopyToWorkerForTest(layout, worker);

        Assert.Equal("verified-minisign", File.ReadAllText(Path.Combine(worker, "minisign.exe")));
        Assert.Equal("verified-7za", File.ReadAllText(Path.Combine(worker, "7za.exe")));
    }

    [Fact]
    public void Production_tool_layout_rejects_a_tampered_source_before_copy()
    {
        var source = Path.Combine(_root, "tampered-published");
        WriteFile(Path.Combine("tampered-published", "minisign.exe"), "tampered-minisign");
        WriteFile(Path.Combine("tampered-published", "7za.exe"), "tampered-7za");

        Assert.Throws<CryptographicException>(() => SetupToolLayout.Require(source));
        Assert.Throws<CryptographicException>(() => SetupToolLayout.CopyToWorker(
            new SetupToolLayout(Path.Combine(source, "minisign.exe"), Path.Combine(source, "7za.exe")),
            Path.Combine(_root, "tampered-worker")));
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
            repairSource ?? new FixedRepairSource(WriteFile(Path.Combine("VRCNTInstaller", "repair", "default.exe"), "new-manager")),
            handoff ?? new ManagerHandoff(
                managerPath,
                (_, _) => Task.FromResult(new ManagerSelfCheckResult(true, true, null)),
                (_, _) => Task.FromResult(new ManagerSelfCheckResult(true, true, null)),
                _ => Task.CompletedTask));

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

    private static Task PromoteCandidateAsync(ManagerHandoff handoff, string candidatePath) => handoff.PromoteAsync(
        new VerifiedManagerArtifact(
            candidatePath,
            new BootstrapperMetadata("VRCNT.Setup.exe", Encoding.UTF8.GetByteCount("new-manager"), Hash("new-manager"), 1, 1, 1, 1),
            candidatePath + ".sig",
            new ManagerSelfCheck(ManagerCapabilities.Current, new FixedSignatureVerifier(true))),
        default);

    private sealed class FixedRepairSource(string candidatePath) : IManagerRepairSource
    {
        public Task<VerifiedManagerUpdate> AcquireAsync(Uri latestJsonUri, CancellationToken cancellationToken) =>
            Task.FromResult(new VerifiedManagerUpdate(candidatePath, candidatePath + ".sig"));
    }

    private sealed class FixedUpdateSource(VerifiedManagerUpdate update) : IManagerRepairSource
    {
        public Task<VerifiedManagerUpdate> AcquireAsync(Uri latestJsonUri, CancellationToken cancellationToken) => Task.FromResult(update);
    }

    private sealed class FixedSignatureVerifier(bool succeeds) : ISetupSignatureVerifier
    {
        public Task VerifyAsync(string setupPath, string signaturePath, CancellationToken cancellationToken) =>
            succeeds ? Task.CompletedTask : Task.FromException(new CryptographicException("invalid setup signature"));
    }

    private sealed class RecordingSetupOperations : ISetupCommandOperations
    {
        public List<string> Calls { get; } = [];
        public SetupCommandLineOptions? ReceivedOptions { get; private set; }

        public Task ExecuteRuntimeAsync(SetupCommandLineOptions options, IProgress<InstallProgress>? progress, CancellationToken cancellationToken)
        {
            Calls.Add("runtime");
            ReceivedOptions = options;
            return Task.CompletedTask;
        }

        public Task ExecuteRepairManagerAsync(SetupCommandLineOptions options, CancellationToken cancellationToken)
        {
            Calls.Add("repair-manager");
            ReceivedOptions = options;
            return Task.CompletedTask;
        }

        public Task HandoffToCurrentAppAsync(SetupCommandLineOptions options, CancellationToken cancellationToken)
        {
            Calls.Add("handoff");
            return Task.CompletedTask;
        }
    }

    private sealed class ThrowingManifestLoader : VRCNT.RuntimeCore.Manifest.IManifestLoader
    {
        public Task<VRCNT.RuntimeCore.Manifest.VerifiedManifest> LoadAndVerifyAsync(string manifestPath, string signaturePath, string expectedVersion, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("network access should not occur");
    }

    private sealed class FixedManifestLoader(PackageManifest manifest) : VRCNT.RuntimeCore.Manifest.IManifestLoader
    {
        public Task<VRCNT.RuntimeCore.Manifest.VerifiedManifest> LoadAndVerifyAsync(string manifestPath, string signaturePath, string expectedVersion, CancellationToken cancellationToken) =>
            Task.FromResult(new VRCNT.RuntimeCore.Manifest.VerifiedManifest(manifest, manifestPath));
    }

    private sealed class FixtureHttpHandler(IReadOnlyDictionary<string, byte[]> responses) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (!responses.TryGetValue(request.RequestUri!.ToString(), out var bytes))
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound) { RequestMessage = request });
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                RequestMessage = request,
                Content = new ByteArrayContent(bytes),
            });
        }
    }
}
