namespace VRCNT.Setup.Views;

public enum GpuCompatibility
{
    Inconclusive,
    RequiresNvidia,
    Compatible,
    Recommended,
}

public sealed record GpuAdvisory(GpuCompatibility Compatibility)
{
    public static GpuAdvisory Inconclusive { get; } = new(GpuCompatibility.Inconclusive);
}

public interface IGpuAdvisoryPolicy
{
    GpuAdvisory Assess();
}

public sealed class InconclusiveGpuAdvisoryPolicy : IGpuAdvisoryPolicy
{
    public GpuAdvisory Assess() => GpuAdvisory.Inconclusive;
}
