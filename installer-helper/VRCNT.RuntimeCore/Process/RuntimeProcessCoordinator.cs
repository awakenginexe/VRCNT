using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using VRCNT.RuntimeCore.Manager;
using VRCNT.RuntimeCore.Models;

namespace VRCNT.RuntimeCore.Process;

public sealed record ProcessStopResult(bool Stopped, IReadOnlyList<int> RemainingProcessIds, bool ForceCloseRequired, string? ErrorCode);
public sealed record ActivationRequest(string PipeName, string SingleUseToken, string Nonce);

public interface IRuntimeProcessCoordinator
{
    Task<ProcessStopResult> RequestGracefulStopAsync(CancellationToken cancellationToken);
    Task<bool> AreKnownProcessesStoppedAsync(CancellationToken cancellationToken);
    Task LaunchForActivationAsync(string installPath, RuntimeIdentity expectedIdentity, ActivationRequest request, CancellationToken cancellationToken);
    Task RelaunchActiveRuntimeAsync(CancellationToken cancellationToken);
}

public interface IRuntimeSwitchProcessCoordinator
{
    Task<ProcessStopResult> RequestGracefulStopAsync(RuntimeShutdownHandoff handoff, CancellationToken cancellationToken);
}

public interface IRuntimeProcessForceCloser
{
    Task<ProcessStopResult> ForceCloseRemainingAsync(IReadOnlyList<int> processIds, CancellationToken cancellationToken);
}

public interface IRuntimeProcessInstallPathObserver
{
    void SetActiveInstallPath(string installPath);
}

public sealed class RuntimeProcessCoordinator(TimeSpan? gracefulShutdownTimeout = null) : IRuntimeProcessCoordinator, IRuntimeSwitchProcessCoordinator, IRuntimeProcessForceCloser, IRuntimeProcessInstallPathObserver
{
    private static readonly HashSet<string> KnownProcessNames = new(StringComparer.OrdinalIgnoreCase) { "VRCNT", "VRCNT-backend", "VRCNT-backend.exe", "VRCNT-resident", "VRCNT.Resident" };
    private readonly TimeSpan _gracefulShutdownTimeout = gracefulShutdownTimeout ?? TimeSpan.FromSeconds(10);
    private string? _lastInstallPath;

    public async Task<ProcessStopResult> RequestGracefulStopAsync(CancellationToken cancellationToken)
    {
        var processes = FindKnownProcesses();
        foreach (var process in processes)
        {
            try { if (process.MainWindowHandle != IntPtr.Zero) process.CloseMainWindow(); }
            catch (InvalidOperationException) { }
        }
        var deadline = DateTimeOffset.UtcNow + _gracefulShutdownTimeout;
        while (DateTimeOffset.UtcNow < deadline && FindKnownProcesses().Count > 0)
            await Task.Delay(100, cancellationToken);
        var remaining = FindKnownProcesses();
        return new ProcessStopResult(remaining.Count == 0, remaining.Select(process => process.Id).ToArray(), remaining.Count > 0, remaining.Count > 0 ? "processes_running" : null);
    }

    public Task<ProcessStopResult> RequestGracefulStopAsync(RuntimeShutdownHandoff handoff, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(handoff.Nonce) || string.IsNullOrWhiteSpace(handoff.Token) ||
            !Path.IsPathRooted(handoff.StatusPath) || !Path.IsPathRooted(handoff.CurrentAppPath) ||
            !string.Equals(Path.GetFileName(handoff.StatusPath), "runtime-switch-status.json", StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(Path.GetFileName(handoff.CurrentAppPath), "VRCNT.exe", StringComparison.OrdinalIgnoreCase) ||
            !CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(handoff.Proof),
                Encoding.UTF8.GetBytes(RuntimeSwitchStatusStore.Proof(
                    handoff.Token,
                    handoff.Nonce,
                    handoff.TargetVariant == RuntimeVariant.Cuda ? "cuda" : "cpu",
                    handoff.CurrentAppPath))))
            throw new InvalidDataException("The runtime shutdown handoff is not authenticated.");
        var dataRoot = Path.GetDirectoryName(handoff.StatusPath)
            ?? throw new InvalidDataException("The runtime shutdown status path is invalid.");
        var statusStore = new RuntimeSwitchStatusStore(dataRoot, handoff.StatusPath);
        statusStore.WriteShutdownRequested(handoff.TargetVariant == RuntimeVariant.Cuda ? "cuda" : "cpu", handoff);
        return WaitForSwitchShutdownAsync(statusStore, handoff, cancellationToken);
    }

    private async Task<ProcessStopResult> WaitForSwitchShutdownAsync(RuntimeSwitchStatusStore statusStore, RuntimeShutdownHandoff handoff, CancellationToken cancellationToken)
    {
        if (!await statusStore.WaitForShutdownAcknowledgementAsync(handoff, _gracefulShutdownTimeout, cancellationToken))
            return new ProcessStopResult(false, FindKnownProcesses().Select(process => process.Id).ToArray(), false, "shutdown_acknowledgement_timeout");
        return await RequestGracefulStopAsync(cancellationToken);
    }

    public Task<bool> AreKnownProcessesStoppedAsync(CancellationToken cancellationToken) => Task.FromResult(FindKnownProcesses().Count == 0);

    public Task<ProcessStopResult> ForceCloseRemainingAsync(IReadOnlyList<int> processIds, CancellationToken cancellationToken)
    {
        foreach (var process in FindKnownProcesses().Where(process => processIds.Contains(process.Id)))
        {
            try { process.Kill(true); }
            catch (InvalidOperationException) { }
        }
        var remaining = FindKnownProcesses();
        return Task.FromResult(new ProcessStopResult(remaining.Count == 0, remaining.Select(process => process.Id).ToArray(), remaining.Count > 0, remaining.Count > 0 ? "processes_running" : null));
    }

    public Task LaunchForActivationAsync(string installPath, RuntimeIdentity expectedIdentity, ActivationRequest request, CancellationToken cancellationToken)
    {
        _lastInstallPath = installPath;
        var executable = Path.Combine(installPath, "VRCNT.exe");
        if (!File.Exists(executable)) throw new FileNotFoundException("The staged VRCNT executable is missing.", executable);
        var start = new ProcessStartInfo(executable) { UseShellExecute = false };
        start.ArgumentList.Add("--runtime-activation-pipe"); start.ArgumentList.Add(request.PipeName);
        start.ArgumentList.Add("--runtime-activation-token"); start.ArgumentList.Add(request.SingleUseToken);
        start.ArgumentList.Add("--runtime-activation-nonce"); start.ArgumentList.Add(request.Nonce);
        start.ArgumentList.Add("--runtime-activation-app-version"); start.ArgumentList.Add(expectedIdentity.Version);
        start.ArgumentList.Add("--runtime-activation-runtime-variant"); start.ArgumentList.Add(expectedIdentity.Variant == RuntimeVariant.Cuda ? "cuda" : "cpu");
        _ = System.Diagnostics.Process.Start(start) ?? throw new InvalidOperationException("Unable to start VRCNT for runtime activation.");
        return Task.CompletedTask;
    }

    public void SetActiveInstallPath(string installPath) => _lastInstallPath = installPath;

    public Task RelaunchActiveRuntimeAsync(CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(_lastInstallPath))
        {
            var executable = Path.Combine(_lastInstallPath, "VRCNT.exe");
            if (File.Exists(executable)) _ = System.Diagnostics.Process.Start(new ProcessStartInfo(executable) { UseShellExecute = false });
        }
        return Task.CompletedTask;
    }

    private List<System.Diagnostics.Process> FindKnownProcesses() => string.IsNullOrWhiteSpace(_lastInstallPath)
        ? []
        : System.Diagnostics.Process.GetProcesses()
            .Where(process => (KnownProcessNames.Contains(process.ProcessName) || KnownProcessNames.Contains(process.ProcessName + ".exe")) && IsFromActiveInstall(process))
            .ToList();

    private bool IsFromActiveInstall(System.Diagnostics.Process process)
    {
        try
        {
            var executable = process.MainModule?.FileName;
            return executable is not null && string.Equals(Path.GetFullPath(executable), Path.Combine(Path.GetFullPath(_lastInstallPath!), "VRCNT.exe"), StringComparison.OrdinalIgnoreCase)
                || executable is not null && string.Equals(Path.GetDirectoryName(Path.GetFullPath(executable)), Path.GetFullPath(_lastInstallPath!), StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception exception) when (exception is InvalidOperationException or System.ComponentModel.Win32Exception) { return false; }
    }
}
