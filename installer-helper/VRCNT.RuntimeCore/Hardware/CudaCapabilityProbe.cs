using System.Diagnostics;
using System.Text.Json;

namespace VRCNT.RuntimeCore.Hardware;

public interface ICudaCapabilityProbe
{
    Task<CapabilityProbeResult> ProbeAsync(string stagedInstallPath, CancellationToken cancellationToken);
}

public sealed record CapabilityProbeResult(bool Supported, bool Conclusive, string? FailureCode, string? Detail);

public sealed record BackendProcessResult(int ExitCode, string StandardOutput, string StandardError);

public interface IBackendProcessRunner
{
    Task<BackendProcessResult> RunAsync(string executablePath, IReadOnlyList<string> arguments, string workingDirectory, CancellationToken cancellationToken);
}

public sealed class CudaCapabilityProbe(IBackendProcessRunner? runner = null) : ICudaCapabilityProbe
{
    private readonly IBackendProcessRunner _runner = runner ?? new StagedBackendProcessRunner();

    public async Task<CapabilityProbeResult> ProbeAsync(string stagedInstallPath, CancellationToken cancellationToken)
    {
        var backendPath = Path.Combine(Path.GetFullPath(stagedInstallPath), "VRCNT-backend.exe");
        if (!File.Exists(backendPath)) return new CapabilityProbeResult(false, false, "cuda_probe_unavailable", "The staged CUDA backend executable is missing.");
        try
        {
            var result = await _runner.RunAsync(backendPath, ["--cuda-capability-probe", "--offline"], Path.GetDirectoryName(backendPath)!, cancellationToken);
            if (result.ExitCode != 0) return new CapabilityProbeResult(false, true, "cuda_probe_failed", string.IsNullOrWhiteSpace(result.StandardError) ? "The staged CUDA backend rejected its local capability probe." : result.StandardError.Trim());
            using var response = JsonDocument.Parse(result.StandardOutput);
            var root = response.RootElement;
            var supported = root.TryGetProperty("supported", out var supportedValue) && supportedValue.ValueKind == JsonValueKind.True;
            var conclusive = root.TryGetProperty("conclusive", out var conclusiveValue) && conclusiveValue.ValueKind == JsonValueKind.True;
            return supported && conclusive
                ? new CapabilityProbeResult(true, true, null, null)
                : new CapabilityProbeResult(false, conclusive, conclusive ? "cuda_probe_failed" : "cuda_probe_inconclusive", "The staged CUDA backend did not report a conclusive supported result.");
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception exception) { return new CapabilityProbeResult(false, false, "cuda_probe_inconclusive", $"The staged CUDA capability probe could not run ({exception.GetType().Name})."); }
    }
}

internal sealed class StagedBackendProcessRunner : IBackendProcessRunner
{
    public async Task<BackendProcessResult> RunAsync(string executablePath, IReadOnlyList<string> arguments, string workingDirectory, CancellationToken cancellationToken)
    {
        var start = new ProcessStartInfo(executablePath) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = workingDirectory };
        start.Environment["VRCNT_CUDA_CAPABILITY_PROBE"] = "1";
        start.Environment["VRCNT_DISABLE_NETWORK"] = "1";
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        using var process = System.Diagnostics.Process.Start(start) ?? throw new InvalidOperationException("Unable to start the staged CUDA backend.");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        var output = process.StandardOutput.ReadToEndAsync(timeout.Token);
        var error = process.StandardError.ReadToEndAsync(timeout.Token);
        try { await process.WaitForExitAsync(timeout.Token); }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            try { process.Kill(true); } catch (InvalidOperationException) { }
            throw new TimeoutException("The staged CUDA capability probe timed out.");
        }
        return new BackendProcessResult(process.ExitCode, await output, await error);
    }
}
