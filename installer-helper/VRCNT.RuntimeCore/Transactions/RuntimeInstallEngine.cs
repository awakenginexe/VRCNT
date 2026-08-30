using System.Security.Cryptography;
using VRCNT.RuntimeCore.Archive;
using VRCNT.RuntimeCore.Filesystem;
using VRCNT.RuntimeCore.Manifest;
using VRCNT.RuntimeCore.Migration;
using VRCNT.RuntimeCore.Models;
using VRCNT.RuntimeCore.Packages;
using VRCNT.RuntimeCore.Paths;
using VRCNT.RuntimeCore.Process;
using VRCNT.RuntimeCore.Security;
using VRCNT.RuntimeCore.Storage;

namespace VRCNT.RuntimeCore.Transactions;

/// <summary>Production adapter that turns a signed release manifest into a transactional runtime install.</summary>
public sealed class RuntimeInstallEngine : IRuntimeTransactionEngine
{
    private readonly string _installerDirectory;
    private readonly string _defaultCacheDirectory;
    private readonly string _minisignPath;
    private readonly string _sevenZipPath;
    private readonly HttpClient _httpClient;

    public RuntimeInstallEngine(
        string installerDirectory,
        string defaultCacheDirectory,
        string minisignPath,
        string sevenZipPath,
        HttpClient? httpClient = null)
    {
        _installerDirectory = Path.GetFullPath(installerDirectory);
        _defaultCacheDirectory = Path.GetFullPath(defaultCacheDirectory);
        _minisignPath = Path.GetFullPath(minisignPath);
        _sevenZipPath = Path.GetFullPath(sevenZipPath);
        _httpClient = httpClient ?? new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
    }

    public async Task<RuntimeOperationResult> ExecuteAsync(
        RuntimeInstallRequest request,
        IProgress<InstallProgress>? progress,
        CancellationToken cancellationToken)
    {
        if (!Uri.TryCreate(request.ReleaseBaseUrl, UriKind.Absolute, out var releaseBase) || releaseBase.Scheme != Uri.UriSchemeHttps)
            throw new InvalidDataException("Runtime installation requires a configured HTTPS release endpoint.");

        Directory.CreateDirectory(_installerDirectory);
        var cacheDirectory = string.IsNullOrWhiteSpace(request.InstallPath)
            ? _defaultCacheDirectory
            : Path.Combine(_defaultCacheDirectory, request.TargetVersion);
        Directory.CreateDirectory(cacheDirectory);
        var localManifestPath = Path.Combine(_installerDirectory, "package-manifest.json");
        var localSignaturePath = Path.Combine(_installerDirectory, "package-manifest.json.sig");
        var hasAdjacentManifest = File.Exists(localManifestPath) && File.Exists(localSignaturePath);
        var manifestPath = hasAdjacentManifest
            ? localManifestPath
            : await AcquireAsync(releaseBase, "package-manifest.json", cacheDirectory, cancellationToken);
        var signaturePath = hasAdjacentManifest
            ? localSignaturePath
            : await AcquireAsync(releaseBase, "package-manifest.json.sig", cacheDirectory, cancellationToken);
        var verified = await new ManifestLoader(new MinisignVerifier(_minisignPath))
            .LoadAndVerifyAsync(manifestPath, signaturePath, request.TargetVersion, cancellationToken);
        var packageKey = request.TargetVariant == RuntimeVariant.Cpu ? "cpu" : "cuda";
        if (!verified.Manifest.Variants.TryGetValue(packageKey, out var package))
            throw new InvalidDataException($"The signed manifest does not offer the requested {packageKey} package.");

        var paths = new UserDataPathResolver();
        var destination = paths.ValidateCustomInstallPath(request.InstallPath);
        var legacyDetector = new LegacyInstallationDetector(paths);
        var archiveProgress = new Progress<VRCNT.RuntimeCore.Packages.TransferProgress>(transfer =>
            progress?.Report(new InstallProgress(TransactionPhase.Acquire, transfer.TotalBytes, transfer.TotalBytesExpected, transfer.Name)));
        var hasAdjacentPackage = package.Parts.All(part => File.Exists(Path.Combine(_installerDirectory, part.Name)));
        var packageDirectory = hasAdjacentPackage ? _installerDirectory : cacheDirectory;
        var packageClient = hasAdjacentPackage ? null : _httpClient;
        var engine = new RuntimeTransactionEngine(
            new ManifestArchiveAcquirer(verified.Manifest, request.TargetVariant, releaseBase, packageDirectory, packageClient, archiveProgress),
            new SevenZipExtractor(_sevenZipPath),
            new RuntimePathValidator(new VolumeIdentityProbe()),
            new RequiredSpaceCalculator(new AvailableSpaceProbe()),
            new RuntimeProcessCoordinator(),
            new NamedPipeRuntimeActivationHealthMonitor(),
            new TransactionJournalStore(),
            new RuntimeDirectoryMover(),
            new LegacyAwareRuntimeStateTransition(new Task3RuntimeStateTransition(), legacyDetector, paths),
            onPreflightValidated: () => legacyDetector.PreserveUserData(legacyDetector.Detect(paths.Resolve(destination))));
        var replacement = new RuntimeReplacementRequest(
            destination,
            packageDirectory,
            package.Parts.Select(part => Path.Combine(packageDirectory, part.Name)).ToArray(),
            package.InstalledSize,
            package.Identity,
            new ActivationRequest($"vrcnt-activation-{Convert.ToHexString(RandomNumberGenerator.GetBytes(16))}", Convert.ToHexString(RandomNumberGenerator.GetBytes(32)), Convert.ToHexString(RandomNumberGenerator.GetBytes(32))),
            request.ForceCloseConfirmed,
            request.ShutdownHandoff);
        return await engine.ExecuteAsync(replacement, progress, cancellationToken);
    }

    private async Task<string> AcquireAsync(Uri releaseBase, string name, string cacheDirectory, CancellationToken cancellationToken)
    {
        var destination = Path.Combine(cacheDirectory, name);
        if (File.Exists(destination)) return destination;
        using var response = await _httpClient.GetAsync(new Uri(releaseBase, name), HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);
        await using var target = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None);
        await source.CopyToAsync(target, cancellationToken);
        return destination;
    }

    private sealed class ManifestArchiveAcquirer(
        PackageManifest manifest,
        RuntimeVariant variant,
        Uri releaseBase,
        string cacheDirectory,
        HttpClient? httpClient,
        IProgress<VRCNT.RuntimeCore.Packages.TransferProgress>? progress) : IRuntimeArchiveAcquirer
    {
        public Task<IReadOnlyList<string>> AcquireAsync(RuntimeReplacementRequest request, CancellationToken cancellationToken) =>
            new VariantPackageAcquirer(httpClient).AcquireAsync(manifest, variant, releaseBase, cacheDirectory, progress, cancellationToken);
    }
}
