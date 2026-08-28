using VRCNT.RuntimeCore.Manifest;
using VRCNT.RuntimeCore.Models;
using VRCNT.RuntimeCore.Packages;
using VRCNT.RuntimeCore.Migration;
using VRCNT.RuntimeCore.Paths;
using VRCNT.RuntimeCore.Security;
using VRCNT.RuntimeCore.Archive;
using VRCNT.RuntimeCore.Filesystem;
using VRCNT.RuntimeCore.Process;
using VRCNT.RuntimeCore.Storage;
using VRCNT.RuntimeCore.Transactions;
using System.Security.Cryptography;

namespace VRCNT.ReleaseHelper;

internal static class Program
{
    private static readonly HttpClient Http = new() { Timeout = Timeout.InfiniteTimeSpan };
    public static async Task<int> Main(string[] args)
    {
        try { await InstallAsync(Options.Parse(args)); return 0; }
        catch (Exception exception) { Console.Error.WriteLine($"[failed] {exception.Message}"); return 1; }
    }
    private static async Task InstallAsync(Options options)
    {
        Directory.CreateDirectory(options.CacheDirectory);
        var manifestPath = await AcquireMetadataAsync(options, options.ManifestName);
        var signaturePath = await AcquireMetadataAsync(options, options.SignatureName);
        var verified = await new ManifestLoader(new MinisignVerifier(options.MinisignPath)).LoadAndVerifyAsync(manifestPath, signaturePath, options.Version, default);
        var key = options.Variant == RuntimeVariant.Cpu ? "cpu" : "cuda";
        var package = verified.Manifest.Variants.TryGetValue(key, out var selected) ? selected : throw new InvalidDataException($"Signed manifest does not offer the requested {key} package.");
        var pathResolver = new UserDataPathResolver();
        var canonicalDestination = pathResolver.ValidateCustomInstallPath(options.Destination);
        var offline = package.Parts.All(part => File.Exists(Path.Combine(options.InstallerDirectory, part.Name)));
        Console.WriteLine(offline ? "[source] Found all signed manifest-selected package files beside the installer." : "[source] Downloading missing manifest-selected package files.");
        var legacyDetector = new LegacyInstallationDetector(pathResolver);
        var engine = new RuntimeTransactionEngine(
            new ManifestArchiveAcquirer(verified.Manifest, options.Variant, new Uri(options.ReleaseBaseUrl.TrimEnd('/') + "/"), offline ? options.InstallerDirectory : options.CacheDirectory, offline ? null : Http),
            new SevenZipExtractor(options.SevenZipPath),
            new RuntimePathValidator(new VolumeIdentityProbe()),
            new RequiredSpaceCalculator(new AvailableSpaceProbe()),
            new RuntimeProcessCoordinator(),
            new NamedPipeRuntimeActivationHealthMonitor(),
            new TransactionJournalStore(),
            new RuntimeDirectoryMover(),
            new Task3RuntimeStateTransition(),
            onPreflightValidated: () => legacyDetector.PreserveUserData(legacyDetector.Detect(pathResolver.Resolve(canonicalDestination))));
        var request = new RuntimeReplacementRequest(canonicalDestination, options.CacheDirectory, package.Parts.Select(part => Path.Combine(offline ? options.InstallerDirectory : options.CacheDirectory, part.Name)).ToArray(), package.InstalledSize, package.Identity,
            new ActivationRequest($"vrcnt-activation-{RandomHex(16)}", RandomHex(32), RandomHex(32)), false);
        var result = await engine.ExecuteAsync(request, null, default);
        if (!result.Succeeded) throw new InvalidOperationException(result.ErrorMessage ?? result.ErrorCode ?? "Runtime replacement failed.");
        Console.WriteLine("[complete] VRCNT package installation finished successfully.");
    }
    private static string RandomHex(int byteCount) => Convert.ToHexString(RandomNumberGenerator.GetBytes(byteCount));
    private static async Task<string> AcquireMetadataAsync(Options options, string name)
    {
        var local = Path.Combine(options.InstallerDirectory, name); if (File.Exists(local)) return local;
        var destination = Path.Combine(options.CacheDirectory, name);
        using var response = await Http.GetAsync(new Uri(options.ReleaseBaseUrl.TrimEnd('/') + "/" + name), HttpCompletionOption.ResponseHeadersRead); response.EnsureSuccessStatusCode();
        await using var input = await response.Content.ReadAsStreamAsync(); await using var output = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None); await input.CopyToAsync(output); return destination;
    }
    private sealed class ManifestArchiveAcquirer(PackageManifest manifest, RuntimeVariant variant, Uri releaseBaseUri, string cacheDirectory, HttpClient? client) : IRuntimeArchiveAcquirer
    {
        public Task<IReadOnlyList<string>> AcquireAsync(RuntimeReplacementRequest request, CancellationToken cancellationToken) =>
            new VariantPackageAcquirer(client).AcquireAsync(manifest, variant, releaseBaseUri, cacheDirectory, null, cancellationToken);
    }
    private sealed record Options(string Version, string ReleaseBaseUrl, string InstallerDirectory, string CacheDirectory, string Destination, string ManifestName, string SignatureName, RuntimeVariant Variant, string SevenZipPath, string MinisignPath)
    {
        public static Options Parse(string[] args)
        {
            var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (var index = 0; index < args.Length; index += 2) { if (index + 1 >= args.Length || !args[index].StartsWith("--", StringComparison.Ordinal)) throw new ArgumentException("Installer helper arguments must be --name value pairs."); values[args[index][2..]] = args[index + 1]; }
            string Required(string key) => values.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value) ? value : throw new ArgumentException($"Missing required --{key} argument.");
            var variant = values.TryGetValue("variant", out var rawVariant) && Enum.TryParse<RuntimeVariant>(rawVariant, true, out var parsed) ? parsed : RuntimeVariant.Cpu;
            return new Options(Required("version"), Required("release-base-url"), Path.GetFullPath(Required("installer-directory")), Path.GetFullPath(Required("cache-directory")), Path.GetFullPath(Required("destination")), Required("manifest-name"), Required("signature-name"), variant, Path.GetFullPath(Required("sevenzip")), Path.GetFullPath(Required("minisign")));
        }
    }
}
