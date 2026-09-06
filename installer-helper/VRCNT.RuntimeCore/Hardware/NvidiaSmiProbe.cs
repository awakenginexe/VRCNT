using System.Diagnostics;

namespace VRCNT.RuntimeCore.Hardware;

public sealed record NvidiaSmiProbeResult(bool Available, bool NvidiaDetected, string? DisplayName, string? AdapterId, string Evidence)
{
    public static NvidiaSmiProbeResult Unavailable { get; } = new(false, false, null, null, "nvidia-smi unavailable");
}

public interface INvidiaSmiRunner
{
    NvidiaSmiProbeResult Run();
}

public sealed class NvidiaSmiProbe(INvidiaSmiRunner? runner = null)
{
    private readonly INvidiaSmiRunner _runner = runner ?? new WindowsNvidiaSmiRunner();
    public NvidiaSmiProbeResult Probe()
    {
        try { return _runner.Run(); }
        catch (Exception exception) { return new NvidiaSmiProbeResult(false, false, null, null, $"nvidia-smi unavailable ({exception.GetType().Name})"); }
    }
}

internal sealed class WindowsNvidiaSmiRunner : INvidiaSmiRunner
{
    public NvidiaSmiProbeResult Run()
    {
        if (!OperatingSystem.IsWindows()) return NvidiaSmiProbeResult.Unavailable;
        var start = new ProcessStartInfo("nvidia-smi.exe", "--query-gpu=name,pci.bus_id --format=csv,noheader") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        using var process = System.Diagnostics.Process.Start(start) ?? throw new InvalidOperationException("Unable to start nvidia-smi.");
        if (!process.WaitForExit(5_000))
        {
            try { process.Kill(true); } catch (InvalidOperationException) { }
            return new NvidiaSmiProbeResult(true, false, null, null, "nvidia-smi timed out");
        }
        if (process.ExitCode != 0) return new NvidiaSmiProbeResult(true, false, null, null, "nvidia-smi did not report an NVIDIA GPU");
        var line = process.StandardOutput.ReadLine();
        if (string.IsNullOrWhiteSpace(line)) return new NvidiaSmiProbeResult(true, false, null, null, "nvidia-smi did not report an NVIDIA GPU");
        var parts = line.Split(new[] { ',' }, 2, StringSplitOptions.None);
        return new NvidiaSmiProbeResult(true, true, parts[0].Trim(), parts.Length == 2 ? parts[1].Trim() : null, "nvidia-smi corroborated NVIDIA hardware");
    }
}
