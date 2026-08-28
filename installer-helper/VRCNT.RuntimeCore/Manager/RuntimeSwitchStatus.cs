using System.Security.Cryptography;
using System.Text.Json;
using VRCNT.RuntimeCore.Models;

namespace VRCNT.RuntimeCore.Manager;

public sealed record RuntimeSwitchStatus(
    int Schema,
    string Status,
    string TargetVariant,
    string Nonce,
    string TokenSha256,
    string ProofSha256,
    string CurrentAppPath,
    string? ErrorCode,
    string? Message,
    DateTimeOffset UpdatedAtUtc,
    int? ManagerProcessId = null,
    DateTimeOffset? HandoffExpiresAtUtc = null,
    string? ReceiptMac = null,
    long? ReceiptExpiresAtUnixMs = null,
    DateTimeOffset? ConsumedAtUtc = null);

public sealed class RuntimeSwitchStatusStore
{
    private const int Schema = 1;
    private const string FileName = "runtime-switch-status.json";
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true, WriteIndented = true };
    private readonly string _dataRoot;
    private readonly string _statusPath;

    public RuntimeSwitchStatusStore(string dataRoot, string statusPath)
    {
        _dataRoot = Path.GetFullPath(dataRoot);
        _statusPath = Path.GetFullPath(statusPath);
        var expected = Path.Combine(_dataRoot, FileName);
        if (!PathsEqual(_statusPath, expected)) throw new InvalidDataException("The runtime switch status path is not the validated data-root status location.");
    }

    public RuntimeSwitchStatus Read()
    {
        try
        {
            var status = JsonSerializer.Deserialize<RuntimeSwitchStatus>(File.ReadAllText(_statusPath), JsonOptions);
            return status ?? throw new InvalidDataException("The runtime switch status is empty.");
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException or InvalidDataException)
        {
            throw new InvalidDataException("The runtime switch status is unavailable or malformed.", exception);
        }
    }

    public RuntimeShutdownHandoff ValidatePending(string targetVariant, string installPath, string currentAppPath, string token)
    {
        var target = targetVariant.ToLowerInvariant() switch
        {
            "cpu" => RuntimeVariant.Cpu,
            "cuda" => RuntimeVariant.Cuda,
            _ => throw new InvalidDataException("The runtime switch target is invalid."),
        };
        if (string.IsNullOrWhiteSpace(token)) throw new InvalidDataException("The runtime switch handoff token is missing.");
        var status = Read();
        var normalizedTarget = target == RuntimeVariant.Cuda ? "cuda" : "cpu";
        var expectedApp = Path.GetFullPath(Path.Combine(installPath, "VRCNT.exe"));
        var expectedProof = Proof(token, status.Nonce, normalizedTarget, expectedApp);
        if (status.Schema != Schema || !string.Equals(status.Status, "pending", StringComparison.Ordinal) ||
            !string.Equals(status.TargetVariant, normalizedTarget, StringComparison.Ordinal) ||
            string.IsNullOrWhiteSpace(status.Nonce) || !SecureEquals(status.TokenSha256, Hash(token)) ||
            !SecureEquals(status.ProofSha256, expectedProof))
            throw new InvalidDataException("The runtime switch handoff is stale or unauthenticated.");

        if (!PathsEqual(status.CurrentAppPath, expectedApp) || !PathsEqual(currentAppPath, expectedApp))
            throw new InvalidDataException("The runtime switch current application identity is invalid.");
        return new RuntimeShutdownHandoff(status.Nonce, token, expectedProof, target, _statusPath, expectedApp);
    }

    public void WriteAccepted(string targetVariant, RuntimeShutdownHandoff handoff) => Write("accepted", targetVariant, handoff, null, null);
    public void WriteRunning(string targetVariant, RuntimeShutdownHandoff handoff) => Write("running", targetVariant, handoff, null, null);
    public void WriteShutdownRequested(string targetVariant, RuntimeShutdownHandoff handoff) => Write("shutdown_requested", targetVariant, handoff, null, null);
    public void WriteShutdownAcknowledged(string targetVariant, RuntimeShutdownHandoff handoff) => Write("shutdown_acknowledged", targetVariant, handoff, null, null);

    public async Task<bool> WaitForShutdownAcknowledgementAsync(RuntimeShutdownHandoff handoff, TimeSpan timeout, CancellationToken cancellationToken)
    {
        var deadline = DateTimeOffset.UtcNow + timeout;
        do
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (IsShutdownAcknowledged(handoff)) return true;
            if (DateTimeOffset.UtcNow >= deadline) return false;
            await Task.Delay(TimeSpan.FromMilliseconds(50), cancellationToken);
        } while (true);
    }

    public bool IsShutdownAcknowledged(RuntimeShutdownHandoff handoff)
    {
        try
        {
            var status = Read();
            return status.Status == "shutdown_acknowledged"
                && status.TargetVariant == VariantName(handoff.TargetVariant)
                && SecureEquals(status.TokenSha256, Hash(handoff.Token))
                && SecureEquals(status.ProofSha256, handoff.Proof)
                && PathsEqual(status.CurrentAppPath, handoff.CurrentAppPath);
        }
        catch (InvalidDataException)
        {
            return false;
        }
    }

    public void WriteTerminal(string status, string targetVariant, RuntimeShutdownHandoff handoff, string? errorCode, string? message) =>
        WriteTerminal(status, targetVariant, handoff, errorCode, message, handoff.Token);

    public void WriteTerminal(string status, string targetVariant, RuntimeShutdownHandoff handoff, string? errorCode, string? message, string receiptSecret, DateTimeOffset? receiptExpiresAtUtc = null)
    {
        if (status is not ("succeeded" or "failed" or "cancelled" or "stale")) throw new ArgumentException("Invalid terminal switch status.", nameof(status));
        if (string.IsNullOrWhiteSpace(receiptSecret)) throw new InvalidDataException("The runtime switch receipt secret is missing.");
        var current = Read();
        var now = DateTimeOffset.UtcNow;
        var expiresAtUtc = receiptExpiresAtUtc ?? now.AddHours(24);
        var record = new RuntimeSwitchStatus(
            Schema,
            status,
            targetVariant,
            handoff.Nonce,
            Hash(handoff.Token),
            handoff.Proof,
            handoff.CurrentAppPath,
            errorCode,
            message,
            now,
            current.ManagerProcessId,
            current.HandoffExpiresAtUtc,
            null,
            expiresAtUtc.ToUnixTimeMilliseconds());
        WriteRecord(record with { ReceiptMac = TerminalReceiptMac(record, receiptSecret) });
    }

    public void WriteStale(string errorCode, string message)
    {
        var current = Read();
        WriteRecord(current with
        {
            Status = "stale",
            ErrorCode = errorCode,
            Message = message,
            UpdatedAtUtc = DateTimeOffset.UtcNow,
        });
    }

    private void Write(string status, string targetVariant, RuntimeShutdownHandoff handoff, string? errorCode, string? message)
    {
        var current = Read();
        var record = new RuntimeSwitchStatus(
            Schema,
            status,
            targetVariant,
            handoff.Nonce,
            Hash(handoff.Token),
            handoff.Proof,
            handoff.CurrentAppPath,
            errorCode,
            message,
            DateTimeOffset.UtcNow,
            Environment.ProcessId,
            DateTimeOffset.UtcNow.AddMinutes(15));
        WriteRecord(record);
    }

    private static string VariantName(RuntimeVariant variant) => variant == RuntimeVariant.Cuda ? "cuda" : "cpu";

    private void WriteRecord(RuntimeSwitchStatus record)
    {
        Directory.CreateDirectory(_dataRoot);
        var temporaryPath = Path.Combine(_dataRoot, $"{FileName}.{Guid.NewGuid():N}.tmp");
        try
        {
            File.WriteAllText(temporaryPath, JsonSerializer.Serialize(record, JsonOptions));
            File.Move(temporaryPath, _statusPath, true);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    public static string Proof(string token, string nonce, string targetVariant, string currentAppPath) =>
        Hash($"{token}\n{nonce}\n{targetVariant}\n{Path.GetFullPath(currentAppPath)}");

    public static bool VerifyTerminalReceipt(RuntimeSwitchStatus status, string receiptSecret, string currentAppPath, DateTimeOffset now)
    {
        if (status.Status is not ("succeeded" or "failed" or "cancelled" or "stale") ||
            string.IsNullOrWhiteSpace(receiptSecret) ||
            string.IsNullOrWhiteSpace(status.ReceiptMac) ||
            status.ReceiptExpiresAtUnixMs is null ||
            status.ConsumedAtUtc is not null ||
            !PathsEqual(status.CurrentAppPath, currentAppPath) ||
            status.ReceiptExpiresAtUnixMs <= now.ToUnixTimeMilliseconds() ||
            status.ReceiptExpiresAtUnixMs > status.UpdatedAtUtc.AddHours(24).ToUnixTimeMilliseconds() ||
            status.UpdatedAtUtc > now.AddMinutes(5))
            return false;
        return SecureEquals(status.ReceiptMac, TerminalReceiptMac(status with { ReceiptMac = null }, receiptSecret));
    }

    public static string TerminalReceiptMac(RuntimeSwitchStatus status, string receiptSecret)
    {
        if (status.ReceiptExpiresAtUnixMs is null) throw new InvalidDataException("The runtime switch receipt expiry is missing.");
        var payload = string.Join("\n", new[]
        {
            status.Schema.ToString(System.Globalization.CultureInfo.InvariantCulture),
            status.Status,
            status.TargetVariant,
            status.Nonce,
            status.TokenSha256,
            status.ProofSha256,
            Path.GetFullPath(status.CurrentAppPath),
            status.ErrorCode ?? string.Empty,
            status.Message ?? string.Empty,
            status.UpdatedAtUtc.ToUnixTimeMilliseconds().ToString(System.Globalization.CultureInfo.InvariantCulture),
            status.ReceiptExpiresAtUnixMs.Value.ToString(System.Globalization.CultureInfo.InvariantCulture),
        });
        return Convert.ToHexString(HMACSHA256.HashData(System.Text.Encoding.UTF8.GetBytes(receiptSecret), System.Text.Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();
    }

    private static bool SecureEquals(string? left, string right) =>
        left is not null && left.Length == right.Length && CryptographicOperations.FixedTimeEquals(System.Text.Encoding.UTF8.GetBytes(left), System.Text.Encoding.UTF8.GetBytes(right));

    private static bool PathsEqual(string left, string right) => string.Equals(Path.GetFullPath(left).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), Path.GetFullPath(right).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), StringComparison.OrdinalIgnoreCase);
}
