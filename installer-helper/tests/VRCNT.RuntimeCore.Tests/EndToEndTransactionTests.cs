using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using VRCNT.RuntimeCore.Archive;
using VRCNT.RuntimeCore.Filesystem;
using VRCNT.RuntimeCore.Models;
using VRCNT.RuntimeCore.Paths;
using VRCNT.RuntimeCore.Process;
using VRCNT.RuntimeCore.Storage;
using VRCNT.RuntimeCore.Transactions;
using Xunit;

namespace VRCNT.RuntimeCore.Tests;

public sealed class EndToEndTransactionTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));

    [Theory]
    [InlineData(RuntimeVariant.Cpu)]
    [InlineData(RuntimeVariant.Cuda)]
    public async Task Fresh_install_activates_the_selected_variant_and_commits_only_after_health(RuntimeVariant variant)
    {
        var request = CreateRequest("fresh", variant);
        var state = new RecordingStateTransition();
        var progress = new RecordingProgress();
        var engine = CreateEngine(state: state, progressVariant: variant);

        var result = await engine.ExecuteAsync(request, progress, default);

        Assert.True(result.Succeeded);
        Assert.Equal("new-app", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
        Assert.Equal(request.ExpectedIdentity, state.ActiveIdentity);
        Assert.Equal(
            [TransactionPhase.Preflight, TransactionPhase.Acquire, TransactionPhase.Verify, TransactionPhase.Stage,
                TransactionPhase.Quiesce, TransactionPhase.Replace, TransactionPhase.Activate, TransactionPhase.Commit,
                TransactionPhase.Cleanup],
            progress.Phases);
        Assert.False(Directory.Exists(Path.Combine(Path.GetDirectoryName(request.InstallPath)!, ".vrcnt-transactions")));
    }

    [Theory]
    [InlineData(RuntimeVariant.Cpu, RuntimeVariant.Cuda)]
    [InlineData(RuntimeVariant.Cuda, RuntimeVariant.Cpu)]
    public async Task Runtime_switch_replaces_only_the_runtime_and_preserves_external_user_data(RuntimeVariant currentVariant, RuntimeVariant targetVariant)
    {
        var request = CreateRequest("switch", targetVariant) with
        {
            ShutdownHandoff = new RuntimeShutdownHandoff(
                "switch-nonce",
                "switch-token",
                "switch-proof",
                targetVariant,
                Path.Combine(_root, "VRCNTData", "runtime-switch-status.json"),
                Path.Combine(_root, "switch", "VRCNT.exe")),
        };
        WriteExistingRuntime(request.InstallPath, currentVariant);
        var userData = Path.Combine(_root, "VRCNTData", "config.json");
        Write(userData, "user-settings");
        var processes = new RecordingProcessCoordinator();
        var state = new RecordingStateTransition();
        var engine = CreateEngine(processes: processes, state: state, progressVariant: targetVariant);

        var result = await engine.ExecuteAsync(request, null, default);

        Assert.True(result.Succeeded);
        Assert.Equal("new-app", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
        Assert.Equal("user-settings", File.ReadAllText(userData));
        Assert.Equal(targetVariant, processes.ShutdownHandoff!.TargetVariant);
        Assert.Equal(request.ExpectedIdentity, state.ActiveIdentity);
        Assert.False(Directory.Exists(Path.Combine(Path.GetDirectoryName(request.InstallPath)!, ".vrcnt-transactions")));
    }

    [Fact]
    public async Task Failed_standalone_activation_restores_the_old_runtime_without_relaunching_it()
    {
        var request = CreateRequest("activation-failure", RuntimeVariant.Cuda);
        WriteExistingRuntime(request.InstallPath, RuntimeVariant.Cpu);
        var userData = Path.Combine(_root, "VRCNTData", "presets.json");
        Write(userData, "presets");
        var processes = new RecordingProcessCoordinator();
        var state = new RecordingStateTransition();
        var engine = CreateEngine(processes: processes, state: state, health: new FixedHealthMonitor(false), progressVariant: RuntimeVariant.Cuda);

        var result = await engine.ExecuteAsync(request, null, default);

        Assert.False(result.Succeeded);
        Assert.True(result.RolledBack);
        Assert.Equal("old-cpu", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
        Assert.Equal("presets", File.ReadAllText(userData));
        Assert.False(processes.RelaunchCalled);
        Assert.Null(state.ActiveIdentity);
    }

    [Fact]
    public async Task Cancellation_before_quiesce_exits_without_mutating_the_active_runtime()
    {
        using var cancellation = new CancellationTokenSource();
        var request = CreateRequest("cancel-before", RuntimeVariant.Cuda);
        WriteExistingRuntime(request.InstallPath, RuntimeVariant.Cpu);
        var processes = new RecordingProcessCoordinator();
        var engine = CreateEngine(
            processes: processes,
            acquirer: new CallbackAcquirer(cancellation.Cancel),
            state: new RecordingStateTransition());

        var result = await engine.ExecuteAsync(request, null, cancellation.Token);

        Assert.False(result.Succeeded);
        Assert.Equal("cancelled", result.ErrorCode);
        Assert.False(result.RolledBack);
        Assert.Equal("old-cpu", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
        Assert.False(processes.RelaunchCalled);
    }

    [Fact]
    public async Task Cancellation_after_standalone_replacement_rolls_back_without_relaunching_the_old_runtime()
    {
        using var cancellation = new CancellationTokenSource();
        var request = CreateRequest("cancel-replace", RuntimeVariant.Cuda);
        WriteExistingRuntime(request.InstallPath, RuntimeVariant.Cpu);
        var processes = new RecordingProcessCoordinator();
        var mover = new CallbackMover((_, destination) =>
        {
            if (string.Equals(Path.GetFullPath(destination), Path.GetFullPath(request.InstallPath), StringComparison.OrdinalIgnoreCase))
                cancellation.Cancel();
        });
        var engine = CreateEngine(processes: processes, mover: mover, state: new RecordingStateTransition(), progressVariant: RuntimeVariant.Cuda);

        var result = await engine.ExecuteAsync(request, null, cancellation.Token);

        Assert.False(result.Succeeded);
        Assert.True(result.RolledBack);
        Assert.Equal("cancelled", result.ErrorCode);
        Assert.Equal("old-cpu", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
        Assert.False(processes.RelaunchCalled);
    }

    [Fact]
    public async Task Corrupt_archive_fails_closed_before_the_active_runtime_is_touched()
    {
        var request = CreateRequest("corrupt", RuntimeVariant.Cpu);
        WriteExistingRuntime(request.InstallPath, RuntimeVariant.Cpu);
        var processes = new RecordingProcessCoordinator();
        var engine = CreateEngine(
            processes: processes,
            extractor: new FixtureExtractor(RuntimeVariant.Cpu, new InvalidDataException("archive test failed")),
            state: new RecordingStateTransition());

        var result = await engine.ExecuteAsync(request, null, default);

        Assert.False(result.Succeeded);
        Assert.False(result.RolledBack);
        Assert.Equal("old-cpu", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
        Assert.False(processes.LaunchCalled);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    private RuntimeTransactionEngine CreateEngine(
        IRuntimeArchiveAcquirer? acquirer = null,
        FixtureExtractor? extractor = null,
        RecordingProcessCoordinator? processes = null,
        IRuntimeDirectoryMover? mover = null,
        IRuntimeActivationHealthMonitor? health = null,
        RecordingStateTransition? state = null,
        RuntimeVariant progressVariant = RuntimeVariant.Cpu) => new(
            acquirer ?? new CallbackAcquirer(),
            extractor ?? new FixtureExtractor(progressVariant),
            new RuntimePathValidator(new FixedVolumeProbe()),
            new RequiredSpaceCalculator(new FixedSpaceProbe(long.MaxValue)),
            processes ?? new RecordingProcessCoordinator(),
            health ?? new FixedHealthMonitor(true),
            new TransactionJournalStore(),
            mover ?? new CallbackMover(),
            state ?? new RecordingStateTransition(),
            onCommit: () => { },
            onPreflightValidated: () => { },
            cudaCapabilityProbe: new FixedCudaProbe());

    private RuntimeReplacementRequest CreateRequest(string name, RuntimeVariant variant)
    {
        var installPath = Path.Combine(_root, name, "runtime");
        var cache = Path.Combine(_root, name, "cache");
        Directory.CreateDirectory(cache);
        var archive = Path.Combine(cache, "runtime.7z");
        Write(archive, "archive");
        var identity = CreateIdentity(variant);
        return new RuntimeReplacementRequest(
            installPath,
            cache,
            [archive],
            1,
            identity,
            new ActivationRequest($"pipe-{Guid.NewGuid():N}", "token", "nonce"),
            false);
    }

    private static RuntimeIdentity CreateIdentity(RuntimeVariant variant)
    {
        var marker = JsonSerializer.Serialize(new
        {
            Product = "VRCNT",
            Version = "5.15.0",
            Variant = variant == RuntimeVariant.Cuda ? "Cuda" : "Cpu",
            Architecture = "x64",
            BuildIdentity = $"fixture-{variant}",
        });
        return new RuntimeIdentity(
            "VRCNT",
            "5.15.0",
            variant,
            "x64",
            $"fixture-{variant}",
            Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(marker))).ToLowerInvariant());
    }

    private static void WriteExistingRuntime(string installPath, RuntimeVariant variant)
    {
        Write(Path.Combine(installPath, "VRCNT.exe"), $"old-{variant.ToString().ToLowerInvariant()}");
        Write(Path.Combine(installPath, "VRCNT-backend.exe"), "old-backend");
    }

    private static void Write(string path, string content)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
    }

    private sealed class CallbackAcquirer(Action? callback = null) : IRuntimeArchiveAcquirer
    {
        public Task<IReadOnlyList<string>> AcquireAsync(RuntimeReplacementRequest request, CancellationToken cancellationToken)
        {
            callback?.Invoke();
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(request.ArchiveParts);
        }
    }

    private sealed class FixtureExtractor(RuntimeVariant variant, Exception? testFailure = null) : IArchiveExtractor
    {
        public Task<IReadOnlyList<string>> ListEntriesAsync(IReadOnlyList<string> archiveParts, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<string>>(["VRCNT.exe", "VRCNT-backend.exe", "VRCNT.runtime.json"]);

        public Task TestAsync(IReadOnlyList<string> archiveParts, CancellationToken cancellationToken) =>
            testFailure is null ? Task.CompletedTask : Task.FromException(testFailure);

        public Task ExtractAsync(IReadOnlyList<string> archiveParts, string destination, CancellationToken cancellationToken)
        {
            Directory.CreateDirectory(destination);
            Write(Path.Combine(destination, "VRCNT.exe"), "new-app");
            Write(Path.Combine(destination, "VRCNT-backend.exe"), "new-backend");
            Write(Path.Combine(destination, "VRCNT.runtime.json"), JsonSerializer.Serialize(new
            {
                Product = "VRCNT",
                Version = "5.15.0",
                Variant = variant == RuntimeVariant.Cuda ? "Cuda" : "Cpu",
                Architecture = "x64",
                BuildIdentity = $"fixture-{variant}",
            }));
            return Task.CompletedTask;
        }
    }

    private sealed class RecordingProcessCoordinator : IRuntimeProcessCoordinator, IRuntimeSwitchProcessCoordinator
    {
        public RuntimeShutdownHandoff? ShutdownHandoff { get; private set; }
        public bool RelaunchCalled { get; private set; }
        public bool LaunchCalled { get; private set; }
        public Task<ProcessStopResult> RequestGracefulStopAsync(CancellationToken cancellationToken) =>
            Task.FromResult(new ProcessStopResult(true, [], false, null));

        public Task<ProcessStopResult> RequestGracefulStopAsync(RuntimeShutdownHandoff handoff, CancellationToken cancellationToken)
        {
            ShutdownHandoff = handoff;
            return RequestGracefulStopAsync(cancellationToken);
        }

        public Task<bool> AreKnownProcessesStoppedAsync(CancellationToken cancellationToken) => Task.FromResult(true);

        public Task LaunchForActivationAsync(string installPath, RuntimeIdentity expectedIdentity, ActivationRequest request, CancellationToken cancellationToken)
        {
            LaunchCalled = true;
            return Task.CompletedTask;
        }

        public Task RelaunchActiveRuntimeAsync(CancellationToken cancellationToken)
        {
            RelaunchCalled = true;
            return Task.CompletedTask;
        }
    }

    private sealed class FixedHealthMonitor(bool ready) : IRuntimeActivationHealthMonitor
    {
        public Task<RuntimeActivationHealthResult> WaitForReadyAsync(string installPath, RuntimeIdentity expectedIdentity, ActivationRequest request, CancellationToken cancellationToken) =>
            Task.FromResult(new RuntimeActivationHealthResult(ready, false, ready ? null : "activation_unhealthy"));
    }

    private sealed class FixedCudaProbe : VRCNT.RuntimeCore.Hardware.ICudaCapabilityProbe
    {
        public Task<VRCNT.RuntimeCore.Hardware.CapabilityProbeResult> ProbeAsync(string stagedInstallPath, CancellationToken cancellationToken) =>
            Task.FromResult(new VRCNT.RuntimeCore.Hardware.CapabilityProbeResult(true, true, null, null));
    }

    private sealed class RecordingStateTransition : IRuntimeStateTransition
    {
        public RuntimeIdentity? ActiveIdentity { get; private set; }
        public void ValidateExistingRuntime(string installPath) { }
        public void WriteActiveRuntime(string installPath, RuntimeIdentity identity) => ActiveIdentity = identity;
    }

    private sealed class CallbackMover(Action<string, string>? callback = null) : IRuntimeDirectoryMover
    {
        public void Move(string source, string destination)
        {
            Directory.Move(source, destination);
            callback?.Invoke(source, destination);
        }
    }

    private sealed class FixedVolumeProbe : IVolumeIdentityProbe
    {
        public string GetVolumeIdentity(string path) => "fixture-volume";
    }

    private sealed class FixedSpaceProbe(long availableBytes) : IAvailableSpaceProbe
    {
        public long GetAvailableBytes(string path) => availableBytes;
    }

    private sealed class RecordingProgress : IProgress<InstallProgress>
    {
        public List<TransactionPhase> Phases { get; } = [];
        public void Report(InstallProgress value) => Phases.Add(value.Phase);
    }
}
