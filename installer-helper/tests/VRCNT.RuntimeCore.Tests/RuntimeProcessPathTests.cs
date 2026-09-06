using System.Reflection;
using VRCNT.RuntimeCore.Process;
using Xunit;

namespace VRCNT.RuntimeCore.Tests;

public sealed class RuntimeProcessPathTests
{
    [Fact]
    public void Process_identity_matches_extended_paths_but_rejects_other_directories()
    {
        using var process = System.Diagnostics.Process.GetCurrentProcess();
        var directory = Path.GetDirectoryName(process.MainModule!.FileName)!;
        var coordinator = new RuntimeProcessCoordinator();
        var matches = typeof(RuntimeProcessCoordinator).GetMethod("IsFromActiveInstall", BindingFlags.Instance | BindingFlags.NonPublic)!;
        coordinator.SetActiveInstallPath(@"\\?\" + directory);
        Assert.True((bool)matches.Invoke(coordinator, [process])!);
        coordinator.SetActiveInstallPath(Path.Combine(directory, "other-install"));
        Assert.False((bool)matches.Invoke(coordinator, [process])!);
    }
}
