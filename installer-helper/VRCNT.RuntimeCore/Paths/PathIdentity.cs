namespace VRCNT.RuntimeCore.Paths;

public static class PathIdentity
{
    public static bool Equals(string left, string right)
    {
        try
        {
            return string.Equals(Normalize(left), Normalize(right), StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception exception) when (exception is ArgumentException or NotSupportedException)
        {
            return false;
        }
    }

    public static string Normalize(string path)
    {
        var fullPath = Path.GetFullPath(path);
        if (OperatingSystem.IsWindows())
        {
            if (fullPath.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase))
            {
                fullPath = @"\\" + fullPath[8..];
            }
            else if (IsExtendedDrivePath(fullPath))
            {
                fullPath = fullPath[4..];
            }
        }

        return fullPath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    }

    private static bool IsExtendedDrivePath(string path) =>
        path.Length >= 7 &&
        path.StartsWith(@"\\?\", StringComparison.Ordinal) &&
        char.IsAsciiLetter(path[4]) &&
        path[5] == ':' &&
        path[6] is '\\' or '/';
}
