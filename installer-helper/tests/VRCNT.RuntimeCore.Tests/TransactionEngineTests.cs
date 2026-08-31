using System.Security.Cryptography;
using System.Diagnostics;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using VRCNT.RuntimeCore.Archive;
using VRCNT.RuntimeCore.Filesystem;
using VRCNT.RuntimeCore.Manager;
using VRCNT.RuntimeCore.Models;
using VRCNT.RuntimeCore.Process;
using VRCNT.RuntimeCore.Storage;
using VRCNT.RuntimeCore.Transactions;
using Xunit;

namespace VRCNT.RuntimeCore.Tests;

public sealed class TransactionEngineTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task ExecuteAsync_uses_a_transaction_beside_a_custom_installation_on_its_target_volume()
    {
        var probe = new RecordingVolumeProbe("custom-volume");
        var engine = CreateEngine(probe: probe);
        var request = CreateRequest("custom", "runtime");

        var result = await engine.ExecuteAsync(request, null, default);

        Assert.True(result.Succeeded);
        Assert.Equal("new-app", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
        Assert.NotEmpty(probe.Paths);
        Assert.All(probe.Paths, path => Assert.StartsWith(Path.GetDirectoryName(request.InstallPath)!, Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task ExecuteAsync_uses_the_authenticated_switch_shutdown_handoff_before_replacement()
    {
        var processes = new TestProcessCoordinator(new(true, [], false, null));
        var currentAppPath = Path.Combine(_root, "VRCNT", "VRCNT.exe");
        var request = CreateRequest("switch-handoff", "runtime") with
        {
            ShutdownHandoff = new RuntimeShutdownHandoff("nonce", "token", RuntimeSwitchStatusStore.Proof("token", "nonce", "cuda", currentAppPath), RuntimeVariant.Cuda, Path.Combine(_root, "VRCNTData", "runtime-switch-status.json"), currentAppPath),
        };

        var result = await CreateEngine(processes: processes).ExecuteAsync(request, null, default);

        Assert.True(result.Succeeded);
        Assert.NotNull(processes.SwitchHandoff);
    }

    [Fact]
    public async Task ExecuteAsync_relaunches_the_active_runtime_after_a_switch_handoff_cancellation()
    {
        var request = CreateRequest("switch-cancel", "runtime") with { ShutdownHandoff = CreateSwitchHandoff(Path.Combine(_root, "switch-cancel", "runtime")) };
        WriteActiveRuntime(request);
        using var cancellation = new CancellationTokenSource();
        var processes = new TestProcessCoordinator(new(true, [], false, null), onStop: cancellation.Cancel);

        var result = await CreateEngine(processes: processes).ExecuteAsync(request, null, cancellation.Token);

        Assert.False(result.Succeeded);
        Assert.Equal("cancelled", result.ErrorCode);
        Assert.True(processes.RelaunchCalled);
    }

    [Fact]
    public async Task ExecuteAsync_keeps_the_active_runtime_running_when_a_switch_handoff_cannot_quiesce()
    {
        var request = CreateRequest("switch-failure", "runtime") with { ShutdownHandoff = CreateSwitchHandoff(Path.Combine(_root, "switch-failure", "runtime")) };
        WriteActiveRuntime(request);
        var processes = new TestProcessCoordinator(new(false, [123], true, "processes_running"));

        var result = await CreateEngine(processes: processes).ExecuteAsync(request, null, default);

        Assert.False(result.Succeeded);
        Assert.Equal("processes_running", result.ErrorCode);
        Assert.False(processes.RelaunchCalled);
    }

    [Fact]
    public async Task ExecuteAsync_relaunches_the_old_runtime_when_a_process_lock_remains_after_authenticated_shutdown()
    {
        var request = CreateRequest("switch-acknowledged-lock", "runtime") with { ShutdownHandoff = CreateSwitchHandoff(Path.Combine(_root, "switch-acknowledged-lock", "runtime")) };
        WriteActiveRuntime(request);
        WriteAcknowledgedShutdown(request.ShutdownHandoff!);
        var processes = new TestProcessCoordinator(new(false, [123], true, "processes_running"));

        var result = await CreateEngine(processes: processes).ExecuteAsync(request, null, default);

        Assert.False(result.Succeeded);
        Assert.Equal("processes_running", result.ErrorCode);
        Assert.True(processes.RelaunchCalled);
    }

    [Fact]
    public async Task ExecuteAsync_rejects_cross_volume_transaction_paths_before_acquiring_or_replacing()
    {
        var acquirer = new RecordingAcquirer();
        var request = CreateRequest("cross-volume", "runtime");
        WriteActiveRuntime(request);
        var engine = CreateEngine(acquirer: acquirer, probe: new RecordingVolumeProbe(path => path.Contains(".vrcnt-transactions", StringComparison.OrdinalIgnoreCase) ? "other" : "target"));

        var result = await engine.ExecuteAsync(request, null, default);

        Assert.False(result.Succeeded);
        Assert.Equal("cross_volume", result.ErrorCode);
        Assert.False(acquirer.WasCalled);
        Assert.Equal("old-app", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
    }

    [Fact]
    public async Task ExecuteAsync_does_not_run_the_preflight_hook_when_existing_runtime_validation_fails()
    {
        var request = CreateRequest("unowned", "runtime");
        WriteActiveRuntime(request);
        var acquirer = new RecordingAcquirer();
        var preservationRan = false;
        var engine = CreateEngine(
            acquirer: acquirer,
            stateTransition: new RejectingStateTransition(),
            onPreflightValidated: () => preservationRan = true);

        var result = await engine.ExecuteAsync(request, null, default);

        Assert.False(result.Succeeded);
        Assert.False(preservationRan);
        Assert.False(acquirer.WasCalled);
        Assert.Equal("old-app", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
    }

    [Fact]
    public void GetTransactionContainer_rejects_an_install_path_beneath_a_reparse_point()
    {
        if (!OperatingSystem.IsWindows()) return;

        var physicalParent = Path.Combine(_root, "physical-parent");
        var junction = Path.Combine(_root, "junction-parent");
        Directory.CreateDirectory(physicalParent);
        var commandStart = new ProcessStartInfo("cmd.exe")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        commandStart.ArgumentList.Add("/d");
        commandStart.ArgumentList.Add("/c");
        commandStart.ArgumentList.Add($"mklink /J \"{junction}\" \"{physicalParent}\"");
        using var command = System.Diagnostics.Process.Start(commandStart) ?? throw new InvalidOperationException("Unable to create a test junction.");
        command.WaitForExit();
        if (command.ExitCode != 0) return;

        var validator = new RuntimePathValidator(new RecordingVolumeProbe("same"));

        Assert.Throws<InvalidDataException>(() => validator.GetTransactionContainer(Path.Combine(junction, "runtime")));
    }

    [Fact]
    public async Task ExecuteAsync_rejects_insufficient_target_volume_space_before_extraction()
    {
        var extractor = new TestExtractor();
        var request = CreateRequest("space", "runtime") with { InstalledSize = 4_096 };
        var engine = CreateEngine(extractor: extractor, space: new FixedSpaceProbe(1));

        var result = await engine.ExecuteAsync(request, null, default);

        Assert.False(result.Succeeded);
        Assert.Equal("insufficient_space", result.ErrorCode);
        Assert.False(extractor.Extracted);
    }

    [Fact]
    public async Task ExecuteAsync_rejects_archive_traversal_before_live_runtime_is_touched()
    {
        var request = CreateRequest("traversal", "runtime");
        WriteActiveRuntime(request);
        var extractor = new TestExtractor(entries: ["VRCNT.exe", "../escape.txt"]);
        var engine = CreateEngine(extractor: extractor);

        var result = await engine.ExecuteAsync(request, null, default);

        Assert.False(result.Succeeded);
        Assert.Equal("unsafe_archive", result.ErrorCode);
        Assert.False(extractor.Extracted);
        Assert.Equal("old-app", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
    }

    [Fact]
    public async Task ExecuteAsync_extracts_only_to_the_staging_directory_never_the_live_runtime()
    {
        var request = CreateRequest("stage", "runtime");
        var extractor = new TestExtractor();
        var engine = CreateEngine(extractor: extractor);

        var result = await engine.ExecuteAsync(request, null, default);

        Assert.True(result.Succeeded);
        Assert.NotNull(extractor.ExtractionDestination);
        Assert.NotEqual(Path.GetFullPath(request.InstallPath), Path.GetFullPath(extractor.ExtractionDestination!), StringComparer.OrdinalIgnoreCase);
        Assert.Contains(".vrcnt-transactions", extractor.ExtractionDestination!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ExecuteAsync_refuses_process_lock_without_confirmed_targeted_force_close()
    {
        var request = CreateRequest("locked", "runtime");
        WriteActiveRuntime(request);
        var processes = new TestProcessCoordinator(new(false, [123], true, null));
        var engine = CreateEngine(processes: processes);

        var result = await engine.ExecuteAsync(request, null, default);

        Assert.False(result.Succeeded);
        Assert.Equal("processes_running", result.ErrorCode);
        Assert.False(processes.ForceCloseCalled);
        Assert.Equal("old-app", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
    }

    [Fact]
    public async Task ExecuteAsync_refuses_a_restarted_scoped_process_before_the_first_destructive_move()
    {
        var request = CreateRequest("late-process", "runtime");
        WriteActiveRuntime(request);
        var processes = new TestProcessCoordinator(new(true, [], false, null), knownProcessesStopped: false);
        var mover = new CallbackMover();
        var engine = CreateEngine(processes: processes, mover: mover);

        var result = await engine.ExecuteAsync(request, null, default);

        Assert.False(result.Succeeded);
        Assert.False(result.RolledBack);
        Assert.Equal("processes_running", result.ErrorCode);
        Assert.Equal("old-app", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
        Assert.Empty(mover.Moves);
        Assert.False(processes.RelaunchCalled);
    }

    [Fact]
    public async Task ExecuteAsync_rolls_back_the_active_runtime_when_the_staged_move_fails()
    {
        var request = CreateRequest("move-failure", "runtime");
        WriteActiveRuntime(request);
        var engine = CreateEngine(mover: new ThrowingMover(failDestination: request.InstallPath));

        var result = await engine.ExecuteAsync(request, null, default);

        Assert.False(result.Succeeded);
        Assert.True(result.RolledBack);
        Assert.Equal("old-app", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
    }

    [Fact]
    public async Task RecoverPendingAsync_restores_the_backup_after_simulated_termination_during_replace()
    {
        var request = CreateRequest("recovery", "runtime");
        WriteActiveRuntime(request);
        var paths = RuntimeTransactionPaths.For(request.InstallPath, "terminated");
        Directory.CreateDirectory(Path.GetDirectoryName(paths.BackupPath)!);
        Directory.Move(request.InstallPath, paths.BackupPath);
        Directory.CreateDirectory(paths.StagingPath);
        File.WriteAllText(Path.Combine(paths.StagingPath, "VRCNT.exe"), "new-app");
        new TransactionJournalStore().WriteAtomic(paths.JournalPath, new RuntimeTransactionJournal(
            "terminated", TransactionPhase.Replace, request.InstallPath, paths.StagingPath, paths.BackupPath,
            request.ExpectedIdentity, true, true, false, false));
        var engine = CreateEngine();

        var result = await engine.RecoverPendingAsync(request.InstallPath, default);

        Assert.True(result.Succeeded);
        Assert.Equal("old-app", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
        Assert.False(File.Exists(paths.JournalPath));
    }

    [Fact]
    public async Task RecoverPendingAsync_restores_the_backup_when_the_durable_move_intent_precedes_a_crash()
    {
        var request = CreateRequest("intent-recovery", "runtime");
        WriteActiveRuntime(request);
        var paths = RuntimeTransactionPaths.For(request.InstallPath, "intent-crash");
        Directory.CreateDirectory(Path.GetDirectoryName(paths.BackupPath)!);
        new TransactionJournalStore().WriteAtomic(paths.JournalPath, new RuntimeTransactionJournal(
            "intent-crash", TransactionPhase.Replace, request.InstallPath, paths.StagingPath, paths.BackupPath,
            request.ExpectedIdentity, true, false, false, false));
        Directory.Move(request.InstallPath, paths.BackupPath); // termination occurs before the completion journal write
        var engine = CreateEngine();

        var result = await engine.RecoverPendingAsync(request.InstallPath, default);

        Assert.True(result.Succeeded);
        Assert.Equal("old-app", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
        Assert.False(Directory.Exists(paths.TransactionRoot));
    }

    [Fact]
    public async Task RecoverPendingAsync_preserves_an_unactivated_fresh_target_when_staged_move_intent_precedes_a_crash()
    {
        var request = CreateRequest("fresh-intent-crash", "runtime");
        var paths = RuntimeTransactionPaths.For(request.InstallPath, "fresh-intent-crash");
        Directory.CreateDirectory(paths.StagingPath);
        File.WriteAllText(Path.Combine(paths.StagingPath, "VRCNT.exe"), "new-app");
        File.WriteAllText(Path.Combine(paths.StagingPath, "VRCNT-backend.exe"), "new-backend");
        new TransactionJournalStore().WriteAtomic(paths.JournalPath, new RuntimeTransactionJournal(
            "fresh-intent-crash", TransactionPhase.Replace, request.InstallPath, paths.StagingPath, paths.BackupPath,
            request.ExpectedIdentity, false, false, true, false));
        Directory.Move(paths.StagingPath, request.InstallPath); // termination occurs before the completion journal write
        var engine = CreateEngine();

        var result = await engine.RecoverPendingAsync(request.InstallPath, default);

        Assert.False(result.Succeeded);
        Assert.True(result.RecoveryRequired);
        Assert.Equal("recovery_required", result.ErrorCode);
        Assert.Equal("new-app", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
        Assert.True(File.Exists(paths.JournalPath));
    }

    [Fact]
    public async Task ExecuteAsync_writes_the_active_runtime_state_after_health_before_backup_cleanup()
    {
        var request = CreateRequest("state-transition", "runtime");
        WriteActiveRuntime(request);
        var transactionContainer = Path.Combine(Path.GetDirectoryName(request.InstallPath)!, ".vrcnt-transactions");
        var state = new RecordingStateTransition(() => Directory.Exists(transactionContainer) && Directory.EnumerateDirectories(transactionContainer, "backup", SearchOption.AllDirectories).Any());
        var engine = CreateEngine(stateTransition: state);

        var result = await engine.ExecuteAsync(request, null, default);

        Assert.True(result.Succeeded);
        Assert.True(state.Validated);
        Assert.Equal(request.ExpectedIdentity, state.ActiveIdentity);
        Assert.True(state.BackupExistedWhenWritten);
    }

    [Theory]
    [InlineData(TransactionPhase.Acquire)]
    [InlineData(TransactionPhase.Stage)]
    public async Task ExecuteAsync_cancellation_before_quiesce_leaves_the_active_runtime_unchanged(TransactionPhase phase)
    {
        var request = CreateRequest("cancel-before", phase.ToString());
        WriteActiveRuntime(request);
        using var cancellation = new CancellationTokenSource();
        var engine = CreateEngine(acquirer: new RecordingAcquirer(onAcquire: () => { if (phase == TransactionPhase.Acquire) cancellation.Cancel(); }),
            extractor: new TestExtractor(onExtract: () => { if (phase == TransactionPhase.Stage) cancellation.Cancel(); }));

        var result = await engine.ExecuteAsync(request, null, cancellation.Token);

        Assert.False(result.Succeeded);
        Assert.Equal("cancelled", result.ErrorCode);
        Assert.Equal("old-app", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
    }

    [Theory]
    [InlineData(TransactionPhase.Quiesce)]
    [InlineData(TransactionPhase.Replace)]
    [InlineData(TransactionPhase.Activate)]
    [InlineData(TransactionPhase.Commit)]
    public async Task ExecuteAsync_defers_post_quiesce_cancellation_to_a_safe_runtime_state(TransactionPhase phase)
    {
        var request = CreateRequest("cancel-after", phase.ToString());
        WriteActiveRuntime(request);
        using var cancellation = new CancellationTokenSource();
        var processes = new TestProcessCoordinator(new(true, [], false, null), onStop: () => { if (phase == TransactionPhase.Quiesce) cancellation.Cancel(); });
        var mover = new CallbackMover((_, _) => { if (phase == TransactionPhase.Replace) cancellation.Cancel(); });
        var health = new TestHealthMonitor(onCheck: () => { if (phase == TransactionPhase.Activate) cancellation.Cancel(); });
        var engine = CreateEngine(processes: processes, mover: mover, health: health, onCommit: () => { if (phase == TransactionPhase.Commit) cancellation.Cancel(); });

        var result = await engine.ExecuteAsync(request, null, cancellation.Token);

        if (phase == TransactionPhase.Quiesce)
        {
            Assert.False(result.Succeeded);
            Assert.False(result.RolledBack);
            Assert.Equal("cancelled", result.ErrorCode);
            Assert.Equal("old-app", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
            Assert.False(processes.RelaunchCalled);
        }
        else if (phase == TransactionPhase.Replace)
        {
            Assert.False(result.Succeeded);
            Assert.True(result.RolledBack);
            Assert.Equal("cancelled", result.ErrorCode);
            Assert.Equal("old-app", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
            Assert.False(processes.RelaunchCalled);
        }
        else
        {
            Assert.True(result.Succeeded);
            Assert.Equal("new-app", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
            Assert.False(processes.RelaunchCalled);
        }
    }

    [Fact]
    public async Task ExecuteAsync_requires_health_confirmation_in_addition_to_process_launch_before_commit()
    {
        var request = CreateRequest("health", "runtime");
        WriteActiveRuntime(request);
        var processes = new TestProcessCoordinator(new(true, [], false, null));
        var engine = CreateEngine(processes: processes, health: new TestHealthMonitor(ready: false));

        var result = await engine.ExecuteAsync(request, null, default);

        Assert.False(result.Succeeded);
        Assert.True(result.RolledBack);
        Assert.True(processes.LaunchCalled);
        Assert.Equal("old-app", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
    }

    [Fact]
    public async Task ExecuteAsync_stops_a_launched_staged_runtime_before_rolling_back_a_failed_activation()
    {
        var request = CreateRequest("health", "locked-staged-runtime");
        WriteActiveRuntime(request);
        using var processes = new ActivationLockingProcessCoordinator();
        var engine = CreateEngine(processes: processes, health: new TestHealthMonitor(ready: false));

        var result = await engine.ExecuteAsync(request, null, default);

        Assert.False(result.Succeeded);
        Assert.True(result.RolledBack);
        Assert.Equal("old-app", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
        Assert.Equal(2, processes.GracefulStopRequests);
    }

    [Fact]
    public async Task ExecuteAsync_force_stops_a_launched_staged_runtime_before_rolling_back_a_failed_activation()
    {
        var request = CreateRequest("health", "force-locked-staged-runtime");
        WriteActiveRuntime(request);
        using var processes = new ActivationLockingProcessCoordinator(requiresForceClose: true);
        var engine = CreateEngine(processes: processes, health: new TestHealthMonitor(ready: false));

        var result = await engine.ExecuteAsync(request, null, default);

        Assert.False(result.Succeeded);
        Assert.True(result.RolledBack);
        Assert.Equal("old-app", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
        Assert.Equal(1, processes.ForceCloseRequests);
    }

    [Fact]
    public async Task ExecuteAsync_preserves_the_activation_failure_predicate_when_rolling_back()
    {
        var request = CreateRequest("health", "diagnostic");
        WriteActiveRuntime(request);
        var engine = CreateEngine(health: new TestHealthMonitor(
            ready: false,
            errorCode: "activation_invalid_proof_backend_path"));

        var result = await engine.ExecuteAsync(request, null, default);

        Assert.False(result.Succeeded);
        Assert.True(result.RolledBack);
        Assert.Equal("activation_invalid_proof_backend_path", result.ErrorCode);
        Assert.Equal("activation_invalid_proof_backend_path", result.ErrorMessage);
    }

    [Fact]
    public async Task ExecuteAsync_starts_the_real_pipe_listener_before_launch_and_commits_only_after_a_staged_backend_proof()
    {
        var request = CreateRequest("real-listener", "valid-proof") with
        {
            Activation = new ActivationRequest($"vrcnt-activation-{Guid.NewGuid():N}", "token", "nonce"),
        };
        WriteActiveRuntime(request);
        var processes = new ImmediateProofProcessCoordinator([ProofFor(request)]);
        var monitor = new NamedPipeRuntimeActivationHealthMonitor(
            TimeSpan.FromSeconds(2), _ => Path.Combine(request.InstallPath, "VRCNT-backend.exe"));
        var state = new RecordingStateTransition();
        var engine = CreateEngine(processes: processes, health: monitor, stateTransition: state);

        var result = await engine.ExecuteAsync(request, null, default);

        Assert.True(result.Succeeded);
        Assert.True(processes.LaunchCalled);
        Assert.Equal(request.ExpectedIdentity, state.ActiveIdentity);
        Assert.Equal("new-app", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
    }

    [Fact]
    public async Task ExecuteAsync_commits_a_standalone_install_without_launching_vrcnt()
    {
        var request = CreateRequest("standalone", "no-activation") with { Activation = null! };
        WriteActiveRuntime(request);
        var processes = new TestProcessCoordinator(new(true, [], false, null));
        var state = new RecordingStateTransition();
        var engine = CreateEngine(processes: processes, stateTransition: state);

        var result = await engine.ExecuteAsync(request, null, default);

        Assert.True(result.Succeeded);
        Assert.False(processes.LaunchCalled);
        Assert.False(processes.RelaunchCalled);
        Assert.Equal(request.ExpectedIdentity, state.ActiveIdentity);
        Assert.Equal("new-app", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
    }

    [Fact]
    public async Task ExecuteAsync_does_not_relaunch_the_old_app_when_a_standalone_install_is_cancelled_after_replacement_starts()
    {
        var request = CreateRequest("standalone", "cancelled-replace") with { Activation = null! };
        WriteActiveRuntime(request);
        using var cancellation = new CancellationTokenSource();
        var processes = new TestProcessCoordinator(new(true, [], false, null));
        var moves = new CallbackMover((_, _) => cancellation.Cancel());
        var engine = CreateEngine(processes: processes, mover: moves);

        var result = await engine.ExecuteAsync(request, null, cancellation.Token);

        Assert.False(result.Succeeded);
        Assert.True(result.RolledBack);
        Assert.Equal("cancelled", result.ErrorCode);
        Assert.False(processes.LaunchCalled);
        Assert.False(processes.RelaunchCalled);
        Assert.Equal("old-app", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
    }

    [Fact]
    public async Task ExecuteAsync_rolls_back_when_real_listener_receives_no_post_launch_proof()
    {
        var request = CreateRequest("real-listener", "launch-only") with
        {
            Activation = new ActivationRequest($"vrcnt-activation-{Guid.NewGuid():N}", "token", "nonce"),
        };
        WriteActiveRuntime(request);
        var processes = new TestProcessCoordinator(new(true, [], false, null));
        var monitor = new NamedPipeRuntimeActivationHealthMonitor(
            TimeSpan.FromMilliseconds(50), _ => Path.Combine(request.InstallPath, "VRCNT-backend.exe"));
        var engine = CreateEngine(processes: processes, health: monitor);

        var result = await engine.ExecuteAsync(request, null, default);

        Assert.False(result.Succeeded);
        Assert.True(result.RolledBack);
        Assert.True(processes.LaunchCalled);
        Assert.Equal("old-app", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
    }

    [Theory]
    [InlineData("stale")]
    [InlineData("forged")]
    [InlineData("duplicate")]
    public async Task ExecuteAsync_rejects_forged_stale_or_valid_then_valid_duplicate_actual_pipe_proofs(string proofMode)
    {
        var request = CreateRequest("real-listener", proofMode) with
        {
            Activation = new ActivationRequest($"vrcnt-activation-{Guid.NewGuid():N}", "token", "nonce"),
        };
        WriteActiveRuntime(request);
        var valid = ProofFor(request);
        var proofs = proofMode == "duplicate"
            ? new[] { valid, valid }
            : new[] { proofMode == "stale" ? valid with { Nonce = "stale-nonce" } : valid };
        var processes = new ImmediateProofProcessCoordinator(proofs);
        var monitor = new NamedPipeRuntimeActivationHealthMonitor(
            TimeSpan.FromSeconds(2), _ => proofMode == "forged"
                ? Path.Combine(request.InstallPath, "forged-client.exe")
                : Path.Combine(request.InstallPath, "VRCNT-backend.exe"));
        var engine = CreateEngine(processes: processes, health: monitor);

        var result = await engine.ExecuteAsync(request, null, default);

        Assert.False(result.Succeeded);
        Assert.True(result.RolledBack);
        Assert.Equal("old-app", File.ReadAllText(Path.Combine(request.InstallPath, "VRCNT.exe")));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    private RuntimeTransactionEngine CreateEngine(
        IRuntimeArchiveAcquirer? acquirer = null,
        TestExtractor? extractor = null,
        IVolumeIdentityProbe? probe = null,
        IAvailableSpaceProbe? space = null,
        IRuntimeProcessCoordinator? processes = null,
        IRuntimeDirectoryMover? mover = null,
        IRuntimeActivationHealthMonitor? health = null,
        Action? onCommit = null,
        IRuntimeStateTransition? stateTransition = null,
        Action? onPreflightValidated = null) => new(
            acquirer ?? new RecordingAcquirer(),
            extractor ?? new TestExtractor(),
            new RuntimePathValidator(probe ?? new RecordingVolumeProbe("same")),
            new RequiredSpaceCalculator(space ?? new FixedSpaceProbe(long.MaxValue)),
            processes ?? new TestProcessCoordinator(new(true, [], false, null)),
            health ?? new TestHealthMonitor(),
            new TransactionJournalStore(),
            mover ?? new CallbackMover(),
            stateTransition ?? new RecordingStateTransition(),
            onCommit,
            onPreflightValidated);

    private RuntimeReplacementRequest CreateRequest(params string[] segments)
    {
        var installPath = Path.Combine([_root, .. segments]);
        var cacheDirectory = Path.Combine(_root, "cache", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(cacheDirectory);
        var archive = Path.Combine(cacheDirectory, "runtime.7z");
        File.WriteAllText(archive, "archive");
        return new RuntimeReplacementRequest(installPath, cacheDirectory, [archive], 512, CreateIdentity(), new ActivationRequest("pipe", "token", "nonce"), false);
    }

    private RuntimeShutdownHandoff CreateSwitchHandoff(string installPath)
    {
        var appPath = Path.Combine(installPath, "VRCNT.exe");
        return new RuntimeShutdownHandoff(
            "nonce",
            "token",
            RuntimeSwitchStatusStore.Proof("token", "nonce", "cpu", appPath),
            RuntimeVariant.Cpu,
            Path.Combine(_root, "VRCNTData", "runtime-switch-status.json"),
            appPath);
    }

    private void WriteAcknowledgedShutdown(RuntimeShutdownHandoff handoff)
    {
        var dataRoot = Path.GetDirectoryName(handoff.StatusPath)!;
        Directory.CreateDirectory(dataRoot);
        var store = new RuntimeSwitchStatusStore(dataRoot, handoff.StatusPath);
        File.WriteAllText(handoff.StatusPath, JsonSerializer.Serialize(new
        {
            Schema = 1,
            Status = "pending",
            TargetVariant = "cpu",
            handoff.Nonce,
            TokenSha256 = RuntimeSwitchStatusStore.Hash(handoff.Token),
            ProofSha256 = handoff.Proof,
            CurrentAppPath = handoff.CurrentAppPath,
            InstallPath = Path.GetDirectoryName(handoff.CurrentAppPath),
            LeaseGeneration = handoff.LeaseGeneration,
            ErrorCode = (string?)null,
            Message = (string?)null,
            UpdatedAtUtc = DateTimeOffset.UtcNow,
        }));
        var authenticated = store.ValidatePending("cpu", Path.GetDirectoryName(handoff.CurrentAppPath)!, handoff.CurrentAppPath, handoff.Token);
        store.WriteShutdownRequested("cpu", authenticated);
        store.WriteShutdownAcknowledged("cpu", authenticated);
    }

    private void WriteActiveRuntime(RuntimeReplacementRequest request)
    {
        Directory.CreateDirectory(request.InstallPath);
        File.WriteAllText(Path.Combine(request.InstallPath, "VRCNT.exe"), "old-app");
        File.WriteAllText(Path.Combine(request.InstallPath, "VRCNT-backend.exe"), "old-backend");
    }

    private static RuntimeIdentity CreateIdentity()
    {
        var marker = JsonSerializer.Serialize(new { Product = "VRCNT", Version = "5.15.0", Variant = RuntimeVariant.Cpu, Architecture = "x64", BuildIdentity = "build" });
        return new RuntimeIdentity("VRCNT", "5.15.0", RuntimeVariant.Cpu, "x64", "build", Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(marker))).ToLowerInvariant());
    }

    private sealed class RecordingAcquirer(Action? onAcquire = null) : IRuntimeArchiveAcquirer
    {
        public bool WasCalled { get; private set; }
        public Task<IReadOnlyList<string>> AcquireAsync(RuntimeReplacementRequest request, CancellationToken cancellationToken)
        {
            WasCalled = true;
            onAcquire?.Invoke();
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(request.ArchiveParts);
        }
    }

    private sealed class TestExtractor(IReadOnlyList<string>? entries = null, Action? onExtract = null) : IArchiveExtractor
    {
        public bool Extracted { get; private set; }
        public string? ExtractionDestination { get; private set; }
        public Task<IReadOnlyList<string>> ListEntriesAsync(IReadOnlyList<string> archiveParts, CancellationToken cancellationToken) => Task.FromResult(entries ?? (IReadOnlyList<string>)["VRCNT.exe", "VRCNT-backend.exe", "VRCNT.runtime.json"]);
        public Task TestAsync(IReadOnlyList<string> archiveParts, CancellationToken cancellationToken) => Task.CompletedTask;
        public Task ExtractAsync(IReadOnlyList<string> archiveParts, string destination, CancellationToken cancellationToken)
        {
            Extracted = true;
            ExtractionDestination = destination;
            Directory.CreateDirectory(destination);
            File.WriteAllText(Path.Combine(destination, "VRCNT.exe"), "new-app");
            File.WriteAllText(Path.Combine(destination, "VRCNT-backend.exe"), "new-backend");
            File.WriteAllText(Path.Combine(destination, "VRCNT.runtime.json"), JsonSerializer.Serialize(new { Product = "VRCNT", Version = "5.15.0", Variant = RuntimeVariant.Cpu, Architecture = "x64", BuildIdentity = "build" }));
            onExtract?.Invoke();
            cancellationToken.ThrowIfCancellationRequested();
            return Task.CompletedTask;
        }
    }

    private sealed class RecordingVolumeProbe : IVolumeIdentityProbe
    {
        private readonly Func<string, string> _resolver;
        public RecordingVolumeProbe(string identity) => _resolver = _ => identity;
        public RecordingVolumeProbe(Func<string, string> resolver) => _resolver = resolver;
        public List<string> Paths { get; } = [];
        public string GetVolumeIdentity(string path) { Paths.Add(path); return _resolver!(path); }
    }

    private sealed class FixedSpaceProbe(long availableBytes) : IAvailableSpaceProbe
    {
        public long GetAvailableBytes(string path) => availableBytes;
    }

    private sealed class RecordingStateTransition : IRuntimeStateTransition
    {
        private readonly Func<bool> _backupExists;
        public RecordingStateTransition(Func<bool>? backupExists = null) => _backupExists = backupExists ?? (() => false);
        public bool Validated { get; private set; }
        public RuntimeIdentity? ActiveIdentity { get; private set; }
        public bool BackupExistedWhenWritten { get; private set; }
        public void ValidateExistingRuntime(string installPath) => Validated = true;
        public void WriteActiveRuntime(string installPath, RuntimeIdentity identity)
        {
            ActiveIdentity = identity;
            BackupExistedWhenWritten = _backupExists();
        }
    }

    private sealed class RejectingStateTransition : IRuntimeStateTransition
    {
        public void ValidateExistingRuntime(string installPath) => throw new InvalidDataException("existing runtime is unowned");
        public void WriteActiveRuntime(string installPath, RuntimeIdentity identity) => throw new InvalidOperationException("The invalid runtime cannot commit.");
    }

    private sealed class TestProcessCoordinator(ProcessStopResult stopResult, Action? onStop = null, bool? knownProcessesStopped = null) : IRuntimeProcessCoordinator, IRuntimeSwitchProcessCoordinator, IRuntimeProcessForceCloser
    {
        public bool RelaunchCalled { get; private set; }
        public bool LaunchCalled { get; private set; }
        public bool ForceCloseCalled { get; private set; }
        public RuntimeShutdownHandoff? SwitchHandoff { get; private set; }
        public Task<ProcessStopResult> RequestGracefulStopAsync(CancellationToken cancellationToken) { onStop?.Invoke(); return Task.FromResult(stopResult); }
        public Task<ProcessStopResult> RequestGracefulStopAsync(RuntimeShutdownHandoff handoff, CancellationToken cancellationToken) { SwitchHandoff = handoff; onStop?.Invoke(); return Task.FromResult(stopResult); }
        public Task<bool> AreKnownProcessesStoppedAsync(CancellationToken cancellationToken) => Task.FromResult(knownProcessesStopped ?? stopResult.Stopped);
        public Task<ProcessStopResult> ForceCloseRemainingAsync(IReadOnlyList<int> processIds, CancellationToken cancellationToken) { ForceCloseCalled = true; return Task.FromResult(new ProcessStopResult(true, [], false, null)); }
        public Task LaunchForActivationAsync(string installPath, RuntimeIdentity expectedIdentity, ActivationRequest request, CancellationToken cancellationToken) { LaunchCalled = true; return Task.CompletedTask; }
        public Task RelaunchActiveRuntimeAsync(CancellationToken cancellationToken) { RelaunchCalled = true; return Task.CompletedTask; }
    }

    private sealed class ActivationLockingProcessCoordinator(bool requiresForceClose = false) : IRuntimeProcessCoordinator, IRuntimeProcessForceCloser, IDisposable
    {
        private FileStream? _stagedRuntimeLock;

        public int GracefulStopRequests { get; private set; }
        public int ForceCloseRequests { get; private set; }

        public Task<ProcessStopResult> RequestGracefulStopAsync(CancellationToken cancellationToken)
        {
            GracefulStopRequests++;
            if (_stagedRuntimeLock is not null && requiresForceClose)
                return Task.FromResult(new ProcessStopResult(false, [42], true, "processes_running"));
            _stagedRuntimeLock?.Dispose();
            _stagedRuntimeLock = null;
            return Task.FromResult(new ProcessStopResult(true, [], false, null));
        }

        public Task<bool> AreKnownProcessesStoppedAsync(CancellationToken cancellationToken) => Task.FromResult(true);

        public Task LaunchForActivationAsync(string installPath, RuntimeIdentity expectedIdentity, ActivationRequest request, CancellationToken cancellationToken)
        {
            _stagedRuntimeLock = new FileStream(Path.Combine(installPath, "VRCNT.exe"), FileMode.Open, FileAccess.Read, FileShare.None);
            return Task.CompletedTask;
        }

        public Task<ProcessStopResult> ForceCloseRemainingAsync(IReadOnlyList<int> processIds, CancellationToken cancellationToken)
        {
            ForceCloseRequests++;
            _stagedRuntimeLock?.Dispose();
            _stagedRuntimeLock = null;
            return Task.FromResult(new ProcessStopResult(true, [], false, null));
        }

        public Task RelaunchActiveRuntimeAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        public void Dispose() => _stagedRuntimeLock?.Dispose();
    }

    private static RuntimeActivationProof ProofFor(RuntimeReplacementRequest request) => new(
        1, "ready", request.Activation!.SingleUseToken, request.Activation!.Nonce, Environment.ProcessId,
        request.ExpectedIdentity.Version, "cpu");

    private sealed class ImmediateProofProcessCoordinator(IEnumerable<RuntimeActivationProof> proofs) : IRuntimeProcessCoordinator
    {
        public bool LaunchCalled { get; private set; }
        public Task<ProcessStopResult> RequestGracefulStopAsync(CancellationToken cancellationToken) => Task.FromResult(new ProcessStopResult(true, [], false, null));
        public Task<bool> AreKnownProcessesStoppedAsync(CancellationToken cancellationToken) => Task.FromResult(true);
        public async Task LaunchForActivationAsync(string installPath, RuntimeIdentity expectedIdentity, ActivationRequest activation, CancellationToken cancellationToken)
        {
            LaunchCalled = true;
            using var client = new NamedPipeClientStream(".", activation.PipeName, PipeDirection.Out, PipeOptions.Asynchronous);
            await client.ConnectAsync(0, cancellationToken);
            await using var writer = new StreamWriter(client) { AutoFlush = true };
            await writer.WriteAsync(string.Concat(proofs.Select(proof => JsonSerializer.Serialize(proof) + "\n")));
            await writer.FlushAsync(cancellationToken);
        }
        public Task RelaunchActiveRuntimeAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    }

    private sealed class TestHealthMonitor(bool ready = true, Action? onCheck = null, string? errorCode = null) : IRuntimeActivationHealthMonitor
    {
        public Task<RuntimeActivationHealthResult> WaitForReadyAsync(string installPath, RuntimeIdentity expectedIdentity, ActivationRequest request, CancellationToken cancellationToken)
        {
            onCheck?.Invoke();
            return Task.FromResult(new RuntimeActivationHealthResult(ready, false, ready ? null : errorCode ?? "activation_unhealthy"));
        }
    }

    private sealed class ThrowingMover(string failDestination) : IRuntimeDirectoryMover
    {
        private bool _failed;
        public void Move(string source, string destination)
        {
            if (!_failed && string.Equals(Path.GetFullPath(destination), Path.GetFullPath(failDestination), StringComparison.OrdinalIgnoreCase)) { _failed = true; throw new IOException("simulated move failure"); }
            Directory.Move(source, destination);
        }
    }

    private sealed class CallbackMover(Action<string, string>? callback = null) : IRuntimeDirectoryMover
    {
        public List<(string Source, string Destination)> Moves { get; } = [];
        public void Move(string source, string destination)
        {
            callback?.Invoke(source, destination);
            Moves.Add((source, destination));
            Directory.Move(source, destination);
        }
    }
}
