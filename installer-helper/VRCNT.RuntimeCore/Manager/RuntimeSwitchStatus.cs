using System.Security.Cryptography;
using System.Runtime.InteropServices;
using System.Text;
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
    string InstallPath,
    string? ErrorCode,
    string? Message,
    DateTimeOffset UpdatedAtUtc,
    int? ManagerProcessId = null,
    DateTimeOffset? HandoffExpiresAtUtc = null,
    string? ReceiptMac = null,
    long? ReceiptExpiresAtUnixMs = null,
    DateTimeOffset? ConsumedAtUtc = null,
    long LeaseGeneration = 0);

public sealed record RuntimeSwitchReceiptBinding(
    string Nonce,
    string TargetVariant,
    string InstallPath,
    string CurrentAppPath,
    string Token,
    string TokenSha256,
    string ProofSha256,
    long LeaseGeneration,
    string ReceiptSecret,
    long ReceiptExpiresAtUnixMs);

public sealed class RuntimeSwitchStatusStore
{
    private const int Schema = 1;
    private const string FileName = "runtime-switch-status.json";
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };
    private readonly string _dataRoot;
    private readonly string _statusPath;
    private readonly string _lockName;

    public RuntimeSwitchStatusStore(string dataRoot, string statusPath)
    {
        _dataRoot = Path.GetFullPath(dataRoot);
        _statusPath = Path.GetFullPath(statusPath);
        _lockName = $"Local\\VRCNT.RuntimeSwitch.{Hash(_dataRoot.ToUpperInvariant())}";
        var expected = Path.Combine(_dataRoot, FileName);
        if (!PathsEqual(_statusPath, expected)) throw new InvalidDataException("The runtime switch status path is not the validated data-root status location.");
    }

    public RuntimeSwitchStatus Read()
        => WithLock(ReadUnsafe);

    private RuntimeSwitchStatus ReadUnsafe()
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
        return WithLock(() => ValidatePendingUnsafe(targetVariant, installPath, currentAppPath, token));
    }

    private RuntimeShutdownHandoff ValidatePendingUnsafe(string targetVariant, string installPath, string currentAppPath, string token)
    {
        var target = targetVariant.ToLowerInvariant() switch
        {
            "cpu" => RuntimeVariant.Cpu,
            "cuda" => RuntimeVariant.Cuda,
            _ => throw new InvalidDataException("The runtime switch target is invalid."),
        };
        if (string.IsNullOrWhiteSpace(token)) throw new InvalidDataException("The runtime switch handoff token is missing.");
        var status = ReadUnsafe();
        var normalizedTarget = target == RuntimeVariant.Cuda ? "cuda" : "cpu";
        var expectedApp = Path.GetFullPath(Path.Combine(installPath, "VRCNT.exe"));
        var expectedProof = Proof(token, status.Nonce, normalizedTarget, expectedApp);
        if (status.Schema != Schema || !string.Equals(status.Status, "pending", StringComparison.Ordinal) ||
            !string.Equals(status.TargetVariant, normalizedTarget, StringComparison.Ordinal) ||
            string.IsNullOrWhiteSpace(status.Nonce) || !SecureEquals(status.TokenSha256, Hash(token)) ||
            !SecureEquals(status.ProofSha256, expectedProof))
            throw new InvalidDataException("The runtime switch handoff is stale or unauthenticated.");

        if (string.IsNullOrWhiteSpace(status.InstallPath) || !PathsEqual(status.InstallPath, Path.GetFullPath(installPath)) || !PathsEqual(status.CurrentAppPath, expectedApp) || !PathsEqual(currentAppPath, expectedApp))
            throw new InvalidDataException("The runtime switch current application identity is invalid.");
        return new RuntimeShutdownHandoff(status.Nonce, token, expectedProof, target, _statusPath, expectedApp, status.LeaseGeneration, Path.GetFullPath(installPath));
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
                && status.LeaseGeneration == handoff.LeaseGeneration
                && PathsEqual(status.CurrentAppPath, handoff.CurrentAppPath)
                && PathsEqual(status.InstallPath, handoff.ResolvedInstallPath);
        }
        catch (InvalidDataException)
        {
            return false;
        }
    }

    public void WriteTerminal(string status, string targetVariant, RuntimeShutdownHandoff handoff, string? errorCode, string? message)
    {
        var binding = ReadReceiptBinding(handoff);
        WriteTerminal(status, targetVariant, handoff, errorCode, message, binding.ReceiptSecret, DateTimeOffset.FromUnixTimeMilliseconds(binding.ReceiptExpiresAtUnixMs));
    }

    public void WriteTerminal(string status, string targetVariant, RuntimeShutdownHandoff handoff, string? errorCode, string? message, string receiptSecret, DateTimeOffset? receiptExpiresAtUtc = null)
    {
        if (status is not ("succeeded" or "failed" or "cancelled" or "stale")) throw new ArgumentException("Invalid terminal switch status.", nameof(status));
        if (string.IsNullOrWhiteSpace(receiptSecret) || SecureEquals(receiptSecret, handoff.Token)) throw new InvalidDataException("The runtime switch receipt credential is invalid.");
        WithLock(() =>
        {
            var binding = ReadReceiptBindingUnsafe(handoff, DateTimeOffset.UtcNow);
            if (!SecureEquals(binding.ReceiptSecret, receiptSecret)) throw new InvalidDataException("The runtime switch receipt credential does not match the protected transaction binding.");
            var current = ReadUnsafe();
            EnsureActiveLeaseOwner(current, targetVariant, handoff);
            var now = DateTimeOffset.UtcNow;
            var expiresAtUtc = receiptExpiresAtUtc ?? DateTimeOffset.FromUnixTimeMilliseconds(binding.ReceiptExpiresAtUnixMs);
            if (expiresAtUtc.ToUnixTimeMilliseconds() > binding.ReceiptExpiresAtUnixMs)
                throw new InvalidDataException("The runtime switch receipt expiry exceeds the protected transaction binding.");
            var record = new RuntimeSwitchStatus(
                Schema, status, targetVariant, handoff.Nonce, Hash(handoff.Token), handoff.Proof,
                handoff.CurrentAppPath, handoff.ResolvedInstallPath, errorCode, message, now,
                current.ManagerProcessId, current.HandoffExpiresAtUtc, null,
                expiresAtUtc.ToUnixTimeMilliseconds(), null, handoff.LeaseGeneration);
            WriteRecordUnsafe(record with { ReceiptMac = TerminalReceiptMac(record, receiptSecret) });
        });
    }

    public RuntimeSwitchReceiptBinding ReadReceiptBinding(RuntimeShutdownHandoff handoff)
        => WithLock(() => ReadReceiptBindingUnsafe(handoff, DateTimeOffset.UtcNow));

    public void ClearForRetry(RuntimeShutdownHandoff handoff)
    {
        WithLock(() =>
        {
            var current = ReadUnsafe();
            EnsureActiveLeaseOwner(current, VariantName(handoff.TargetVariant), handoff);
            if (current.Status is "shutdown_acknowledged" or "succeeded")
                throw new InvalidDataException("The runtime switch has already stopped the application and cannot be cleared for retry.");
            File.Delete(_statusPath);
            var bindingPath = ReceiptBindingPath(handoff.Nonce);
            if (File.Exists(bindingPath)) File.Delete(bindingPath);
        });
    }

    private void Write(string status, string targetVariant, RuntimeShutdownHandoff handoff, string? errorCode, string? message)
    {
        WithLock(() =>
        {
            var current = ReadUnsafe();
            EnsureActiveLeaseOwner(current, targetVariant, handoff);
            var now = DateTimeOffset.UtcNow;
            WriteRecordUnsafe(new RuntimeSwitchStatus(
                Schema, status, targetVariant, handoff.Nonce, Hash(handoff.Token), handoff.Proof,
                handoff.CurrentAppPath, handoff.ResolvedInstallPath, errorCode, message, now, Environment.ProcessId,
                now.AddMinutes(5), null, null, null, handoff.LeaseGeneration));
        });
    }

    private static string VariantName(RuntimeVariant variant) => variant == RuntimeVariant.Cuda ? "cuda" : "cpu";

    private void WriteRecordUnsafe(RuntimeSwitchStatus record)
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
            !PathsEqual(status.InstallPath, Path.GetDirectoryName(Path.GetFullPath(currentAppPath)) ?? string.Empty) ||
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
            Path.GetFullPath(status.InstallPath),
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

    private void EnsureActiveLeaseOwner(RuntimeSwitchStatus current, string targetVariant, RuntimeShutdownHandoff handoff)
    {
        if (current.Status is "succeeded" or "failed" or "cancelled" or "stale" ||
            current.LeaseGeneration != handoff.LeaseGeneration ||
            !string.Equals(current.Nonce, handoff.Nonce, StringComparison.Ordinal) ||
            !string.Equals(current.TargetVariant, targetVariant, StringComparison.Ordinal) ||
            !SecureEquals(current.TokenSha256, Hash(handoff.Token)) ||
            !SecureEquals(current.ProofSha256, handoff.Proof) ||
            !PathsEqual(current.InstallPath, handoff.ResolvedInstallPath) ||
            (current.ManagerProcessId is not null && current.ManagerProcessId != Environment.ProcessId) ||
            !PathsEqual(current.CurrentAppPath, handoff.CurrentAppPath))
            throw new InvalidDataException("The runtime switch lease was revoked or replaced.");
    }

    private RuntimeSwitchReceiptBinding ReadReceiptBindingUnsafe(RuntimeShutdownHandoff handoff, DateTimeOffset now)
    {
        var path = ReceiptBindingPath(handoff.Nonce);
        ProtectedReceiptBindingRecord outer;
        try
        {
            outer = JsonSerializer.Deserialize<ProtectedReceiptBindingRecord>(File.ReadAllText(path), JsonOptions)
                ?? throw new InvalidDataException("The protected runtime switch binding is empty.");
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException or InvalidDataException)
        {
            throw new InvalidDataException("The protected runtime switch binding is unavailable or malformed.", exception);
        }
        if (outer.Schema != Schema || string.IsNullOrWhiteSpace(outer.Nonce) || string.IsNullOrWhiteSpace(outer.ProtectedBinding) ||
            !string.Equals(outer.Nonce, handoff.Nonce, StringComparison.Ordinal))
            throw new InvalidDataException("The protected runtime switch binding does not match the transaction.");
        ReceiptBindingPayload payload;
        try
        {
            payload = JsonSerializer.Deserialize<ReceiptBindingPayload>(
                Unprotect(Convert.FromBase64String(outer.ProtectedBinding)), JsonOptions)
                ?? throw new InvalidDataException("The protected runtime switch binding is empty.");
        }
        catch (Exception exception) when (exception is FormatException or CryptographicException or IOException or UnauthorizedAccessException or JsonException or InvalidDataException)
        {
            throw new InvalidDataException("The protected runtime switch binding is unavailable or malformed.", exception);
        }
        var expectedInstall = handoff.ResolvedInstallPath;
        var expectedApp = Path.GetFullPath(handoff.CurrentAppPath);
        var expectedTarget = VariantName(handoff.TargetVariant);
        if (payload.Schema != Schema || string.IsNullOrWhiteSpace(payload.Nonce) || string.IsNullOrWhiteSpace(payload.TargetVariant) ||
            string.IsNullOrWhiteSpace(payload.InstallPath) || string.IsNullOrWhiteSpace(payload.CurrentAppPath) ||
            string.IsNullOrWhiteSpace(payload.Token) || string.IsNullOrWhiteSpace(payload.TokenSha256) ||
            string.IsNullOrWhiteSpace(payload.ProofSha256) || payload.Nonce != handoff.Nonce || payload.TargetVariant != expectedTarget ||
            !PathsEqual(payload.InstallPath, expectedInstall) || !PathsEqual(payload.CurrentAppPath, expectedApp) ||
            payload.TokenSha256 != Hash(payload.Token) || payload.ProofSha256 != Proof(payload.Token, payload.Nonce, payload.TargetVariant, payload.CurrentAppPath) ||
            payload.TokenSha256 != Hash(handoff.Token) || payload.ProofSha256 != handoff.Proof ||
            payload.LeaseGeneration != handoff.LeaseGeneration || string.IsNullOrWhiteSpace(payload.ReceiptSecret) ||
            payload.ReceiptSecret.Length < 32 || SecureEquals(payload.ReceiptSecret, payload.Token) ||
            payload.ReceiptExpiresAtUnixMs <= now.ToUnixTimeMilliseconds() ||
            payload.ReceiptExpiresAtUnixMs > now.AddHours(24).ToUnixTimeMilliseconds())
            throw new InvalidDataException("The protected runtime switch binding is invalid or expired.");
        return new RuntimeSwitchReceiptBinding(payload.Nonce, payload.TargetVariant, expectedInstall, expectedApp, payload.Token, payload.TokenSha256, payload.ProofSha256, payload.LeaseGeneration, payload.ReceiptSecret, payload.ReceiptExpiresAtUnixMs);
    }

    private string ReceiptBindingPath(string nonce)
    {
        if (string.IsNullOrWhiteSpace(nonce) || nonce.Any(character => !char.IsLetterOrDigit(character) && character != '-'))
            throw new InvalidDataException("The runtime switch receipt nonce is invalid.");
        return Path.Combine(_dataRoot, $"runtime-switch-receipt-{nonce}.json");
    }

    private static byte[] Unprotect(byte[] value)
    {
        var input = new DataBlob { Length = (uint)value.Length, Data = Marshal.AllocHGlobal(value.Length) };
        try
        {
            Marshal.Copy(value, 0, input.Data, value.Length);
            if (CryptUnprotectData(ref input, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out var output) == 0)
                throw new InvalidDataException("The protected runtime switch binding could not be opened.");
            try
            {
                var result = new byte[output.Length];
                Marshal.Copy(output.Data, result, 0, result.Length);
                return result;
            }
            finally { LocalFree(output.Data); }
        }
        finally { Marshal.FreeHGlobal(input.Data); }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DataBlob { public uint Length; public IntPtr Data; }

    [DllImport("crypt32.dll", SetLastError = true)]
    private static extern int CryptUnprotectData(ref DataBlob input, IntPtr description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out DataBlob output);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);

    private sealed record ProtectedReceiptBindingRecord(int Schema, string? Nonce, string? ProtectedBinding);

    private sealed record ReceiptBindingPayload(
        int Schema,
        string? Nonce,
        string? TargetVariant,
        string? InstallPath,
        string? CurrentAppPath,
        string? Token,
        string? TokenSha256,
        string? ProofSha256,
        long LeaseGeneration,
        string? ReceiptSecret,
        long ReceiptExpiresAtUnixMs);

    private T WithLock<T>(Func<T> action)
    {
        Directory.CreateDirectory(_dataRoot);
        using var mutex = new Mutex(false, _lockName);
        try
        {
            mutex.WaitOne();
        }
        catch (AbandonedMutexException)
        {
            // The abandoned owner is precisely the recovery case; the mutex is acquired.
        }
        try { return action(); }
        finally { mutex.ReleaseMutex(); }
    }

    private void WithLock(Action action) => WithLock(() => { action(); return true; });
}
