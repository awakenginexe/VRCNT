using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;
using VRCNT.RuntimeCore.Models;
using VRCNT.RuntimeCore.Process;

namespace VRCNT.RuntimeCore.Transactions;

/// <summary>One local, single-use proof emitted by the activation backend after readiness succeeds.</summary>
public sealed record RuntimeActivationProof(
    int ProtocolVersion,
    string Status,
    string Token,
    string Nonce,
    int BackendPid,
    string AppVersion,
    string RuntimeVariant);

/// <summary>
/// Owns the manager-side named-pipe endpoint.  A launched process alone cannot commit:
/// it must deliver a complete proof from its actual pipe-client process before this bounded wait expires.
/// </summary>
public sealed class NamedPipeRuntimeActivationHealthMonitor : IRuntimeActivationHealthMonitor
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };
    private readonly TimeSpan _timeout;
    private readonly Func<uint, string?> _clientExecutablePathResolver;

    public NamedPipeRuntimeActivationHealthMonitor(TimeSpan? timeout = null)
        : this(timeout, ResolveClientExecutablePath) { }

    // Tests supply a deterministic process-image lookup; installer production always uses the Windows process image.
    public NamedPipeRuntimeActivationHealthMonitor(TimeSpan? timeout, Func<uint, string?> clientExecutablePathResolver)
    {
        _timeout = timeout ?? TimeSpan.FromSeconds(30);
        _clientExecutablePathResolver = clientExecutablePathResolver ?? throw new ArgumentNullException(nameof(clientExecutablePathResolver));
    }

    public async Task<RuntimeActivationHealthResult> WaitForReadyAsync(string installPath, RuntimeIdentity expectedIdentity, ActivationRequest request, CancellationToken cancellationToken)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(_timeout);
        try
        {
            await using var server = new NamedPipeServerStream(
                request.PipeName, PipeDirection.In, 1, PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
            await server.WaitForConnectionAsync(deadline.Token);
            if (!GetNamedPipeClientProcessId(server.SafePipeHandle, out var clientProcessId))
                return Fail("activation_invalid_proof");

            using var reader = new StreamReader(server, Encoding.UTF8, false, 4096, leaveOpen: true);
            var line = await reader.ReadLineAsync(deadline.Token);
            var proof = string.IsNullOrWhiteSpace(line) ? null : JsonSerializer.Deserialize<RuntimeActivationProof>(line, Json);
            return IsValid(proof, clientProcessId, installPath, expectedIdentity, request)
                ? new RuntimeActivationHealthResult(true, false, null)
                : Fail("activation_invalid_proof");
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return Fail("activation_timeout");
        }
        catch (JsonException)
        {
            return Fail("activation_invalid_proof");
        }
        catch (IOException)
        {
            return Fail("activation_invalid_proof");
        }
    }

    private bool IsValid(RuntimeActivationProof? proof, uint clientProcessId, string installPath, RuntimeIdentity expectedIdentity, ActivationRequest request) =>
        proof is not null
        && proof.ProtocolVersion == 1
        && string.Equals(proof.Status, "ready", StringComparison.Ordinal)
        && FixedTimeEquals(proof.Token, request.SingleUseToken)
        && FixedTimeEquals(proof.Nonce, request.Nonce)
        && proof.BackendPid > 0
        && proof.BackendPid == clientProcessId
        && ClientRunsStagedBackend(clientProcessId, installPath)
        && string.Equals(proof.AppVersion, expectedIdentity.Version, StringComparison.Ordinal)
        && string.Equals(proof.RuntimeVariant, expectedIdentity.Variant == RuntimeVariant.Cuda ? "cuda" : "cpu", StringComparison.Ordinal);

    private bool ClientRunsStagedBackend(uint clientProcessId, string installPath)
    {
        try
        {
            var clientPath = _clientExecutablePathResolver(clientProcessId);
            var expectedPath = Path.GetFullPath(Path.Combine(installPath, "VRCNT-backend.exe"));
            return !string.IsNullOrWhiteSpace(clientPath)
                && File.Exists(expectedPath)
                && string.Equals(Path.GetFullPath(clientPath), expectedPath, StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception exception) when (exception is ArgumentException or IOException or UnauthorizedAccessException or System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            return false;
        }
    }

    private static string? ResolveClientExecutablePath(uint clientProcessId)
    {
        try
        {
            using var client = System.Diagnostics.Process.GetProcessById(checked((int)clientProcessId));
            return client.MainModule?.FileName;
        }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception or OverflowException)
        {
            return null;
        }
    }

    private static bool FixedTimeEquals(string? candidate, string expected) =>
        candidate is not null && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(candidate), Encoding.UTF8.GetBytes(expected));

    private static RuntimeActivationHealthResult Fail(string errorCode) => new(false, false, errorCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint clientProcessId);
}
