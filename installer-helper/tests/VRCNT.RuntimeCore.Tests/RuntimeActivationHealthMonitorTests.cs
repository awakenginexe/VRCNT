using System.IO.Pipes;
using System.Text.Json;
using VRCNT.RuntimeCore.Models;
using VRCNT.RuntimeCore.Process;
using VRCNT.RuntimeCore.Transactions;
using Xunit;

namespace VRCNT.RuntimeCore.Tests;

public sealed class RuntimeActivationHealthMonitorTests
{
    private static readonly RuntimeIdentity Identity = new("VRCNT", "5.15.0", RuntimeVariant.Cpu, "x64", "build", new string('a', 64));

    [Fact]
    public async Task WaitForReadyAsync_accepts_one_complete_proof_from_the_pipe_client_process()
    {
        var request = Request();
        var monitor = new NamedPipeRuntimeActivationHealthMonitor(TimeSpan.FromSeconds(2));
        var waiting = monitor.WaitForReadyAsync("unused", Identity, request, default);

        await SendProofAsync(request, new RuntimeActivationProof(1, "ready", request.SingleUseToken, request.Nonce, Environment.ProcessId, "5.15.0", "cpu"));

        var result = await waiting;
        Assert.True(result.Ready);
        Assert.Null(result.ErrorCode);
    }

    [Theory]
    [InlineData("wrong-token", "nonce", 0, "5.15.0", "cpu")]
    [InlineData("token", "wrong-nonce", 0, "5.15.0", "cpu")]
    [InlineData("token", "nonce", 0, "5.14.0", "cpu")]
    [InlineData("token", "nonce", 0, "5.15.0", "cuda")]
    [InlineData("token", "nonce", 1, "5.15.0", "cpu")]
    public async Task WaitForReadyAsync_rejects_invalid_identity_bound_proofs(string token, string nonce, int ignoredPid, string version, string variant)
    {
        var request = Request();
        var monitor = new NamedPipeRuntimeActivationHealthMonitor(TimeSpan.FromSeconds(2));
        var waiting = monitor.WaitForReadyAsync("unused", Identity, request, default);

        await SendProofAsync(request, new RuntimeActivationProof(1, "ready", token, nonce, Environment.ProcessId + ignoredPid, version, variant));

        var result = await waiting;
        Assert.False(result.Ready);
        Assert.NotNull(result.ErrorCode);
    }

    [Fact]
    public async Task WaitForReadyAsync_fails_closed_when_process_launch_produces_no_proof()
    {
        var monitor = new NamedPipeRuntimeActivationHealthMonitor(TimeSpan.FromMilliseconds(50));

        var result = await monitor.WaitForReadyAsync("unused", Identity, Request(), default);

        Assert.False(result.Ready);
        Assert.Equal("activation_timeout", result.ErrorCode);
    }

    private static ActivationRequest Request() => new($"vrcnt-activation-{Guid.NewGuid():N}", "token", "nonce");

    private static async Task SendProofAsync(ActivationRequest request, RuntimeActivationProof proof)
    {
        using var client = new NamedPipeClientStream(".", request.PipeName, PipeDirection.Out, PipeOptions.Asynchronous);
        await client.ConnectAsync(2000);
        await using var writer = new StreamWriter(client) { AutoFlush = true };
        await writer.WriteLineAsync(JsonSerializer.Serialize(proof));
    }
}
