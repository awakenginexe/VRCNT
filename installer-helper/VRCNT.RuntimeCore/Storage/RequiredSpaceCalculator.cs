namespace VRCNT.RuntimeCore.Storage;

public interface IAvailableSpaceProbe
{
    long GetAvailableBytes(string path);
}

public sealed class AvailableSpaceProbe : IAvailableSpaceProbe
{
    public long GetAvailableBytes(string path)
    {
        var root = Path.GetPathRoot(Path.GetFullPath(path)) ?? throw new InvalidDataException("The path has no filesystem root.");
        return new DriveInfo(root).AvailableFreeSpace;
    }
}

public sealed class RequiredSpaceCalculator(IAvailableSpaceProbe availableSpaceProbe)
{
    private const long MetadataReserveBytes = 16L * 1024 * 1024;

    public bool HasRequiredSpace(string targetPath, long stagedPayloadBytes)
    {
        if (stagedPayloadBytes <= 0) throw new InvalidDataException("The installed payload size must be positive.");
        var existingBytes = Directory.Exists(targetPath) ? DirectorySize(targetPath) : 0;
        var required = checked(stagedPayloadBytes + existingBytes + MetadataReserveBytes);
        return availableSpaceProbe.GetAvailableBytes(targetPath) >= required;
    }

    private static long DirectorySize(string path) => Directory.EnumerateFiles(path, "*", SearchOption.AllDirectories)
        .Aggregate(0L, (total, file) => checked(total + new FileInfo(file).Length));
}
