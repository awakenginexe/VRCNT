using System.Diagnostics;
using System.IO;

namespace VRCNT.Setup.Views;

public interface IApplicationLauncher
{
    void Launch(string executablePath);
}

public sealed class ApplicationLauncher : IApplicationLauncher
{
    public void Launch(string executablePath)
    {
        if (File.Exists(executablePath)) Process.Start(new ProcessStartInfo(executablePath) { UseShellExecute = true });
    }
}
