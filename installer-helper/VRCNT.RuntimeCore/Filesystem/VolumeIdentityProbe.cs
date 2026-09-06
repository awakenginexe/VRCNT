using System.Runtime.InteropServices;
using System.Text;

namespace VRCNT.RuntimeCore.Filesystem;

public interface IVolumeIdentityProbe
{
    string GetVolumeIdentity(string path);
}

public sealed class VolumeIdentityProbe : IVolumeIdentityProbe
{
    public string GetVolumeIdentity(string path)
    {
        var fullPath = Path.GetFullPath(path);
        var root = Path.GetPathRoot(fullPath) ?? throw new InvalidDataException("The path has no filesystem root.");
        if (OperatingSystem.IsWindows())
        {
            var mount = new StringBuilder(32768);
            var volume = new StringBuilder(32768);
            var probePath = FindExistingAncestor(fullPath);
            if (GetVolumePathName(probePath, mount, mount.Capacity) && GetVolumeNameForVolumeMountPoint(mount.ToString(), volume, volume.Capacity))
                return volume.ToString().TrimEnd('\\').ToUpperInvariant();
            if (mount.Length > 0 && GetVolumeInformation(mount.ToString(), null, 0, out var serialNumber, out _, out _, null, 0))
                return $"SERIAL:{serialNumber:X8}";
        }
        return new DriveInfo(root).Name.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).ToUpperInvariant();
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
    private static extern bool GetVolumePathName(string fileName, StringBuilder volumePathName, int bufferLength);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetVolumeNameForVolumeMountPoint(string volumeMountPoint, StringBuilder volumeName, int bufferLength);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetVolumeInformation(string rootPathName, StringBuilder? volumeNameBuffer, int volumeNameSize, out uint volumeSerialNumber, out uint maximumComponentLength, out uint fileSystemFlags, StringBuilder? fileSystemNameBuffer, int fileSystemNameSize);
}
