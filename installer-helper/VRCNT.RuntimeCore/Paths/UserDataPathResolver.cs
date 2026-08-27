namespace VRCNT.RuntimeCore.Paths;

public sealed record UserDataPaths(string DataRoot, string LegacyDataRoot, string InstallPath);

public sealed class UserDataPathResolver
{
    public UserDataPaths Resolve(string installPath)
    {
        var localAppData = Environment.GetEnvironmentVariable("LOCALAPPDATA")
            ?? Environment.GetEnvironmentVariable("APPDATA")
            ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        return Resolve(localAppData, installPath);
    }

    public UserDataPaths Resolve(string localAppData, string installPath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(localAppData);
        var canonicalInstallPath = ValidateCustomInstallPath(installPath);
        return new UserDataPaths(
            Path.Combine(localAppData, "VRCNTData"),
            Path.Combine(localAppData, "VRCNT-NextData"),
            canonicalInstallPath);
    }

    public string ValidateCustomInstallPath(string installPath, string? userProfile = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(installPath);
        var canonicalInstallPath = Path.GetFullPath(installPath);
        if (string.Equals(canonicalInstallPath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), Path.GetPathRoot(canonicalInstallPath)?.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("The install path cannot be a filesystem root.");

        var canonicalUserProfile = Path.GetFullPath(userProfile ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
        var profileParent = Directory.GetParent(canonicalUserProfile)?.FullName;
        if (profileParent is not null && IsWithin(profileParent, canonicalInstallPath) && !IsWithin(canonicalUserProfile, canonicalInstallPath))
            throw new InvalidDataException("The install path belongs to another user profile.");
        return canonicalInstallPath;
    }

    private static bool IsWithin(string parent, string candidate)
    {
        var relative = Path.GetRelativePath(parent, candidate);
        return relative == "." || (!relative.StartsWith("..", StringComparison.Ordinal) && !Path.IsPathRooted(relative));
    }
}
