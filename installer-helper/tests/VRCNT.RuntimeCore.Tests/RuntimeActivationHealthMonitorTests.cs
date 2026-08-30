using System.IO.Pipes;
using System.Text.Json;
using VRCNT.RuntimeCore.Models;
using VRCNT.RuntimeCore.Process;
using VRCNT.RuntimeCore.Transactions;
using Xunit;

namespace VRCNT.RuntimeCore.Tests;

public sealed class RuntimeActivationHealthMonitorTests : IDisposable
{
    private static readonly RuntimeIdentity Identity = new("VRCNT", "5.15.0", RuntimeVariant.Cpu, "x64", "build", new string('a', 64));
    private readonly string _installPath = Path.Combine(Path.GetTempPath(), "vrcnt-runtime-activation", Guid.NewGuid().ToString("N"));

    public RuntimeActivationHealthMonitorTests()
    {
        Directory.CreateDirectory(_installPath);
        File.WriteAllText(Path.Combine(_installPath, "VRCNT-backend.exe"), "staged backend");
    }

    [Fact]
    public async Task WaitForReadyAsync_accepts_one_complete_proof_from_the_pipe_client_process()
    {
        var request = Request();
        var monitor = new NamedPipeRuntimeActivationHealthMonitor(TimeSpan.FromSeconds(2), _ => StagedBackendPath());
        var waiting = monitor.WaitForReadyAsync(_installPath, Identity, request, default);

        await SendProofAsync(request, new RuntimeActivationProof(1, "ready", request.SingleUseToken, request.Nonce, Environment.ProcessId, "5.15.0", "cpu"));

        var result = await waiting;
        Assert.True(result.Ready);
        Assert.Null(result.ErrorCode);
    }

    [Theory]
    [InlineData("wrong-token", "nonce", 0, "5.15.0", "cpu", "activation_invalid_proof_token")]
    [InlineData("token", "wrong-nonce", 0, "5.15.0", "cpu", "activation_invalid_proof_nonce")]
    [InlineData("token", "nonce", 0, "5.14.0", "cpu", "activation_invalid_proof_version")]
    [InlineData("token", "nonce", 0, "5.15.0", "cuda", "activation_invalid_proof_variant")]
    [InlineData("token", "nonce", 1, "5.15.0", "cpu", "activation_invalid_proof_backend_pid")]
    public async Task WaitForReadyAsync_reports_the_failed_identity_bound_proof_predicate(string token, string nonce, int ignoredPid, string version, string variant, string expectedErrorCode)
    {
        var request = Request();
        var monitor = new NamedPipeRuntimeActivationHealthMonitor(TimeSpan.FromSeconds(2), _ => StagedBackendPath());
        var waiting = monitor.WaitForReadyAsync(_installPath, Identity, request, default);

        await SendProofAsync(request, new RuntimeActivationProof(1, "ready", token, nonce, Environment.ProcessId + ignoredPid, version, variant));

        var result = await waiting;
        Assert.False(result.Ready);
        Assert.Equal(expectedErrorCode, result.ErrorCode);
    }

    [Fact]
    public async Task WaitForReadyAsync_reports_a_malformed_proof_payload()
    {
        var request = Request();
        var monitor = new NamedPipeRuntimeActivationHealthMonitor(TimeSpan.FromSeconds(2), _ => StagedBackendPath());
        var waiting = monitor.WaitForReadyAsync(_installPath, Identity, request, default);

        await SendPayloadAsync(request, "\n");

        var result = await waiting;
        Assert.False(result.Ready);
        Assert.Equal("activation_invalid_proof_payload", result.ErrorCode);
    }

    [Fact]
    public async Task WaitForReadyAsync_fails_closed_when_process_launch_produces_no_proof()
    {
        var monitor = new NamedPipeRuntimeActivationHealthMonitor(TimeSpan.FromMilliseconds(50), _ => StagedBackendPath());

        var result = await monitor.WaitForReadyAsync(_installPath, Identity, Request(), default);

        Assert.False(result.Ready);
        Assert.Equal("activation_timeout", result.ErrorCode);
    }

    [Fact]
    public async Task WaitForReadyAsync_rejects_a_forged_same_user_pipe_client_even_when_its_proof_claims_the_backend_pid()
    {
        var request = Request();
        // This test process is the actual same-user pipe client, but is not the staged backend executable.
        var monitor = new NamedPipeRuntimeActivationHealthMonitor(TimeSpan.FromSeconds(2));
        var waiting = monitor.WaitForReadyAsync(_installPath, Identity, request, default);

        await SendProofAsync(request, new RuntimeActivationProof(1, "ready", request.SingleUseToken, request.Nonce, Environment.ProcessId, "5.15.0", "cpu"));

        var result = await waiting;
        Assert.False(result.Ready);
        Assert.Equal("activation_invalid_proof_backend_path", result.ErrorCode);
    }

    public void Dispose()
    {
        if (Directory.Exists(_installPath)) Directory.Delete(_installPath, true);
    }

    private static ActivationRequest Request() => new($"vrcnt-activation-{Guid.NewGuid():N}", "token", "nonce");

    private string StagedBackendPath() => Path.Combine(_installPath, "VRCNT-backend.exe");

    private static async Task SendProofAsync(ActivationRequest request, RuntimeActivationProof proof)
    {
        using var client = new NamedPipeClientStream(".", request.PipeName, PipeDirection.Out, PipeOptions.Asynchronous);
        await client.ConnectAsync(2000);
        await using var writer = new StreamWriter(client) { AutoFlush = true };
        await writer.WriteLineAsync(JsonSerializer.Serialize(proof));
    }

    private static async Task SendPayloadAsync(ActivationRequest request, string payload)
    {
        using var client = new NamedPipeClientStream(".", request.PipeName, PipeDirection.Out, PipeOptions.Asynchronous);
        await client.ConnectAsync(2000);
        await using var writer = new StreamWriter(client) { AutoFlush = true };
        await writer.WriteAsync(payload);
    }
}
