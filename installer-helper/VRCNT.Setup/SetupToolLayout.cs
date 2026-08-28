using System.IO;

namespace VRCNT.Setup;

public sealed record SetupToolLayout(string MinisignPath, string SevenZipPath)
{
    public static SetupToolLayout Require(string directory)
    {
        var root = Path.GetFullPath(directory);
        var minisign = RequireTool(root, "minisign.exe");
        var sevenZip = RequireTool(root, "7za.exe");
        return new SetupToolLayout(minisign, sevenZip);
    }

    public static void CopyToWorker(SetupToolLayout layout, string workerDirectory)
    {
        ArgumentNullException.ThrowIfNull(layout);
        var destination = Path.GetFullPath(workerDirectory);
        Directory.CreateDirectory(destination);
        Copy(layout.MinisignPath, Path.Combine(destination, "minisign.exe"));
        Copy(layout.SevenZipPath, Path.Combine(destination, "7za.exe"));
    }

    private static string RequireTool(string directory, string name)
    {
        var path = Path.Combine(directory, name);
        if (!File.Exists(path) || new FileInfo(path).Length == 0)
            throw new FileNotFoundException($"The authenticated setup tool '{name}' is missing from the published manager layout.", path);
        return path;
    }

    private static void Copy(string source, string destination)
    {
        if (string.Equals(Path.GetFullPath(source), Path.GetFullPath(destination), StringComparison.OrdinalIgnoreCase)) return;
        File.Copy(source, destination, true);
    }
}
