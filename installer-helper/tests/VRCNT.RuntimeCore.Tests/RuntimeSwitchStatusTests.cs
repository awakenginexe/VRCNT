using System.Text.Json;
using VRCNT.RuntimeCore.Manager;
using Xunit;

namespace VRCNT.RuntimeCore.Tests;

public sealed class RuntimeSwitchStatusTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "vrcnt-runtime-switch-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public void ValidatePending_authenticates_target_token_proof_and_current_executable()
    {
        var installPath = Path.Combine(_root, "VRCNT");
        var appPath = Path.Combine(installPath, "VRCNT.exe");
        var statusPath = WritePending("cuda", appPath, "nonce", "token");
        var store = new RuntimeSwitchStatusStore(Path.Combine(_root, "VRCNTData"), statusPath);

        var handoff = store.ValidatePending("cuda", installPath, appPath, "token");

        Assert.Equal("nonce", handoff.Nonce);
        Assert.Equal(RuntimeSwitchStatusStore.Proof("token", "nonce", "cuda", appPath), handoff.Proof);
    }

    [Theory]
    [InlineData("TargetVariant")]
    [InlineData("TokenSha256")]
    [InlineData("ProofSha256")]
    [InlineData("CurrentAppPath")]
    public void ValidatePending_rejects_tampered_authenticated_fields(string field)
    {
        var installPath = Path.Combine(_root, "VRCNT");
        var appPath = Path.Combine(installPath, "VRCNT.exe");
        var statusPath = WritePending("cuda", appPath, "nonce", "token");
        var json = JsonDocument.Parse(File.ReadAllText(statusPath)).RootElement.Clone();
        var values = json.EnumerateObject().ToDictionary(property => property.Name, property => property.Value.Clone());
        values[field] = JsonSerializer.SerializeToElement(field == "TargetVariant" ? "cpu" : "tampered");
        File.WriteAllText(statusPath, JsonSerializer.Serialize(values));
        var store = new RuntimeSwitchStatusStore(Path.Combine(_root, "VRCNTData"), statusPath);

        Assert.Throws<InvalidDataException>(() => store.ValidatePending("cuda", installPath, appPath, "token"));
    }

    [Fact]
    public void WriteTerminal_clears_acceptance_state_with_a_localized_error_payload()
    {
        var installPath = Path.Combine(_root, "VRCNT");
        var appPath = Path.Combine(installPath, "VRCNT.exe");
        var statusPath = WritePending("cuda", appPath, "nonce", "token");
        var store = new RuntimeSwitchStatusStore(Path.Combine(_root, "VRCNTData"), statusPath);
        var handoff = store.ValidatePending("cuda", installPath, appPath, "token");

        store.WriteAccepted("cuda", handoff);
        store.WriteTerminal("failed", "cuda", handoff, "preflight_rejected", "Retry runtime recovery.");

        var terminal = store.Read();
        Assert.Equal("failed", terminal.Status);
        Assert.Equal("preflight_rejected", terminal.ErrorCode);
        Assert.Equal("Retry runtime recovery.", terminal.Message);
    }

    [Fact]
    public void Terminal_receipt_is_bound_to_the_switch_secret_and_current_installation()
    {
        var installPath = Path.Combine(_root, "VRCNT");
        var appPath = Path.Combine(installPath, "VRCNT.exe");
        var statusPath = WritePending("cuda", appPath, "nonce", "token");
        var store = new RuntimeSwitchStatusStore(Path.Combine(_root, "VRCNTData"), statusPath);
        var handoff = store.ValidatePending("cuda", installPath, appPath, "token");

        store.WriteTerminal("failed", "cuda", handoff, "activation_unhealthy", "The CUDA runtime was rolled back.", ReceiptBindingTestHelper.DefaultSecret);
        var terminal = store.Read();

        Assert.True(RuntimeSwitchStatusStore.VerifyTerminalReceipt(terminal, ReceiptBindingTestHelper.DefaultSecret, appPath, DateTimeOffset.UtcNow));
        Assert.False(RuntimeSwitchStatusStore.VerifyTerminalReceipt(terminal, "forged-secret", appPath, DateTimeOffset.UtcNow));
        Assert.False(RuntimeSwitchStatusStore.VerifyTerminalReceipt(terminal, ReceiptBindingTestHelper.DefaultSecret, Path.Combine(_root, "other", "VRCNT.exe"), DateTimeOffset.UtcNow));
    }

    [Fact]
    public void Terminal_receipt_rejects_expiry_and_replay_markers()
    {
        var installPath = Path.Combine(_root, "VRCNT");
        var appPath = Path.Combine(installPath, "VRCNT.exe");
        var statusPath = WritePending("cuda", appPath, "nonce", "token");
        var store = new RuntimeSwitchStatusStore(Path.Combine(_root, "VRCNTData"), statusPath);
        var handoff = store.ValidatePending("cuda", installPath, appPath, "token");

        store.WriteTerminal("failed", "cuda", handoff, "activation_unhealthy", "The CUDA runtime was rolled back.", ReceiptBindingTestHelper.DefaultSecret, DateTimeOffset.UtcNow - TimeSpan.FromMinutes(1));
        var expired = store.Read();

        Assert.False(RuntimeSwitchStatusStore.VerifyTerminalReceipt(expired, ReceiptBindingTestHelper.DefaultSecret, appPath, DateTimeOffset.UtcNow));
        Assert.Null(expired.ConsumedAtUtc);
    }

    [Fact]
    public void A_revoked_manager_cannot_overwrite_a_newer_runtime_switch_request()
    {
        var installPath = Path.Combine(_root, "VRCNT");
        var appPath = Path.Combine(installPath, "VRCNT.exe");
        var statusPath = WritePending("cuda", appPath, "old-nonce", "old-token");
        var oldStore = new RuntimeSwitchStatusStore(Path.Combine(_root, "VRCNTData"), statusPath);
        var oldHandoff = oldStore.ValidatePending("cuda", installPath, appPath, "old-token");
        oldStore.WriteAccepted("cuda", oldHandoff);

        File.WriteAllText(statusPath, JsonSerializer.Serialize(new
        {
            Schema = 1,
            Status = "pending",
            TargetVariant = "cuda",
            Nonce = "new-nonce",
            TokenSha256 = RuntimeSwitchStatusStore.Hash("new-token"),
            ProofSha256 = RuntimeSwitchStatusStore.Proof("new-token", "new-nonce", "cuda", appPath),
            CurrentAppPath = appPath,
            InstallPath = installPath,
            ErrorCode = (string?)null,
            Message = (string?)null,
            UpdatedAtUtc = DateTimeOffset.UtcNow,
            LeaseGeneration = 2,
        }));

        Assert.Throws<InvalidDataException>(() => oldStore.WriteShutdownRequested("cuda", oldHandoff));
        Assert.Equal("new-nonce", oldStore.Read().Nonce);
        Assert.Equal("pending", oldStore.Read().Status);
    }

    [Fact]
    public void The_command_line_handoff_token_cannot_authenticate_a_terminal_receipt()
    {
        var installPath = Path.Combine(_root, "VRCNT");
        var appPath = Path.Combine(installPath, "VRCNT.exe");
        var statusPath = WritePending("cuda", appPath, "nonce", "switch-token");
        var store = new RuntimeSwitchStatusStore(Path.Combine(_root, "VRCNTData"), statusPath);
        var handoff = store.ValidatePending("cuda", installPath, appPath, "switch-token");

        store.WriteTerminal("failed", "cuda", handoff, "preflight_rejected", "Retry runtime recovery.");

        Assert.False(RuntimeSwitchStatusStore.VerifyTerminalReceipt(store.Read(), "switch-token", appPath, DateTimeOffset.UtcNow));
    }

    [Fact]
    public void Terminal_receipt_uses_the_dpapi_protected_transaction_credential_and_binding()
    {
        var installPath = Path.Combine(_root, "VRCNT");
        var appPath = Path.Combine(installPath, "VRCNT.exe");
        var dataRoot = Path.Combine(_root, "VRCNTData");
        var statusPath = WritePending("cuda", appPath, "nonce", "token");
        ReceiptBindingTestHelper.Write(dataRoot, "nonce", "cuda", installPath, appPath, "token", 1, ReceiptBindingTestHelper.DefaultSecret);
        var store = new RuntimeSwitchStatusStore(dataRoot, statusPath);
        var handoff = store.ValidatePending("cuda", installPath, appPath, "token");

        store.WriteTerminal("failed", "cuda", handoff, "preflight_rejected", "Retry runtime recovery.");
        var terminal = store.Read();

        Assert.True(RuntimeSwitchStatusStore.VerifyTerminalReceipt(terminal, ReceiptBindingTestHelper.DefaultSecret, appPath, DateTimeOffset.UtcNow));
        Assert.False(RuntimeSwitchStatusStore.VerifyTerminalReceipt(terminal, "token", appPath, DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task Shutdown_request_requires_a_matching_one_shot_acknowledgement_before_quiesce()
    {
        var installPath = Path.Combine(_root, "VRCNT");
        var appPath = Path.Combine(installPath, "VRCNT.exe");
        var statusPath = WritePending("cuda", appPath, "nonce", "token");
        var store = new RuntimeSwitchStatusStore(Path.Combine(_root, "VRCNTData"), statusPath);
        var handoff = store.ValidatePending("cuda", installPath, appPath, "token");

        store.WriteShutdownRequested("cuda", handoff);
        Assert.Equal("shutdown_requested", store.Read().Status);
        Assert.False(await store.WaitForShutdownAcknowledgementAsync(handoff, TimeSpan.Zero, default));

        store.WriteShutdownAcknowledged("cuda", handoff);

        Assert.True(await store.WaitForShutdownAcknowledgementAsync(handoff, TimeSpan.Zero, default));
    }

    [Fact]
    public async Task Shutdown_acknowledgement_rejects_a_stale_or_terminal_handoff()
    {
        var installPath = Path.Combine(_root, "VRCNT");
        var appPath = Path.Combine(installPath, "VRCNT.exe");
        var statusPath = WritePending("cuda", appPath, "nonce", "token");
        var store = new RuntimeSwitchStatusStore(Path.Combine(_root, "VRCNTData"), statusPath);
        var handoff = store.ValidatePending("cuda", installPath, appPath, "token");

        store.WriteShutdownRequested("cuda", handoff);
        store.WriteTerminal("cancelled", "cuda", handoff, "cancelled", "Runtime switch cancelled.");

        Assert.False(await store.WaitForShutdownAcknowledgementAsync(handoff, TimeSpan.Zero, default));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    private string WritePending(string target, string appPath, string nonce, string token)
    {
        var dataRoot = Path.Combine(_root, "VRCNTData");
        Directory.CreateDirectory(dataRoot);
        var statusPath = Path.Combine(dataRoot, "runtime-switch-status.json");
        File.WriteAllText(statusPath, JsonSerializer.Serialize(new
        {
            Schema = 1,
            Status = "pending",
            TargetVariant = target,
            Nonce = nonce,
            TokenSha256 = RuntimeSwitchStatusStore.Hash(token),
            ProofSha256 = RuntimeSwitchStatusStore.Proof(token, nonce, target, appPath),
            CurrentAppPath = appPath,
            InstallPath = Path.GetDirectoryName(appPath),
            ErrorCode = (string?)null,
            Message = (string?)null,
            UpdatedAtUtc = DateTimeOffset.UtcNow,
            LeaseGeneration = 1,
        }));
        ReceiptBindingTestHelper.Write(Path.Combine(_root, "VRCNTData"), nonce, target, Path.GetDirectoryName(appPath)!, appPath, token, 1, ReceiptBindingTestHelper.DefaultSecret);
        return statusPath;
    }

}
