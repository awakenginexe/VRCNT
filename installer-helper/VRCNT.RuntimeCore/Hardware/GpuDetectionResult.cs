using VRCNT.RuntimeCore.Models;

namespace VRCNT.RuntimeCore.Hardware;

public enum GpuDetectionStatus { NvidiaDetected, NoNvidiaHardware, Inconclusive }

public interface IGpuDetector
{
    GpuDetectionResult Detect();
}

public sealed record GpuDetectionResult(
    GpuDetectionStatus Status,
    string? DisplayName,
    string? AdapterId,
    string Evidence);

public sealed record GpuAdapterInfo(string DisplayName, string? AdapterId, bool IsSoftwareAdapter);

public interface IGpuAdapterEnumerator
{
    IReadOnlyList<GpuAdapterInfo> Enumerate();
}

public sealed record GpuSelectionRecommendation(
    RuntimeVariant RecommendedVariant,
    bool IsCudaNormallyAvailable,
    bool RequiresAdvancedCudaOverride,
    GpuDetectionResult Detection);

public interface IGpuSelectionPolicy
{
    GpuSelectionRecommendation Assess();
}

public sealed class GpuSelectionPolicy(IGpuDetector detector) : IGpuSelectionPolicy
{
    public GpuSelectionRecommendation Assess()
    {
        var detection = detector.Detect();
        return detection.Status switch
        {
            GpuDetectionStatus.NvidiaDetected => new(RuntimeVariant.Cuda, true, false, detection),
            GpuDetectionStatus.NoNvidiaHardware => new(RuntimeVariant.Cpu, false, false, detection),
            _ => new(RuntimeVariant.Cpu, false, true, detection),
        };
    }
}
