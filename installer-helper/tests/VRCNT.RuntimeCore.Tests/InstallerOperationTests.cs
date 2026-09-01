using System.Text.Json;
using VRCNT.RuntimeCore.Manager;
using VRCNT.RuntimeCore.Models;
using VRCNT.RuntimeCore.Paths;
using VRCNT.RuntimeCore.State;
using VRCNT.Setup;
using VRCNT.Setup.CommandLine;
using Xunit;

namespace VRCNT.RuntimeCore.Tests;

public sealed class InstallerOperationTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "vrcnt-installer-operation-tests", Guid.NewGuid().ToString("N"));

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Execute_runtime_forwards_transaction_progress_and_initializes_fresh_language_in_the_canonical_data_root(bool passive)
    {
        var dataRoot = Path.Combine(_root, "VRCNTData");
        var engine = new RecordingRuntimeEngine();
        var operations = CreateOperations(engine, dataRoot);
        var progressValues = new List<InstallProgress>();
        var options = new SetupCommandLineOptions(false, passive, false, false, false, RuntimeVariant.Cpu, Path.Combine(_root, "VRCNT"), null, [], "th");

        await operations.ExecuteRuntimeAsync(options, new CollectingProgress(progressValues), default);

        Assert.Single(progressValues);
        Assert.Equal(TransactionPhase.Acquire, progressValues[0].Phase);
        Assert.Equal(250, progressValues[0].CompletedBytes);
        var config = JsonDocument.Parse(File.ReadAllText(Path.Combine(dataRoot, "config.json")));
        Assert.Equal("th", config.RootElement.GetProperty("UI_LANGUAGE").GetString());
    }

    [Fact]
    public async Task Execute_runtime_does_not_overwrite_an_existing_language_on_reinstall()
    {
        var dataRoot = Path.Combine(_root, "VRCNTData");
        Directory.CreateDirectory(dataRoot);
        File.WriteAllText(Path.Combine(dataRoot, "config.json"), "{\"UI_LANGUAGE\":\"ja\",\"FONT_FAMILY\":\"VRCNT Noto\"}");
        var operations = CreateOperations(new RecordingRuntimeEngine(), dataRoot);
        var options = new SetupCommandLineOptions(true, false, false, false, false, RuntimeVariant.Cpu, Path.Combine(_root, "VRCNT"), null, [], "th");

        await operations.ExecuteRuntimeAsync(options, null, default);

        Assert.Equal("{\"UI_LANGUAGE\":\"ja\",\"FONT_FAMILY\":\"VRCNT Noto\"}", File.ReadAllText(Path.Combine(dataRoot, "config.json")));
    }

    [Fact]
    public async Task Execute_runtime_registers_a_trusted_manager_after_a_successful_non_switch_install()
    {
        var dataRoot = Path.Combine(_root, "VRCNTData");
        var managerReadyPath = Path.Combine(_root, "manager-ready");
        var operations = CreateOperations(new RecordingRuntimeEngine(), dataRoot, new ManagerRegistrationLifecycle(managerReadyPath));
        var options = new SetupCommandLineOptions(false, false, false, false, false, RuntimeVariant.Cpu, Path.Combine(_root, "VRCNT"), null, [], "en");

        await operations.ExecuteRuntimeAsync(options, null, default);

        Assert.True(File.Exists(managerReadyPath));
    }

    [Fact]
    public async Task Execute_runtime_from_the_stable_manager_does_not_replace_its_own_running_image()
    {
        var dataRoot = Path.Combine(_root, "VRCNTData");
        var managerReadyPath = Path.Combine(_root, "manager-ready");
        var runningSetupPath = System.Diagnostics.Process.GetCurrentProcess().MainModule!.FileName!;
        var operations = CreateOperations(
            new RecordingRuntimeEngine(),
            dataRoot,
            new ManagerRegistrationLifecycle(managerReadyPath),
            runningSetupPath);
        var options = new SetupCommandLineOptions(true, true, false, false, false, RuntimeVariant.Cpu, Path.Combine(_root, "VRCNT"), null, [], "en");

        await operations.ExecuteRuntimeAsync(options, null, default);

        Assert.False(File.Exists(managerReadyPath));
    }

    [Fact]
    public async Task Execute_runtime_provides_the_authenticated_verifier_beside_a_newly_promoted_manager()
    {
        var dataRoot = Path.Combine(_root, "VRCNTData");
        var managerReadyPath = Path.Combine(_root, "manager-ready");
        var verifierReady = false;
        var operations = CreateOperations(
            new RecordingRuntimeEngine(),
            dataRoot,
            new ManagerRegistrationLifecycle(managerReadyPath),
            ensureManagerTools: () => verifierReady = true);
        var options = new SetupCommandLineOptions(false, false, false, false, false, RuntimeVariant.Cpu, Path.Combine(_root, "VRCNT"), null, [], "en");

        await operations.ExecuteRuntimeAsync(options, null, default);

        Assert.True(File.Exists(managerReadyPath));
        Assert.True(verifierReady);
    }

    [Fact]
    public async Task Execute_runtime_update_uses_the_validated_custom_runtime_state_instead_of_defaulting_to_cpu()
    {
        var customInstallPath = Path.Combine(_root, "custom", "VRCNT");
        var dataRoot = Path.Combine(_root, "VRCNTData");
        var markerPath = Path.Combine(customInstallPath, "VRCNT.runtime.json");
        Directory.CreateDirectory(customInstallPath);
        File.WriteAllText(Path.Combine(customInstallPath, "VRCNT.exe"), "app");
        File.WriteAllText(Path.Combine(customInstallPath, "VRCNT-backend.exe"), "backend");
        File.WriteAllText(markerPath, JsonSerializer.Serialize(new
        {
            Product = "VRCNT",
            Version = "5.15.0",
            Variant = RuntimeVariant.Cuda,
            Architecture = "x64",
            BuildIdentity = "cuda-build",
        }));
        Directory.CreateDirectory(dataRoot);
        File.WriteAllText(Path.Combine(dataRoot, "runtime.json"), JsonSerializer.Serialize(new
        {
            Schema = 1,
            Status = "Active",
            Product = "VRCNT",
            Version = "5.15.0",
            Variant = "Cuda",
            Architecture = "x64",
            InstallPath = customInstallPath,
            MarkerBuildIdentity = "cuda-build",
            MarkerSha256 = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(markerPath))).ToLowerInvariant(),
            UpdatedAtUtc = DateTimeOffset.UtcNow,
        }));
        var engine = new RecordingRuntimeEngine();
        var operations = CreateOperations(engine, dataRoot);

        await operations.ExecuteRuntimeAsync(new SetupCommandLineOptions(true, true, false, false, false, null, null, null, ["--resume"], null), null, default);

        Assert.True(engine.WasCalled);
        Assert.NotNull(engine.LastRequest);
        Assert.Equal(RuntimeVariant.Cuda, engine.LastRequest!.TargetVariant);
        Assert.Equal(Path.GetFullPath(customInstallPath), engine.LastRequest.InstallPath);
    }

    [Fact]
    public async Task Execute_runtime_update_rejects_missing_or_untrusted_state_without_starting_a_default_cpu_transaction()
    {
        var engine = new RecordingRuntimeEngine();
        var operations = CreateOperations(engine, Path.Combine(_root, "VRCNTData"));

        await Assert.ThrowsAsync<InvalidDataException>(() => operations.ExecuteRuntimeAsync(
            new SetupCommandLineOptions(true, true, false, false, false, null, null, null, [], null), null, default));

        Assert.False(engine.WasCalled);
    }

    [Fact]
    public async Task Execute_runtime_update_does_not_allow_a_programmatic_install_path_to_bypass_active_runtime_validation()
    {
        var engine = new RecordingRuntimeEngine();
        var operations = CreateOperations(engine, Path.Combine(_root, "VRCNTData"));

        await Assert.ThrowsAsync<InvalidDataException>(() => operations.ExecuteRuntimeAsync(
            new SetupCommandLineOptions(true, true, false, false, false, null, Path.Combine(_root, "untrusted-runtime"), null, [], null), null, default));

        Assert.False(engine.WasCalled);
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public async Task Execute_runtime_skips_initial_language_for_non_fresh_operations_when_the_canonical_config_is_absent(bool isUpdate, bool isSwitch)
    {
        var installPath = Path.Combine(_root, "VRCNT");
        var dataRoot = Path.Combine(_root, "VRCNTData");
        var operations = CreateOperations(new RecordingRuntimeEngine(), dataRoot);
        SetupCommandLineOptions options;
        if (isSwitch)
        {
            var currentAppPath = Path.Combine(installPath, "VRCNT.exe");
            var token = "switch-token";
            Directory.CreateDirectory(dataRoot);
            File.WriteAllText(Path.Combine(dataRoot, "runtime-switch-status.json"), JsonSerializer.Serialize(new
            {
                Schema = 1,
                Status = "pending",
                TargetVariant = "cuda",
                Nonce = "switch-nonce",
                TokenSha256 = RuntimeSwitchStatusStore.Hash(token),
                ProofSha256 = RuntimeSwitchStatusStore.Proof(token, "switch-nonce", "cuda", currentAppPath),
                CurrentAppPath = currentAppPath,
                InstallPath = installPath,
                ErrorCode = (string?)null,
                Message = (string?)null,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
                LeaseGeneration = 1,
            }));
            ReceiptBindingTestHelper.Write(dataRoot, "switch-nonce", "cuda", installPath, currentAppPath, token, 1, ReceiptBindingTestHelper.DefaultSecret);
            options = new SetupCommandLineOptions(isUpdate, false, true, false, false, RuntimeVariant.Cuda, installPath, currentAppPath, [], "th", token, Path.Combine(dataRoot, "runtime-switch-status.json"));
        }
        else
        {
            options = new SetupCommandLineOptions(isUpdate, false, false, false, false, RuntimeVariant.Cpu, installPath, null, [], "th");
        }

        await operations.ExecuteRuntimeAsync(options, null, default);

        Assert.False(File.Exists(Path.Combine(dataRoot, "config.json")));
    }

    [Fact]
    public async Task Execute_runtime_rejects_a_tampered_switch_handoff_without_running_the_engine_or_revoking_a_new_request()
    {
        var installPath = Path.Combine(_root, "VRCNT");
        var dataRoot = Path.Combine(_root, "VRCNTData");
        var currentAppPath = Path.Combine(installPath, "VRCNT.exe");
        var statusPath = Path.Combine(dataRoot, "runtime-switch-status.json");
        Directory.CreateDirectory(dataRoot);
        File.WriteAllText(statusPath, JsonSerializer.Serialize(new
        {
            Schema = 1,
            Status = "pending",
            TargetVariant = "cuda",
            Nonce = "switch-nonce",
            TokenSha256 = RuntimeSwitchStatusStore.Hash("real-token"),
            ProofSha256 = RuntimeSwitchStatusStore.Proof("real-token", "switch-nonce", "cuda", currentAppPath),
            CurrentAppPath = currentAppPath,
            InstallPath = installPath,
            ErrorCode = (string?)null,
            Message = (string?)null,
            UpdatedAtUtc = DateTimeOffset.UtcNow,
            LeaseGeneration = 1,
        }));
        var engine = new RecordingRuntimeEngine();
        var operations = CreateOperations(engine, dataRoot);
        var options = new SetupCommandLineOptions(false, false, true, false, false, RuntimeVariant.Cuda, installPath, currentAppPath, [], null, "wrong-token", statusPath);

        await Assert.ThrowsAsync<InvalidDataException>(() => operations.ExecuteRuntimeAsync(options, null, default));

        Assert.False(engine.WasCalled);
        Assert.Equal("pending", new RuntimeSwitchStatusStore(dataRoot, statusPath).Read().Status);
    }

    [Fact]
    public async Task A_pre_quiesce_switch_failure_is_consumed_by_the_live_owner_before_retry()
    {
        var installPath = Path.Combine(_root, "VRCNT");
        var dataRoot = Path.Combine(_root, "VRCNTData");
        var currentAppPath = Path.Combine(installPath, "VRCNT.exe");
        var statusPath = WritePendingSwitch(dataRoot, currentAppPath, "switch-nonce", "switch-token");
        var engine = new FailThenSucceedRuntimeEngine();
        var operations = CreateOperations(engine, dataRoot);
        var options = new SetupCommandLineOptions(false, false, true, false, false, RuntimeVariant.Cuda, installPath, currentAppPath, [], null, "switch-token", statusPath);

        await Assert.ThrowsAsync<InvalidOperationException>(() => operations.ExecuteRuntimeAsync(options, null, default));
        Assert.False(File.Exists(statusPath));
        Assert.True(new RuntimeSwitchStatusStore(dataRoot, statusPath).HasMatchingRetryClear("switch-nonce", "switch-token", "cuda", installPath, currentAppPath, 1));
        statusPath = WritePendingSwitch(dataRoot, currentAppPath, "retry-nonce", "retry-token");
        Assert.False(new RuntimeSwitchStatusStore(dataRoot, statusPath).HasMatchingRetryClear("switch-nonce", "switch-token", "cuda", installPath, currentAppPath, 1));
        options = options with { SwitchToken = "retry-token", SwitchStatusPath = statusPath };
        await operations.ExecuteRuntimeAsync(options, null, default);

        Assert.Equal(2, engine.AttemptCount);
    }

    [Fact]
    public async Task A_cancelled_pre_quiesce_switch_publishes_a_matching_retry_clear_before_removing_its_handoff()
    {
        var installPath = Path.Combine(_root, "VRCNT");
        var dataRoot = Path.Combine(_root, "VRCNTData");
        var currentAppPath = Path.Combine(installPath, "VRCNT.exe");
        var statusPath = WritePendingSwitch(dataRoot, currentAppPath, "cancel-nonce", "cancel-token");
        var operations = CreateOperations(new CancellingRuntimeEngine(), dataRoot);
        var options = new SetupCommandLineOptions(false, false, true, false, false, RuntimeVariant.Cuda, installPath, currentAppPath, [], null, "cancel-token", statusPath);

        await Assert.ThrowsAsync<OperationCanceledException>(() => operations.ExecuteRuntimeAsync(options, null, default));

        var store = new RuntimeSwitchStatusStore(dataRoot, statusPath);
        Assert.False(File.Exists(statusPath));
        Assert.True(store.HasMatchingRetryClear("cancel-nonce", "cancel-token", "cuda", installPath, currentAppPath, 1));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Execute_runtime_preserves_a_legacy_config_migrated_during_preflight(bool passive)
    {
        var installPath = Path.Combine(_root, "VRCNT");
        var dataRoot = Path.Combine(_root, "VRCNTData");
        Directory.CreateDirectory(installPath);
        File.WriteAllText(Path.Combine(installPath, "config.json"), "{\"UI_LANGUAGE\":\"ja\",\"FONT_FAMILY\":\"VRCNT Noto\"}");
        var operations = CreateOperations(new MigratingRuntimeEngine(dataRoot), dataRoot);
        var options = new SetupCommandLineOptions(false, passive, false, false, false, RuntimeVariant.Cpu, installPath, null, [], "th");

        await operations.ExecuteRuntimeAsync(options, null, default);

        Assert.Equal("{\"UI_LANGUAGE\":\"ja\",\"FONT_FAMILY\":\"VRCNT Noto\"}", File.ReadAllText(Path.Combine(dataRoot, "config.json")));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    private SetupCommandOperations CreateOperations(
        IRuntimeTransactionEngine engine,
        string dataRoot,
        IManagerLifecycle? managerLifecycle = null,
        string? managerPath = null,
        Action? ensureManagerTools = null)
    {
        var resolvedManagerPath = managerPath ?? Path.Combine(_root, "manager", "VRCNT.Setup.exe");
        return new SetupCommandOperations(
            engine,
            managerLifecycle ?? new NoopManagerLifecycle(),
            new Uri("https://example.invalid/latest.json"),
            Path.GetDirectoryName(resolvedManagerPath),
            resolvedManagerPath,
            _ => new UserDataPaths(dataRoot, Path.Combine(_root, "VRCNT-NextData"), Path.Combine(_root, "VRCNT")),
            new ActiveRuntimeLocator(resolveDataRoot: () => dataRoot),
            ensureManagerTools);
    }

    private static string WritePendingSwitch(string dataRoot, string currentAppPath, string nonce, string token)
    {
        Directory.CreateDirectory(dataRoot);
        var statusPath = Path.Combine(dataRoot, "runtime-switch-status.json");
        File.WriteAllText(statusPath, JsonSerializer.Serialize(new
        {
            Schema = 1,
            Status = "pending",
            TargetVariant = "cuda",
            Nonce = nonce,
            TokenSha256 = RuntimeSwitchStatusStore.Hash(token),
            ProofSha256 = RuntimeSwitchStatusStore.Proof(token, nonce, "cuda", currentAppPath),
            CurrentAppPath = currentAppPath,
            InstallPath = Path.GetDirectoryName(currentAppPath),
            ErrorCode = (string?)null,
            Message = (string?)null,
            UpdatedAtUtc = DateTimeOffset.UtcNow,
            LeaseGeneration = 1,
        }));
        ReceiptBindingTestHelper.Write(dataRoot, nonce, "cuda", Path.GetDirectoryName(currentAppPath)!, currentAppPath, token, 1, ReceiptBindingTestHelper.DefaultSecret);
        return statusPath;
    }

    private sealed class RecordingRuntimeEngine : IRuntimeTransactionEngine
    {
        public bool WasCalled { get; private set; }
        public RuntimeInstallRequest? LastRequest { get; private set; }

        public Task<RuntimeOperationResult> ExecuteAsync(RuntimeInstallRequest request, IProgress<InstallProgress>? progress, CancellationToken cancellationToken)
        {
            WasCalled = true;
            LastRequest = request;
            progress?.Report(new InstallProgress(TransactionPhase.Acquire, 250, 1000, "runtime.7z"));
            return Task.FromResult(new RuntimeOperationResult(true, false, false, null, null));
        }
    }

    private sealed class MigratingRuntimeEngine(string dataRoot) : IRuntimeTransactionEngine
    {
        public Task<RuntimeOperationResult> ExecuteAsync(RuntimeInstallRequest request, IProgress<InstallProgress>? progress, CancellationToken cancellationToken)
        {
            Directory.CreateDirectory(dataRoot);
            File.Copy(Path.Combine(request.InstallPath, "config.json"), Path.Combine(dataRoot, "config.json"));
            return Task.FromResult(new RuntimeOperationResult(true, false, false, null, null));
        }
    }

    private sealed class FailThenSucceedRuntimeEngine : IRuntimeTransactionEngine
    {
        public int AttemptCount { get; private set; }

        public Task<RuntimeOperationResult> ExecuteAsync(RuntimeInstallRequest request, IProgress<InstallProgress>? progress, CancellationToken cancellationToken)
        {
            AttemptCount++;
            return Task.FromResult(AttemptCount == 1
                ? new RuntimeOperationResult(false, false, false, "preflight_rejected", "Retry runtime recovery.")
                : new RuntimeOperationResult(true, false, false, null, null));
        }
    }

    private sealed class CancellingRuntimeEngine : IRuntimeTransactionEngine
    {
        public Task<RuntimeOperationResult> ExecuteAsync(RuntimeInstallRequest request, IProgress<InstallProgress>? progress, CancellationToken cancellationToken)
            => throw new OperationCanceledException(cancellationToken);
    }

    private sealed class CollectingProgress(List<InstallProgress> values) : IProgress<InstallProgress>
    {
        public void Report(InstallProgress value) => values.Add(value);
    }

    private sealed class NoopManagerLifecycle : IManagerLifecycle
    {
        public Task<ManagerSelfCheckResult> CheckAsync(CancellationToken cancellationToken) => Task.FromResult(new ManagerSelfCheckResult(true, false, null));
        public Task<ManagerRepairResult> RepairAsync(Uri latestJsonUri, CancellationToken cancellationToken) => Task.FromResult(new ManagerRepairResult(true, null, null));
        public Task PromoteAsync(string verifiedSetupPath, CancellationToken cancellationToken) => Task.CompletedTask;
    }

    private sealed class ManagerRegistrationLifecycle(string readyPath) : IManagerLifecycle
    {
        public Task<ManagerSelfCheckResult> CheckAsync(CancellationToken cancellationToken) => Task.FromResult(new ManagerSelfCheckResult(true, true, null));
        public Task<ManagerRepairResult> RepairAsync(Uri latestJsonUri, CancellationToken cancellationToken) => Task.FromResult(new ManagerRepairResult(true, null, null));
        public Task PromoteAsync(string verifiedSetupPath, CancellationToken cancellationToken)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(readyPath)!);
            File.WriteAllText(readyPath, "registered");
            return Task.CompletedTask;
        }
    }
}
