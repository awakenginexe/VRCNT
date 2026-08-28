using System.IO;
using System.Security.Cryptography;

namespace VRCNT.Setup;

public sealed record SetupToolLayout(string MinisignPath, string SevenZipPath)
{
    private const string TrustedMinisignSha256 = "5535be9e4e123831ebe6ef324aafe9dde507015c176191f9e20c3ad60567f9e1";
    private const string TrustedSevenZipSha256 = "35d4d69d7cd6cb44558f208c3b1334268013f9daf82d2dda848893a1c30c59c2";

    public static SetupToolLayout Require(string directory)
    {
        var root = Path.GetFullPath(directory);
        var minisign = RequireTrustedTool(root, "minisign.exe", TrustedMinisignSha256);
        var sevenZip = RequireTrustedTool(root, "7za.exe", TrustedSevenZipSha256);
        return new SetupToolLayout(minisign, sevenZip);
    }

    public static void CopyToWorker(SetupToolLayout layout, string workerDirectory)
    {
        ArgumentNullException.ThrowIfNull(layout);
        var destination = Path.GetFullPath(workerDirectory);
        Directory.CreateDirectory(destination);
        CopyTrusted(layout.MinisignPath, Path.Combine(destination, "minisign.exe"), TrustedMinisignSha256);
        CopyTrusted(layout.SevenZipPath, Path.Combine(destination, "7za.exe"), TrustedSevenZipSha256);
    }

    internal static SetupToolLayout CreateTestFixture(string directory) => new(
        Path.Combine(Path.GetFullPath(directory), "minisign.exe"),
        Path.Combine(Path.GetFullPath(directory), "7za.exe"));

    internal static void CopyToWorkerForTest(SetupToolLayout layout, string workerDirectory)
    {
        ArgumentNullException.ThrowIfNull(layout);
        var destination = Path.GetFullPath(workerDirectory);
        Directory.CreateDirectory(destination);
        File.Copy(layout.MinisignPath, Path.Combine(destination, "minisign.exe"), true);
        File.Copy(layout.SevenZipPath, Path.Combine(destination, "7za.exe"), true);
    }

    private static string RequireTrustedTool(string directory, string name, string expectedSha256) =>
        VerifyTrustedTool(Path.Combine(directory, name), name, expectedSha256);

    private static string VerifyTrustedTool(string path, string name, string expectedSha256)
    {
        if (!File.Exists(path) || new FileInfo(path).Length == 0)
            throw new FileNotFoundException($"The authenticated setup tool '{name}' is missing from the published manager layout.", path);
        using var stream = File.OpenRead(path);
        var actualSha256 = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
        if (!CryptographicOperations.FixedTimeEquals(
                System.Text.Encoding.ASCII.GetBytes(actualSha256),
                System.Text.Encoding.ASCII.GetBytes(expectedSha256)))
            throw new CryptographicException($"The authenticated setup tool '{name}' failed its trusted SHA-256 check.");
        return path;
    }

    private static void CopyTrusted(string source, string destination, string expectedSha256)
    {
        VerifyTrustedTool(source, Path.GetFileName(source), expectedSha256);
        if (string.Equals(Path.GetFullPath(source), Path.GetFullPath(destination), StringComparison.OrdinalIgnoreCase)) return;
        File.Copy(source, destination, true);
        VerifyTrustedTool(destination, Path.GetFileName(destination), expectedSha256);
    }
}
