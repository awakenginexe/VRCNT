using System.IO;

namespace VRCNT.Setup;

public static class SetupWorkingDirectory
{
    public static void ReleaseInheritedDirectory()
    {
        // ShellExecute starts the updater with the app's current directory.
        // Windows holds that directory open, preventing transactional renames
        // even after the app exits. A filesystem root cannot be an install target.
        var systemRoot = Path.GetPathRoot(Environment.SystemDirectory)
            ?? throw new InvalidOperationException("The Windows system drive is unavailable.");
        Directory.SetCurrentDirectory(systemRoot);
    }
}
