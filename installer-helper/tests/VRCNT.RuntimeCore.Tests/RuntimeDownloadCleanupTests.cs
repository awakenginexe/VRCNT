using VRCNT.RuntimeCore.Transactions;
using Xunit;

namespace VRCNT.RuntimeCore.Tests;

public sealed class RuntimeDownloadCleanupTests
{
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Only_successful_downloads_are_removed(bool succeeded)
    {
        var root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            File.WriteAllText(Path.Combine(root, "cpu.7z.001"), "download");
            File.WriteAllText(Path.Combine(root, "cpu.7z.001.partial"), "partial");
            File.WriteAllText(Path.Combine(root, "unrelated"), "keep");
            RuntimeDownloadCleanup.AfterSuccess(succeeded, root, ["cpu.7z.001", "../outside"]);
            Assert.Equal(!succeeded, File.Exists(Path.Combine(root, "cpu.7z.001")));
            Assert.Equal(!succeeded, File.Exists(Path.Combine(root, "cpu.7z.001.partial")));
            Assert.True(File.Exists(Path.Combine(root, "unrelated")));
        }
        finally { Directory.Delete(root, true); }
    }
}
