namespace VRCNT.RuntimeCore.Storage;

using System.Runtime.InteropServices;

public interface IAvailableSpaceProbe
{
    long GetAvailableBytes(string path);
}

public sealed class AvailableSpaceProbe : IAvailableSpaceProbe
{
    public long GetAvailableBytes(string path)
    {
        var fullPath = Path.GetFullPath(path);
        if (OperatingSystem.IsWindows() && GetDiskFreeSpaceEx(FindExistingAncestor(fullPath), out var availableBytes, out _, out _))
            return checked((long)availableBytes);
        var root = Path.GetPathRoot(fullPath) ?? throw new InvalidDataException("The path has no filesystem root.");
        return new DriveInfo(root).AvailableFreeSpace;
    }

    private static string FindExistingAncestor(string fullPath)
    {
        var candidate = fullPath;
        while (!Directory.Exists(candidate) && !File.Exists(candidate))
        {
            var parent = Path.GetDirectoryName(candidate);
            if (string.IsNullOrEmpty(parent) || string.Equals(parent, candidate, StringComparison.Ordinal)) break;
            candidate = parent;
        }
        return candidate;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetDiskFreeSpaceEx(string directoryName, out ulong freeBytesAvailableToCaller, out ulong totalNumberOfBytes, out ulong totalNumberOfFreeBytes);
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
