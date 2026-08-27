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
        ArgumentException.ThrowIfNullOrWhiteSpace(installPath);
        return new UserDataPaths(
            Path.Combine(localAppData, "VRCNTData"),
            Path.Combine(localAppData, "VRCNT-NextData"),
            installPath);
    }
}
