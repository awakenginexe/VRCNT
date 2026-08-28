using System.Diagnostics;

namespace VRCNT.RuntimeCore.Hardware;

public sealed class WmiGpuDetector(IGpuAdapterEnumerator? adapters = null) : IGpuDetector
{
    private readonly IGpuAdapterEnumerator _adapters = adapters ?? new WindowsWmiAdapterEnumerator();

    public GpuDetectionResult Detect() => DxgiGpuDetector.DetectAdapters(_adapters, "WMI");
}

internal sealed class WindowsWmiAdapterEnumerator : IGpuAdapterEnumerator
{
    public IReadOnlyList<GpuAdapterInfo> Enumerate()
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("WMI adapter enumeration requires Windows.");
        var start = new ProcessStartInfo("powershell.exe", "-NoProfile -NonInteractive -Command \"Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name + '|' + $_.PNPDeviceID }\"")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        using var process = System.Diagnostics.Process.Start(start) ?? throw new InvalidOperationException("Unable to start WMI adapter enumeration.");
        if (!process.WaitForExit(5_000))
        {
            try { process.Kill(true); } catch (InvalidOperationException) { }
            throw new TimeoutException("WMI adapter enumeration timed out.");
        }
        if (process.ExitCode != 0) throw new InvalidOperationException("WMI adapter enumeration failed.");
        return process.StandardOutput.ReadToEnd().Split(new[] { "\r\n", "\n" }, StringSplitOptions.RemoveEmptyEntries)
            .Select(line => line.Split('|', 2))
            .Select(parts => new GpuAdapterInfo(parts[0].Trim(), parts.Length == 2 ? parts[1].Trim() : null, DxgiGpuDetector.IsRemoteVirtualOrSoftware(parts[0])))
            .ToArray();
    }
}
