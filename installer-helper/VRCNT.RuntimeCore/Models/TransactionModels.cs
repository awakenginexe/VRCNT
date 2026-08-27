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
    bool ForceCloseConfirmed);

public interface IRuntimeTransactionEngine
{
    Task<RuntimeOperationResult> ExecuteAsync(
        RuntimeInstallRequest request,
        IProgress<InstallProgress>? progress,
        CancellationToken cancellationToken);
}
