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
            if (result.ExitCode != 0) return new CapabilityProbeResult(false, true, "cuda_probe_failed", "The staged CUDA backend rejected its local capability probe.");
            return ParseResponse(result.StandardOutput);
        }
        catch (OperationCanceledException) { throw; }
        catch (TimeoutException) { return new CapabilityProbeResult(false, false, "cuda_probe_timeout", "The staged CUDA capability probe timed out."); }
        catch (Exception exception) { return new CapabilityProbeResult(false, false, "cuda_probe_inconclusive", $"The staged CUDA capability probe could not run ({exception.GetType().Name})."); }
    }

    private static CapabilityProbeResult ParseResponse(string standardOutput)
    {
        try
        {
            using var response = JsonDocument.Parse(standardOutput);
            var root = response.RootElement;
            if (root.ValueKind != JsonValueKind.Object || root.EnumerateObject().Any(property => property.Name is not ("supported" or "conclusive" or "failureCode" or "detail"))
                || !root.TryGetProperty("supported", out var supportedValue) || supportedValue.ValueKind is not (JsonValueKind.True or JsonValueKind.False)
                || !root.TryGetProperty("conclusive", out var conclusiveValue) || conclusiveValue.ValueKind is not (JsonValueKind.True or JsonValueKind.False)
                || !TryGetOptionalString(root, "failureCode", out var failureCode)
                || !TryGetOptionalString(root, "detail", out var detail))
            {
                return new CapabilityProbeResult(false, false, "cuda_probe_malformed_response", "The staged CUDA backend returned an invalid capability response.");
            }

            var supported = supportedValue.GetBoolean();
            var conclusive = conclusiveValue.GetBoolean();
            if (supported && conclusive && failureCode is null && detail is null) return new CapabilityProbeResult(true, true, null, null);
            if (!supported && conclusive && !string.IsNullOrWhiteSpace(failureCode) && !string.IsNullOrWhiteSpace(detail)) return new CapabilityProbeResult(false, true, failureCode, detail);
            return new CapabilityProbeResult(false, false, "cuda_probe_malformed_response", "The staged CUDA backend returned an invalid capability response.");
        }
        catch (JsonException)
        {
            return new CapabilityProbeResult(false, false, "cuda_probe_malformed_response", "The staged CUDA backend returned an invalid capability response.");
        }
    }

    private static bool TryGetOptionalString(JsonElement root, string name, out string? value)
    {
        value = null;
        if (!root.TryGetProperty(name, out var property)) return false;
        if (property.ValueKind == JsonValueKind.Null) return true;
        if (property.ValueKind != JsonValueKind.String) return false;
        value = property.GetString();
        return true;
    }
}

public sealed class StagedBackendProcessRunner(TimeSpan? timeout = null) : IBackendProcessRunner
{
    private readonly TimeSpan _timeout = timeout ?? TimeSpan.FromSeconds(30);

    public async Task<BackendProcessResult> RunAsync(string executablePath, IReadOnlyList<string> arguments, string workingDirectory, CancellationToken cancellationToken)
    {
        var start = new ProcessStartInfo(executablePath) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = workingDirectory };
        start.Environment["VRCNT_CUDA_CAPABILITY_PROBE"] = "1";
        start.Environment["VRCNT_DISABLE_NETWORK"] = "1";
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        using var process = System.Diagnostics.Process.Start(start) ?? throw new InvalidOperationException("Unable to start the staged CUDA backend.");
        using var timeoutSource = new CancellationTokenSource(_timeout);
        using var completion = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutSource.Token);
        var output = process.StandardOutput.ReadToEndAsync();
        var error = process.StandardError.ReadToEndAsync();
        try { await process.WaitForExitAsync(completion.Token); }
        catch (OperationCanceledException)
        {
            await TerminateAndDrainAsync(process, output, error);
            if (cancellationToken.IsCancellationRequested) throw new OperationCanceledException(cancellationToken);
            throw new TimeoutException("The staged CUDA capability probe timed out.");
        }
        return new BackendProcessResult(process.ExitCode, await output, await error);
    }

    private static async Task TerminateAndDrainAsync(System.Diagnostics.Process process, Task<string> output, Task<string> error)
    {
        try { if (!process.HasExited) process.Kill(true); } catch (InvalidOperationException) { }
        await Task.WhenAll(DrainAsync(output), DrainAsync(error));
        try { await process.WaitForExitAsync(); } catch (InvalidOperationException) { }
    }

    private static async Task DrainAsync(Task<string> task)
    {
        try { await task; } catch (InvalidOperationException) { }
    }
}
