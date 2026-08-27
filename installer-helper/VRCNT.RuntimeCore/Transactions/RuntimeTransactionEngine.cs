using VRCNT.RuntimeCore.Archive;
using VRCNT.RuntimeCore.Filesystem;
using VRCNT.RuntimeCore.Models;
using VRCNT.RuntimeCore.Paths;
using VRCNT.RuntimeCore.Process;
using VRCNT.RuntimeCore.Packages;
using VRCNT.RuntimeCore.State;
using VRCNT.RuntimeCore.Storage;

namespace VRCNT.RuntimeCore.Transactions;

public sealed record RuntimeReplacementRequest(
    string InstallPath,
    string CacheDirectory,
    IReadOnlyList<string> ArchiveParts,
    long InstalledSize,
    RuntimeIdentity ExpectedIdentity,
    ActivationRequest Activation,
    bool ForceCloseConfirmed);

public interface IRuntimeArchiveAcquirer
{
    Task<IReadOnlyList<string>> AcquireAsync(RuntimeReplacementRequest request, CancellationToken cancellationToken);
}

public interface IRuntimeStateTransition
{
    void ValidateExistingRuntime(string installPath);
    void WriteActiveRuntime(string installPath, RuntimeIdentity identity);
}

public interface IRuntimeDirectoryMover
{
    void Move(string source, string destination);
}

public sealed class RuntimeDirectoryMover : IRuntimeDirectoryMover
{
    public void Move(string source, string destination) => Directory.Move(source, destination);
}

public sealed record RuntimeActivationHealthResult(bool Ready, bool Retryable, string? ErrorCode);

// Task 5 supplies this monitor with the combined Tauri-plus-backend readiness handshake.
public interface IRuntimeActivationHealthMonitor
{
    Task<RuntimeActivationHealthResult> WaitForReadyAsync(string installPath, ActivationRequest request, CancellationToken cancellationToken);
}

public sealed class ActivationProtocolRequiredHealthMonitor : IRuntimeActivationHealthMonitor
{
    public Task<RuntimeActivationHealthResult> WaitForReadyAsync(string installPath, ActivationRequest request, CancellationToken cancellationToken) =>
        Task.FromResult(new RuntimeActivationHealthResult(false, false, "activation_protocol_unavailable"));
}

public sealed class Task3RuntimeStateTransition : IRuntimeStateTransition
{
    public void ValidateExistingRuntime(string installPath)
    {
        var resolver = new UserDataPathResolver();
        var paths = resolver.Resolve(installPath);
        var state = new RuntimeStateStore().Read(paths.DataRoot);
        var currentIdentity = new RuntimeIdentity(state.Product, state.Version, state.Variant, state.Architecture, state.MarkerBuildIdentity, state.MarkerSha256);
        var currentPackage = new VariantPackage("7z", 1, 1, [new PackagePart("existing-runtime", 1, new string('0', 64))], state.Variant == RuntimeVariant.Cuda, "VRCNT.runtime.json", currentIdentity);
        var validated = new RuntimeStateValidator(new PayloadIdentityReader()).Validate(state, paths.InstallPath, currentPackage);
        if (validated.Status != RuntimeStateStatus.Active)
            throw new InvalidDataException("Existing runtime identity cannot authorize replacement; recovery or migration is required.");
    }

    public void WriteActiveRuntime(string installPath, RuntimeIdentity identity)
    {
        var paths = new UserDataPathResolver().Resolve(installPath);
        new RuntimeStateStore().WriteAtomic(paths.DataRoot, new RuntimeState(
            1, RuntimeStateStatus.Active, identity.Product, identity.Version, identity.Variant, identity.Architecture,
            paths.InstallPath, identity.BuildIdentity, identity.MarkerSha256, DateTimeOffset.UtcNow));
    }
}

public sealed class RuntimeTransactionEngine(
    IRuntimeArchiveAcquirer archiveAcquirer,
    IArchiveExtractor archiveExtractor,
    RuntimePathValidator pathValidator,
    RequiredSpaceCalculator requiredSpaceCalculator,
    IRuntimeProcessCoordinator processCoordinator,
    IRuntimeActivationHealthMonitor activationHealthMonitor,
    TransactionJournalStore journalStore,
    IRuntimeDirectoryMover directoryMover,
    IRuntimeStateTransition runtimeStateTransition,
    Action? onCommit = null,
    Action? onPreflightValidated = null)
{
    public async Task<RuntimeOperationResult> ExecuteAsync(RuntimeReplacementRequest request, IProgress<InstallProgress>? progress, CancellationToken cancellationToken)
    {
        RuntimeTransactionPaths? paths = null;
        RuntimeTransactionJournal? journal = null;
        var quiesced = false;
        try
        {
            Report(progress, TransactionPhase.Preflight, "Validating replacement paths.");
            cancellationToken.ThrowIfCancellationRequested();
            var recovery = await RecoverPendingAsync(request.InstallPath, cancellationToken);
            if (!recovery.Succeeded) return recovery;
            paths = pathValidator.CreateTransactionPaths(request.InstallPath, Guid.NewGuid().ToString("N"));
            if (!requiredSpaceCalculator.HasRequiredSpace(request.InstallPath, request.InstalledSize))
                return Fail("insufficient_space", "The target volume does not have enough free space for a transactional replacement.");
            if (Directory.Exists(request.InstallPath))
            {
                runtimeStateTransition.ValidateExistingRuntime(request.InstallPath);
                if (processCoordinator is IRuntimeProcessInstallPathObserver observer) observer.SetActiveInstallPath(request.InstallPath);
            }
            onPreflightValidated?.Invoke();

            Report(progress, TransactionPhase.Acquire, "Acquiring resumable runtime archives.");
            var archiveParts = await archiveAcquirer.AcquireAsync(request, cancellationToken);
            EnsureArchiveParts(archiveParts, request.CacheDirectory);
            cancellationToken.ThrowIfCancellationRequested();

            Report(progress, TransactionPhase.Verify, "Validating archive structure.");
            var entries = await archiveExtractor.ListEntriesAsync(archiveParts, cancellationToken);
            ValidateArchiveEntries(entries);
            await archiveExtractor.TestAsync(archiveParts, cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();

            Directory.CreateDirectory(paths.TransactionRoot);
            journal = new RuntimeTransactionJournal(Path.GetFileName(paths.TransactionRoot), TransactionPhase.Stage, request.InstallPath, paths.StagingPath, paths.BackupPath, request.ExpectedIdentity, false, false, false, false);
            journalStore.WriteAtomic(paths.JournalPath, journal);
            Report(progress, TransactionPhase.Stage, "Extracting archive into the transaction staging directory.");
            await archiveExtractor.ExtractAsync(archiveParts, paths.StagingPath, cancellationToken);
            ValidateStagedPayload(paths.StagingPath, request.ExpectedIdentity);
            if (request.ExpectedIdentity.Variant == RuntimeVariant.Cpu) CpuPayloadValidator.ValidateStagedPayload(paths.StagingPath);
            cancellationToken.ThrowIfCancellationRequested();

            journal = journal with { Phase = TransactionPhase.Quiesce };
            journalStore.WriteAtomic(paths.JournalPath, journal);
            Report(progress, TransactionPhase.Quiesce, "Requesting VRCNT shutdown.");
            var stop = await processCoordinator.RequestGracefulStopAsync(CancellationToken.None);
            if (!stop.Stopped)
            {
                if (!request.ForceCloseConfirmed || processCoordinator is not IRuntimeProcessForceCloser forceCloser)
                {
                    DeleteTransaction(paths.TransactionRoot);
                    return Fail("processes_running", "VRCNT processes remain active and targeted force close was not confirmed.");
                }
                stop = await forceCloser.ForceCloseRemainingAsync(stop.RemainingProcessIds, CancellationToken.None);
                if (!stop.Stopped)
                {
                    DeleteTransaction(paths.TransactionRoot);
                    return Fail("processes_running", "VRCNT processes remain active after targeted force close.");
                }
            }
            quiesced = true;
            if (cancellationToken.IsCancellationRequested)
            {
                await processCoordinator.RelaunchActiveRuntimeAsync(CancellationToken.None);
                DeleteTransaction(paths.TransactionRoot);
                return Fail("cancelled", "Cancellation was applied before runtime replacement.");
            }
            if (!await processCoordinator.AreKnownProcessesStoppedAsync(CancellationToken.None))
            {
                await processCoordinator.RelaunchActiveRuntimeAsync(CancellationToken.None);
                DeleteTransaction(paths.TransactionRoot);
                return Fail("processes_running", "A VRCNT process restarted before the runtime could be replaced.");
            }

            journal = journal with { Phase = TransactionPhase.Replace };
            journalStore.WriteAtomic(paths.JournalPath, journal);
            Report(progress, TransactionPhase.Replace, "Replacing the runtime transactionally.");
            if (Directory.Exists(request.InstallPath))
            {
                journal = journal with { ActiveMoveIntent = true };
                journalStore.WriteAtomic(paths.JournalPath, journal);
                directoryMover.Move(request.InstallPath, paths.BackupPath);
                journal = journal with { ActiveRuntimeMoved = true };
                journalStore.WriteAtomic(paths.JournalPath, journal);
            }
            if (cancellationToken.IsCancellationRequested) return await CancelAfterDestructiveStepAsync(paths, journal, request.InstallPath, processCoordinator);
            if (!await processCoordinator.AreKnownProcessesStoppedAsync(CancellationToken.None))
                return await RollbackAfterDestructiveStepAsync(paths, journal, request.InstallPath, processCoordinator, "processes_running", "A VRCNT process restarted during runtime replacement.");
            journal = journal with { StagedMoveIntent = true };
            journalStore.WriteAtomic(paths.JournalPath, journal);
            directoryMover.Move(paths.StagingPath, request.InstallPath);
            journal = journal with { StagedRuntimeMoved = true };
            journalStore.WriteAtomic(paths.JournalPath, journal);

            journal = journal with { Phase = TransactionPhase.Activate };
            journalStore.WriteAtomic(paths.JournalPath, journal);
            Report(progress, TransactionPhase.Activate, "Waiting for Tauri and backend activation health.");
            await processCoordinator.LaunchForActivationAsync(request.InstallPath, request.Activation, CancellationToken.None);
            var health = await activationHealthMonitor.WaitForReadyAsync(request.InstallPath, request.Activation, CancellationToken.None);
            if (!health.Ready) throw new InvalidDataException(health.ErrorCode ?? "activation_unhealthy");

            journal = journal with { Phase = TransactionPhase.Commit };
            journalStore.WriteAtomic(paths.JournalPath, journal);
            runtimeStateTransition.WriteActiveRuntime(request.InstallPath, request.ExpectedIdentity);
            onCommit?.Invoke();
            Report(progress, TransactionPhase.Commit, "Committing the activated runtime.");
            DeleteTransaction(paths.TransactionRoot);
            Report(progress, TransactionPhase.Cleanup, "Runtime transaction completed.");
            return new RuntimeOperationResult(true, false, false, null, null);
        }
        catch (OperationCanceledException) when (!quiesced)
        {
            if (paths is not null) DeleteTransaction(paths.TransactionRoot);
            return Fail("cancelled", "Cancellation was applied before runtime replacement.");
        }
        catch (Exception exception)
        {
            if (paths is null || journal is null) return Fail(Classify(exception), exception.Message);
            var rollback = await RollbackAsync(paths, journal, request.InstallPath, processCoordinator, quiesced);
            return new RuntimeOperationResult(false, rollback, !rollback, Classify(exception), exception.Message);
        }
    }

    public Task<RuntimeOperationResult> RecoverPendingAsync(string installPath, CancellationToken cancellationToken)
    {
        try
        {
            var container = pathValidator.GetTransactionContainer(installPath);
            if (!Directory.Exists(container)) return Task.FromResult(new RuntimeOperationResult(true, false, false, null, null));
            foreach (var journalPath in Directory.EnumerateFiles(container, "transaction.json", SearchOption.AllDirectories))
            {
                cancellationToken.ThrowIfCancellationRequested();
                var journal = journalStore.Read(journalPath);
                var transactionRoot = Path.GetDirectoryName(journalPath)!;
                if (!PathsEqual(journal.TargetPath, installPath) || !IsWithin(container, transactionRoot) || !PathsEqual(journal.BackupPath, Path.Combine(transactionRoot, "backup")) || !PathsEqual(journal.StagingPath, Path.Combine(transactionRoot, "staging")))
                    return Task.FromResult(new RuntimeOperationResult(false, false, true, "unsafe_journal", "The pending runtime transaction journal is unsafe."));
                var targetExists = Directory.Exists(installPath);
                var backupExists = Directory.Exists(journal.BackupPath);
                var stagingExists = Directory.Exists(journal.StagingPath);
                if (backupExists && !targetExists)
                {
                    directoryMover.Move(journal.BackupPath, installPath);
                }
                else if (backupExists && targetExists)
                    return Task.FromResult(new RuntimeOperationResult(false, false, true, "recovery_required", "Both runtime candidates exist; preserving the backup for recovery."));
                else if (journal.StagedMoveIntent && targetExists)
                    return Task.FromResult(new RuntimeOperationResult(false, false, true, "recovery_required", "The staged runtime may not have completed activation; preserving the transaction for recovery."));
                else if ((journal.ActiveMoveIntent || journal.StagedMoveIntent) && !targetExists)
                    return Task.FromResult(new RuntimeOperationResult(false, false, true, "recovery_required", "The interrupted replacement has no recoverable active runtime."));
                else if (stagingExists && !targetExists)
                    return Task.FromResult(new RuntimeOperationResult(false, false, true, "recovery_required", "The interrupted transaction has staging material without an active runtime."));
                DeleteTransaction(transactionRoot);
            }
            return Task.FromResult(new RuntimeOperationResult(true, false, false, null, null));
        }
        catch (OperationCanceledException) { return Task.FromResult(Fail("cancelled", "Recovery cancellation was requested.")); }
        catch (Exception exception) { return Task.FromResult(new RuntimeOperationResult(false, false, true, "recovery_required", exception.Message)); }
    }

    private async Task<RuntimeOperationResult> CancelAfterDestructiveStepAsync(RuntimeTransactionPaths paths, RuntimeTransactionJournal journal, string targetPath, IRuntimeProcessCoordinator coordinator)
        => await RollbackAfterDestructiveStepAsync(paths, journal, targetPath, coordinator, "cancelled", "Cancellation was applied after runtime replacement began.");

    private async Task<RuntimeOperationResult> RollbackAfterDestructiveStepAsync(RuntimeTransactionPaths paths, RuntimeTransactionJournal journal, string targetPath, IRuntimeProcessCoordinator coordinator, string errorCode, string errorMessage)
    {
        var rollback = await RollbackAsync(paths, journal, targetPath, coordinator, true);
        return new RuntimeOperationResult(false, rollback, !rollback, errorCode, errorMessage);
    }

    private async Task<bool> RollbackAsync(RuntimeTransactionPaths paths, RuntimeTransactionJournal journal, string targetPath, IRuntimeProcessCoordinator coordinator, bool quiesced)
    {
        try
        {
            if (Directory.Exists(paths.BackupPath))
            {
                if (Directory.Exists(targetPath)) Directory.Delete(targetPath, true);
                directoryMover.Move(paths.BackupPath, targetPath);
            }
            else if (journal.StagedMoveIntent && Directory.Exists(targetPath)) Directory.Delete(targetPath, true);
            if (quiesced) await coordinator.RelaunchActiveRuntimeAsync(CancellationToken.None);
            DeleteTransaction(paths.TransactionRoot);
            return true;
        }
        catch { return false; }
    }

    private static void EnsureArchiveParts(IReadOnlyList<string> parts, string cacheDirectory)
    {
        if (parts.Count == 0 || parts.Any(path => !File.Exists(path))) throw new FileNotFoundException("A required acquired runtime archive part is missing.");
        _ = Path.GetFullPath(cacheDirectory); // Acquisition may be resumable on another volume; replacement material cannot.
    }

    private static void ValidateArchiveEntries(IReadOnlyList<string> entries)
    {
        if (entries.Count == 0 || entries.Any(entry => string.IsNullOrWhiteSpace(entry) || Path.IsPathRooted(entry) || entry.Split(['/', '\\']).Any(segment => segment is ".." or "." or "")))
            throw new InvalidDataException("The runtime archive contains an unsafe path.");
    }

    private static void ValidateStagedPayload(string stagingPath, RuntimeIdentity expectedIdentity)
    {
        if (!Directory.Exists(stagingPath) || !File.Exists(Path.Combine(stagingPath, "VRCNT.exe")) || !File.Exists(Path.Combine(stagingPath, "VRCNT-backend.exe")))
            throw new InvalidDataException("The staged runtime payload is incomplete.");
        if (Directory.EnumerateFileSystemEntries(stagingPath, "*", SearchOption.AllDirectories).Any(path => File.GetAttributes(path).HasFlag(FileAttributes.ReparsePoint)))
            throw new InvalidDataException("The staged runtime payload contains a reparse point.");
        _ = new PayloadIdentityReader().ReadAndValidate(stagingPath, "VRCNT.runtime.json", expectedIdentity);
    }

    private static void DeleteTransaction(string transactionRoot)
    {
        if (Directory.Exists(transactionRoot)) Directory.Delete(transactionRoot, true);
        var container = Directory.GetParent(transactionRoot)?.FullName;
        if (container is not null && Directory.Exists(container) && !Directory.EnumerateFileSystemEntries(container).Any()) Directory.Delete(container);
    }

    private static bool IsWithin(string parent, string candidate)
    {
        var relative = Path.GetRelativePath(parent, candidate);
        return relative == "." || (!relative.StartsWith("..", StringComparison.Ordinal) && !Path.IsPathRooted(relative));
    }

    private static bool PathsEqual(string left, string right) => string.Equals(Path.GetFullPath(left), Path.GetFullPath(right), StringComparison.OrdinalIgnoreCase);
    private static RuntimeOperationResult Fail(string code, string message) => new(false, false, false, code, message);
    private static string Classify(Exception exception) => exception is InvalidDataException && exception.Message.Contains("volume", StringComparison.OrdinalIgnoreCase) ? "cross_volume"
        : exception is InvalidDataException && exception.Message.Contains("unsafe path", StringComparison.OrdinalIgnoreCase) ? "unsafe_archive"
        : "transaction_failed";
    private static void Report(IProgress<InstallProgress>? progress, TransactionPhase phase, string message) => progress?.Report(new InstallProgress(phase, 0, 0, message));
}
