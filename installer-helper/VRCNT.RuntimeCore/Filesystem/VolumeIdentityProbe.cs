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
        return new DriveInfo(root).Name.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).ToUpperInvariant();
    }
}
