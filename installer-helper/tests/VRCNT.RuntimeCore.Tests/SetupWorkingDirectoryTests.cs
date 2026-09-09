using VRCNT.Setup;
using VRCNT.Setup.CommandLine;
using Xunit;

namespace VRCNT.RuntimeCore.Tests;

[CollectionDefinition("Process working directory", DisableParallelization = true)]
public sealed class WorkingDirectoryCollection;

[Collection("Process working directory")]
public sealed class SetupWorkingDirectoryTests
{
    [Theory]
    [InlineData("")]
    [InlineData("nested")]
    public void Updater_releases_its_own_directory_lock_before_replacement_and_retry(string child)
    {
        if (!OperatingSystem.IsWindows()) return;
        var root = Path.Combine(Path.GetTempPath(), "vrcnt-cwd-tests", Guid.NewGuid().ToString("N"));
        var runtime = Path.Combine(root, "runtime");
        var inheritedDirectory = Path.Combine(runtime, child);
        var previous = Environment.CurrentDirectory;
        Directory.CreateDirectory(inheritedDirectory);
        try
        {
            Environment.CurrentDirectory = inheritedDirectory;
            var options = SetupCommandLine.Parse(["/UPDATE", "/ARGS",
                "--tauri-update-contract-v1", "/passive", "--repair-manager"]);
            Assert.True(options.IsUpdate);
            Assert.Throws<IOException>(() => Directory.Move(runtime, Path.Combine(root, "locked-backup")));

            SetupWorkingDirectory.ReleaseInheritedDirectory();
            Directory.Move(runtime, Path.Combine(root, "backup"));
            Assert.False(Directory.Exists(runtime));

            // Roll back and retry in the same Setup process.
            Directory.Move(Path.Combine(root, "backup"), runtime);
            SetupWorkingDirectory.ReleaseInheritedDirectory();
            Directory.Move(runtime, Path.Combine(root, "retry-backup"));
            Assert.True(Directory.Exists(Path.Combine(root, "retry-backup")));
        }
        finally
        {
            Environment.CurrentDirectory = previous;
            Directory.Delete(root, recursive: true);
        }
    }
}
