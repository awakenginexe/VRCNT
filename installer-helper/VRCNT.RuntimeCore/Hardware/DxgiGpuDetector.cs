using System.Runtime.InteropServices;

namespace VRCNT.RuntimeCore.Hardware;

public sealed class DxgiGpuDetector : IGpuDetector
{
    private readonly IGpuAdapterEnumerator _dxgiAdapters;
    private readonly IGpuDetector _wmiFallback;
    private readonly NvidiaSmiProbe _nvidiaSmi;

    public DxgiGpuDetector(IGpuAdapterEnumerator? dxgiAdapters = null, IGpuDetector? wmiFallback = null, NvidiaSmiProbe? nvidiaSmi = null)
    {
        _dxgiAdapters = dxgiAdapters ?? new WindowsDxgiAdapterEnumerator();
        _wmiFallback = wmiFallback ?? new WmiGpuDetector();
        _nvidiaSmi = nvidiaSmi ?? new NvidiaSmiProbe();
    }

    public GpuDetectionResult Detect()
    {
        var primary = DetectAdapters(_dxgiAdapters, "DXGI");
        var result = primary.Status == GpuDetectionStatus.Inconclusive
            ? Combine(primary, _wmiFallback.Detect())
            : primary;
        var corroboration = _nvidiaSmi.Probe();
        if (corroboration.NvidiaDetected)
            return new GpuDetectionResult(GpuDetectionStatus.NvidiaDetected, corroboration.DisplayName ?? result.DisplayName, corroboration.AdapterId ?? result.AdapterId, $"{result.Evidence}; {corroboration.Evidence}");
        return result with { Evidence = $"{result.Evidence}; {corroboration.Evidence}" };
    }

    internal static GpuDetectionResult DetectAdapters(IGpuAdapterEnumerator enumerator, string source)
    {
        try
        {
            var physicalAdapters = enumerator.Enumerate().Where(adapter => !adapter.IsSoftwareAdapter).ToArray();
            var nvidia = physicalAdapters.FirstOrDefault(IsNvidia);
            if (nvidia is not null)
                return new GpuDetectionResult(GpuDetectionStatus.NvidiaDetected, nvidia.DisplayName, nvidia.AdapterId, $"{source}: NVIDIA adapter detected.");
            if (physicalAdapters.Length > 0)
                return new GpuDetectionResult(GpuDetectionStatus.NoNvidiaHardware, physicalAdapters[0].DisplayName, physicalAdapters[0].AdapterId, $"{source}: physical adapters enumerated without NVIDIA hardware.");
            return new GpuDetectionResult(GpuDetectionStatus.Inconclusive, null, null, $"{source}: no physical adapter could be enumerated.");
        }
        catch (Exception exception)
        {
            return new GpuDetectionResult(GpuDetectionStatus.Inconclusive, null, null, $"{source}: adapter enumeration unavailable ({exception.GetType().Name}).");
        }
    }

    private static GpuDetectionResult Combine(GpuDetectionResult primary, GpuDetectionResult fallback) => fallback.Status == GpuDetectionStatus.Inconclusive
        ? primary with { Evidence = $"{primary.Evidence}; {fallback.Evidence}" }
        : fallback with { Evidence = $"{primary.Evidence}; {fallback.Evidence}" };

    internal static bool IsNvidia(GpuAdapterInfo adapter) => adapter.DisplayName.Contains("NVIDIA", StringComparison.OrdinalIgnoreCase)
        || adapter.AdapterId?.Contains("VEN_10DE", StringComparison.OrdinalIgnoreCase) == true;
}

internal sealed class WindowsDxgiAdapterEnumerator : IGpuAdapterEnumerator
{
    private const int DxgiErrorNotFound = unchecked((int)0x887A0002);
    private const uint DxgiAdapterFlagSoftware = 2;
    private static readonly Guid Factory1Iid = new("770aae78-f26f-4dba-a829-253c83d1b387");

    public IReadOnlyList<GpuAdapterInfo> Enumerate()
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("DXGI adapter enumeration requires Windows.");
        var hr = CreateDXGIFactory1(in Factory1Iid, out var factory);
        if (hr < 0 || factory == IntPtr.Zero) Marshal.ThrowExceptionForHR(hr);
        try
        {
            var enumerate = Marshal.GetDelegateForFunctionPointer<EnumAdapters1Delegate>(Marshal.ReadIntPtr(Marshal.ReadIntPtr(factory), 12 * IntPtr.Size));
            var adapters = new List<GpuAdapterInfo>();
            for (uint index = 0; ; index++)
            {
                var enumerateResult = enumerate(factory, index, out var adapter);
                if (enumerateResult == DxgiErrorNotFound) break;
                if (enumerateResult < 0) Marshal.ThrowExceptionForHR(enumerateResult);
                try
                {
                    var getDescription = Marshal.GetDelegateForFunctionPointer<GetDesc1Delegate>(Marshal.ReadIntPtr(Marshal.ReadIntPtr(adapter), 10 * IntPtr.Size));
                    var descriptionResult = getDescription(adapter, out var value);
                    if (descriptionResult < 0) Marshal.ThrowExceptionForHR(descriptionResult);
                    adapters.Add(new GpuAdapterInfo(value.Description.TrimEnd('\0'), $"PCI\\VEN_{value.VendorId:X4}", (value.Flags & DxgiAdapterFlagSoftware) != 0));
                }
                finally { Marshal.Release(adapter); }
            }
            return adapters;
        }
        finally { Marshal.Release(factory); }
    }

    [DllImport("dxgi.dll", ExactSpelling = true)]
    private static extern int CreateDXGIFactory1(in Guid riid, out IntPtr factory);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int EnumAdapters1Delegate(IntPtr factory, uint adapterIndex, out IntPtr adapter);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int GetDesc1Delegate(IntPtr adapter, out DxgiAdapterDesc1 description);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DxgiAdapterDesc1
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
        public uint VendorId;
        public uint DeviceId;
        public uint SubSysId;
        public uint Revision;
        public nuint DedicatedVideoMemory;
        public nuint DedicatedSystemMemory;
        public nuint SharedSystemMemory;
        public long AdapterLuid;
        public uint Flags;
        public uint GraphicsPreemptionGranularity;
        public uint ComputePreemptionGranularity;
    }
}
