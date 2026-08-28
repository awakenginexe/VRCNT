using System.Text.Json.Serialization;

namespace VRCNT.RuntimeCore.Models;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum TransactionPhase
{
    Preflight,
    Acquire,
    Verify,
    Stage,
    Quiesce,
    Replace,
    Activate,
    Commit,
    Cleanup,
}

public sealed record RuntimeOperationResult(
    bool Succeeded,
    bool RolledBack,
    bool RecoveryRequired,
    string? ErrorCode,
    string? ErrorMessage);

public sealed record RuntimeShutdownHandoff(
    string Nonce,
    string Token,
    string Proof,
    RuntimeVariant TargetVariant,
    string StatusPath,
    string CurrentAppPath,
    long LeaseGeneration = 0,
    string? InstallPath = null)
{
    public string ResolvedInstallPath => Path.GetFullPath(InstallPath ?? Path.GetDirectoryName(CurrentAppPath) ?? throw new InvalidDataException("The runtime switch install path is invalid."));
}

public sealed record InstallProgress(
    TransactionPhase Phase,
    long CompletedBytes,
    long TotalBytes,
    string Message);

public sealed record TransferProgress(
    string FileName,
    long CompletedBytes,
    long TotalBytes,
    double BytesPerSecond);

public sealed record RuntimeInstallRequest(
    RuntimeVariant TargetVariant,
    string TargetVersion,
    string InstallPath,
    string ReleaseBaseUrl,
    string CacheDirectory,
    bool ForceCloseConfirmed,
    RuntimeShutdownHandoff? ShutdownHandoff = null);

public interface IRuntimeTransactionEngine
{
    Task<RuntimeOperationResult> ExecuteAsync(
        RuntimeInstallRequest request,
        IProgress<InstallProgress>? progress,
        CancellationToken cancellationToken);
}
