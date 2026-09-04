using System.IO;
using System.Security.Cryptography;

namespace VRCNT.Setup;

public sealed record SetupToolLayout(string MinisignPath, string SevenZipPath)
{
    private const string TrustedMinisignSha256 = "5535be9e4e123831ebe6ef324aafe9dde507015c176191f9e20c3ad60567f9e1";
    private const string TrustedSevenZipSha256 = "35d4d69d7cd6cb44558f208c3b1334268013f9daf82d2dda848893a1c30c59c2";
    private const string MinisignResourceName = "VRCNT.Setup.Tools.minisign.exe";
    private const string SevenZipResourceName = "VRCNT.Setup.Tools.7za.exe";

    public static SetupToolLayout Require(string directory)
        => Require(directory, null);

    internal static SetupToolLayout RequireForTest(string directory, string authenticatedToolsDirectory)
        => Require(directory, Path.GetFullPath(authenticatedToolsDirectory));

    private static SetupToolLayout Require(string directory, string? authenticatedToolsDirectory)
    {
        var root = Path.GetFullPath(directory);
        var minisign = RequireTrustedToolOrEmbedded(root, "minisign.exe", TrustedMinisignSha256, MinisignResourceName, authenticatedToolsDirectory);
        var sevenZip = RequireTrustedToolOrEmbedded(root, "7za.exe", TrustedSevenZipSha256, SevenZipResourceName, authenticatedToolsDirectory);
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

    private static string RequireTrustedToolOrEmbedded(string directory, string name, string expectedSha256, string resourceName, string? authenticatedToolsDirectory)
    {
        var adjacentPath = Path.Combine(directory, name);
        try
        {
            return VerifyTrustedTool(adjacentPath, name, expectedSha256);
        }
        catch (FileNotFoundException)
        {
            return MaterializeEmbeddedTool(name, expectedSha256, resourceName, authenticatedToolsDirectory);
        }
        catch (CryptographicException)
        {
            return MaterializeEmbeddedTool(name, expectedSha256, resourceName, authenticatedToolsDirectory);
        }
    }

    private static string MaterializeEmbeddedTool(string name, string expectedSha256, string resourceName, string? authenticatedToolsDirectory)
    {
        var directory = authenticatedToolsDirectory ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "VRCNTInstaller",
            "authenticated-tools");
        Directory.CreateDirectory(directory);
        var destination = Path.Combine(directory, name);
        try
        {
            return VerifyTrustedTool(destination, name, expectedSha256);
        }
        catch (FileNotFoundException)
        {
            // The embedded bytes below are authoritative.
        }
        catch (CryptographicException)
        {
            // Replace a corrupted cache entry only after verifying the replacement.
        }

        using var resource = typeof(SetupToolLayout).Assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidDataException($"The published setup is missing authenticated tool resource '{resourceName}'.");
        var temporaryPath = Path.Combine(directory, $".{name}.{Guid.NewGuid():N}.tmp");
        try
        {
            using (var output = new FileStream(temporaryPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                resource.CopyTo(output);
                output.Flush(flushToDisk: true);
            }
            VerifyTrustedTool(temporaryPath, name, expectedSha256);
            File.Move(temporaryPath, destination, true);
            return VerifyTrustedTool(destination, name, expectedSha256);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

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
