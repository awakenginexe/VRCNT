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
    private const int MaxActivationPayloadBytes = 4096;
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
                return Fail("activation_invalid_proof_client_pid");

            var proof = await ReadSingleProofAsync(server, deadline.Token);
            var failureCode = ValidateProof(proof, clientProcessId, installPath, expectedIdentity, request);
            return failureCode is null
                ? new RuntimeActivationHealthResult(true, false, null)
                : Fail(failureCode);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return Fail("activation_timeout");
        }
        catch (JsonException)
        {
            return Fail("activation_invalid_proof_payload");
        }
        catch (DecoderFallbackException)
        {
            return Fail("activation_invalid_proof_payload");
        }
        catch (IOException)
        {
            return Fail("activation_invalid_proof_transport");
        }
    }

    private static async Task<RuntimeActivationProof?> ReadSingleProofAsync(Stream stream, CancellationToken cancellationToken)
    {
        var buffer = new byte[1024];
        using var payload = new MemoryStream();
        while (true)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(), cancellationToken);
            if (read == 0) break;
            if (payload.Length + read > MaxActivationPayloadBytes) return null;
            payload.Write(buffer, 0, read);
        }

        var text = new UTF8Encoding(false, true).GetString(payload.GetBuffer(), 0, checked((int)payload.Length));
        var newline = text.IndexOf('\n');
        if (newline >= 0)
        {
            // The one protocol frame may end with LF or CRLF; every later byte is rejected.
            if (newline != text.Length - 1) return null;
            text = text[..newline];
            if (text.EndsWith('\r')) text = text[..^1];
        }
        if (string.IsNullOrWhiteSpace(text)) return null;
        return JsonSerializer.Deserialize<RuntimeActivationProof>(text, Json);
    }

    private string? ValidateProof(RuntimeActivationProof? proof, uint clientProcessId, string installPath, RuntimeIdentity expectedIdentity, ActivationRequest request)
    {
        if (proof is null) return "activation_invalid_proof_payload";
        if (proof.ProtocolVersion != 1) return "activation_invalid_proof_protocol";
        if (!string.Equals(proof.Status, "ready", StringComparison.Ordinal)) return "activation_invalid_proof_status";
        if (!FixedTimeEquals(proof.Token, request.SingleUseToken)) return "activation_invalid_proof_token";
        if (!FixedTimeEquals(proof.Nonce, request.Nonce)) return "activation_invalid_proof_nonce";
        if (proof.BackendPid <= 0 || proof.BackendPid != clientProcessId) return "activation_invalid_proof_backend_pid";
        if (!ClientRunsStagedBackend(clientProcessId, installPath)) return "activation_invalid_proof_backend_path";
        if (!string.Equals(proof.AppVersion, expectedIdentity.Version, StringComparison.Ordinal)) return "activation_invalid_proof_version";
        if (!string.Equals(proof.RuntimeVariant, expectedIdentity.Variant == RuntimeVariant.Cuda ? "cuda" : "cpu", StringComparison.Ordinal)) return "activation_invalid_proof_variant";
        return null;
    }

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
