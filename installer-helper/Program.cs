using System.Diagnostics;
using VRCNT.RuntimeCore.Manifest;
using VRCNT.RuntimeCore.Models;
using VRCNT.RuntimeCore.Packages;
using VRCNT.RuntimeCore.Migration;
using VRCNT.RuntimeCore.Paths;
using VRCNT.RuntimeCore.Security;
using VRCNT.RuntimeCore.State;

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
        var userDataPaths = pathResolver.Resolve(options.Destination);
        var canonicalDestination = pathResolver.ValidateCustomInstallPath(options.Destination);
        var payloadIdentityReader = new PayloadIdentityReader();
        var offline = package.Parts.All(part => File.Exists(Path.Combine(options.InstallerDirectory, part.Name)));
        Console.WriteLine(offline ? "[source] Found all signed manifest-selected package files beside the installer." : "[source] Downloading missing manifest-selected package files.");
        var paths = await new VariantPackageAcquirer(offline ? null : Http).AcquireAsync(verified.Manifest, options.Variant, new Uri(options.ReleaseBaseUrl.TrimEnd('/') + "/"), offline ? options.InstallerDirectory : options.CacheDirectory, null, default);
        var staging = Path.Combine(options.CacheDirectory, $"staging-{Guid.NewGuid():N}");
        Directory.CreateDirectory(staging);
        try
        {
            await RunProcessAsync(options.SevenZipPath, ["x", "-y", "-aoa", $"-o{staging}", paths[0]]);
            if (options.Variant == RuntimeVariant.Cpu) CpuPayloadValidator.ValidateStagedPayload(staging);
            else if (!File.Exists(Path.Combine(staging, "VRCNT.exe"))) throw new InvalidDataException("Staged payload is missing VRCNT.exe.");
            if (!File.Exists(Path.Combine(staging, "VRCNT-backend.exe"))) throw new InvalidDataException("Staged payload is missing VRCNT-backend.exe.");
            payloadIdentityReader.ReadAndValidate(staging, package.MarkerPath, package.Identity);
            if (Directory.Exists(canonicalDestination))
            {
                var state = new RuntimeStateStore().Read(userDataPaths.DataRoot);
                var validated = new RuntimeStateValidator(payloadIdentityReader).Validate(state, canonicalDestination, package);
                if (validated.Status != RuntimeStateStatus.Active)
                    throw new InvalidDataException("Existing runtime identity cannot authorize replacement; recovery or migration is required.");
            }
            var legacy = new LegacyInstallationDetector(pathResolver).Detect(userDataPaths);
            new LegacyInstallationDetector(pathResolver).PreserveUserData(legacy);
            CopyStagedPayload(staging, canonicalDestination);
            new RuntimeStateStore().WriteAtomic(userDataPaths.DataRoot, new RuntimeState(
                1, RuntimeStateStatus.Active, package.Identity.Product, package.Identity.Version, package.Identity.Variant,
                package.Identity.Architecture, canonicalDestination, package.Identity.BuildIdentity, package.Identity.MarkerSha256,
                DateTimeOffset.UtcNow));
        }
        finally { TryDeleteDirectory(staging); }
        if (!offline) foreach (var path in paths) { TryDelete(path); TryDelete(path + ".partial"); }
        Console.WriteLine("[complete] VRCNT package installation finished successfully.");
    }
    private static async Task<string> AcquireMetadataAsync(Options options, string name)
    {
        var local = Path.Combine(options.InstallerDirectory, name); if (File.Exists(local)) return local;
        var destination = Path.Combine(options.CacheDirectory, name);
        using var response = await Http.GetAsync(new Uri(options.ReleaseBaseUrl.TrimEnd('/') + "/" + name), HttpCompletionOption.ResponseHeadersRead); response.EnsureSuccessStatusCode();
        await using var input = await response.Content.ReadAsStreamAsync(); await using var output = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None); await input.CopyToAsync(output); return destination;
    }
    private static async Task RunProcessAsync(string executable, IEnumerable<string> arguments)
    {
        if (!File.Exists(executable)) throw new FileNotFoundException("Required bundled tool is missing.", executable);
        var info = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true }; foreach (var argument in arguments) info.ArgumentList.Add(argument);
        using var process = Process.Start(info) ?? throw new InvalidOperationException($"Could not start {executable}."); await process.WaitForExitAsync(); if (process.ExitCode != 0) throw new InvalidOperationException($"{Path.GetFileName(executable)} failed with exit code {process.ExitCode}.");
    }
    private static void TryDelete(string path) { try { if (File.Exists(path)) File.Delete(path); } catch { } }
    private static void TryDeleteDirectory(string path) { try { if (Directory.Exists(path)) Directory.Delete(path, true); } catch { } }
    private static void CopyStagedPayload(string source, string destination)
    {
        foreach (var directory in Directory.EnumerateDirectories(source, "*", SearchOption.AllDirectories)) Directory.CreateDirectory(Path.Combine(destination, Path.GetRelativePath(source, directory)));
        Directory.CreateDirectory(destination);
        foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories)) File.Copy(file, Path.Combine(destination, Path.GetRelativePath(source, file)), true);
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
