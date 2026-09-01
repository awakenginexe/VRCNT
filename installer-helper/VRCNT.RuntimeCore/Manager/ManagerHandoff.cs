using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using VRCNT.RuntimeCore.Manifest;
using VRCNT.RuntimeCore.Models;

namespace VRCNT.RuntimeCore.Manager;

public interface IManagerLifecycle
{
    Task<ManagerSelfCheckResult> CheckAsync(CancellationToken cancellationToken);
    Task<ManagerRepairResult> RepairAsync(Uri latestJsonUri, CancellationToken cancellationToken);
    Task PromoteAsync(string verifiedSetupPath, CancellationToken cancellationToken);
}

public sealed record ManagerRepairResult(
    bool Succeeded,
    string? PromotedPath,
    string? FailureCode);

public sealed record VerifiedManagerUpdate(
    string SetupPath,
    string SignaturePath,
    BootstrapperMetadata? Bootstrapper = null,
    PackageManifest? Manifest = null,
    string? StagingDirectory = null);

internal sealed record ManagerArtifactExpectation(
    BootstrapperMetadata Bootstrapper,
    string SignaturePath,
    ManagerSelfCheck SelfCheck)
{
    public long Size => Bootstrapper.Size;
    public string Sha256 => Bootstrapper.Sha256;
}

internal sealed record VerifiedManagerArtifact(
    string SetupPath,
    BootstrapperMetadata Bootstrapper,
    string SignaturePath,
    ManagerSelfCheck SelfCheck)
{
    public ManagerArtifactExpectation Expectation => new(Bootstrapper, SignaturePath, SelfCheck);
}

public interface IManagerRepairSource
{
    Task<VerifiedManagerUpdate> AcquireAsync(Uri latestJsonUri, CancellationToken cancellationToken);

    Task<VerifiedManagerUpdate> AcquireCurrentAsync(string currentSetupPath, CancellationToken cancellationToken) =>
        Task.FromException<VerifiedManagerUpdate>(new ManagerHandoffException(
            "The running setup package cannot prove its signed manager metadata.",
            "signed_metadata_required"));
}

public sealed class ManagerHandoff
{
    private readonly string _stableManagerPath;
    private readonly Func<string, CancellationToken, Task<ManagerSelfCheckResult>> _newManagerSelfCheck;
    private readonly Func<CancellationToken, Task> _exitOldManager;

    public ManagerHandoff(
        string stableManagerPath,
        Func<string, CancellationToken, Task<ManagerSelfCheckResult>> candidateSelfCheck,
        Func<string, CancellationToken, Task<ManagerSelfCheckResult>> newManagerSelfCheck,
        Func<CancellationToken, Task> exitOldManager)
    {
        _stableManagerPath = Path.GetFullPath(stableManagerPath);
        _candidateSelfCheck = candidateSelfCheck ?? throw new ArgumentNullException(nameof(candidateSelfCheck));
        _newManagerSelfCheck = newManagerSelfCheck ?? throw new ArgumentNullException(nameof(newManagerSelfCheck));
        _exitOldManager = exitOldManager ?? throw new ArgumentNullException(nameof(exitOldManager));
    }

    private readonly Func<string, CancellationToken, Task<ManagerSelfCheckResult>> _candidateSelfCheck;

    internal async Task PromoteAsync(
        VerifiedManagerArtifact artifact,
        CancellationToken cancellationToken)
        => await PromoteAsync(artifact, _candidateSelfCheck, _newManagerSelfCheck, cancellationToken);

    internal async Task PromoteAsync(
        VerifiedManagerArtifact artifact,
        Func<string, CancellationToken, Task<ManagerSelfCheckResult>> candidateSelfCheck,
        Func<string, CancellationToken, Task<ManagerSelfCheckResult>> promotedSelfCheck,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(artifact);
        if (string.IsNullOrWhiteSpace(artifact.SignaturePath))
            throw new ManagerHandoffException("A verified manager artifact must include its setup signature.", "manager_signature_missing");
        var expectedArtifact = artifact.Expectation;
        var verifiedSetupPath = artifact.SetupPath;
        var candidatePath = Path.GetFullPath(verifiedSetupPath);
        EnsureSameVolume(candidatePath, _stableManagerPath);
        EnsureStagedBelowManagerDirectory(candidatePath, _stableManagerPath);
        if (!File.Exists(candidatePath)) throw new ManagerHandoffException("Verified setup candidate is missing.", "candidate_missing");
        if (string.Equals(candidatePath, _stableManagerPath, StringComparison.OrdinalIgnoreCase))
            throw new ManagerHandoffException("The manager cannot replace itself from its active image.", "candidate_is_active_manager");

        await EnsureSelfCheckAsync(candidatePath, candidateSelfCheck, cancellationToken);
        await VerifyArtifactAsync(candidatePath, expectedArtifact, cancellationToken);

        var backupPath = _stableManagerPath + ".last-known-good";
        var hadPrevious = File.Exists(_stableManagerPath);
        await _exitOldManager(cancellationToken);
        // The old process may have held the candidate path open or another process may have
        // changed it while shutdown was in progress. Re-verify immediately before promotion.
        await EnsureSelfCheckAsync(candidatePath, candidateSelfCheck, cancellationToken);
        await VerifyArtifactAsync(candidatePath, expectedArtifact, cancellationToken);
        var promoted = false;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_stableManagerPath)!);
            if (hadPrevious)
                File.Replace(candidatePath, _stableManagerPath, backupPath, true);
            else
                File.Move(candidatePath, _stableManagerPath);
            promoted = true;

            await VerifyArtifactAsync(_stableManagerPath, expectedArtifact, cancellationToken);
            await EnsureSelfCheckAsync(_stableManagerPath, promotedSelfCheck, cancellationToken);
            TryDeleteBackup(backupPath);
        }
        catch (ManagerHandoffException)
        {
            if (promoted)
            {
                Rollback(_stableManagerPath, backupPath, hadPrevious);
                promoted = false;
            }
            throw;
        }
        catch (OperationCanceledException) when (promoted)
        {
            Rollback(_stableManagerPath, backupPath, hadPrevious);
            throw;
        }
        catch (Exception exception) when (promoted)
        {
            Rollback(_stableManagerPath, backupPath, hadPrevious);
            throw new ManagerHandoffException("Manager replacement failed closed.", "manager_handoff_failed", exception);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception)
        {
            throw new ManagerHandoffException("Manager replacement failed closed.", "manager_handoff_failed", exception);
        }
    }

    private static void Rollback(string stablePath, string backupPath, bool hadPrevious)
    {
        if (File.Exists(stablePath)) File.Delete(stablePath);
        if (hadPrevious && File.Exists(backupPath)) File.Move(backupPath, stablePath, true);
    }

    private static async Task<(long Size, string Sha256)> CaptureArtifactAsync(string path, CancellationToken cancellationToken)
    {
        try
        {
            await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1024 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
            var size = stream.Length;
            var hash = Convert.ToHexString(await SHA256.HashDataAsync(stream, cancellationToken)).ToLowerInvariant();
            if (stream.Length != size) throw new IOException("The manager candidate changed while it was being hashed.");
            return (size, hash);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            throw new ManagerHandoffException("The manager candidate could not be fingerprinted.", "candidate_changed", exception);
        }
    }

    private static async Task VerifyArtifactAsync(string path, ManagerArtifactExpectation expected, CancellationToken cancellationToken)
    {
        var signedCheck = await expected.SelfCheck.CheckAsync(path, expected.Bootstrapper, expected.SignaturePath, cancellationToken);
        if (!signedCheck.IsIntact || !signedCheck.IsCompatible)
            throw new ManagerHandoffException("The manager artifact failed signed verification.", signedCheck.FailureCode ?? "manager_verification_failed");
        var actual = await CaptureArtifactAsync(path, cancellationToken);
        if (actual.Size != expected.Size || !string.Equals(actual.Sha256, expected.Sha256, StringComparison.OrdinalIgnoreCase))
            throw new ManagerHandoffException("The manager candidate changed before promotion.", "candidate_changed");
    }

    private static void TryDeleteBackup(string backupPath)
    {
        try
        {
            if (File.Exists(backupPath)) File.Delete(backupPath);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private static void EnsureSameVolume(string candidatePath, string stablePath)
    {
        var candidateRoot = Path.GetPathRoot(candidatePath);
        var stableRoot = Path.GetPathRoot(stablePath);
        if (string.IsNullOrWhiteSpace(candidateRoot) || !string.Equals(candidateRoot, stableRoot, StringComparison.OrdinalIgnoreCase))
            throw new ManagerHandoffException("Manager handoff must stay on one volume.", "different_volume");
    }

    private static void EnsureStagedBelowManagerDirectory(string candidatePath, string stablePath)
    {
        var managerDirectory = Path.GetDirectoryName(stablePath)!;
        var relative = Path.GetRelativePath(managerDirectory, candidatePath);
        if (relative == "." || relative.StartsWith("..", StringComparison.Ordinal) || Path.IsPathRooted(relative))
            throw new ManagerHandoffException("Manager candidates must be staged below the stable manager directory.", "candidate_outside_manager_directory");
    }

    private static async Task EnsureSelfCheckAsync(
        string path,
        Func<string, CancellationToken, Task<ManagerSelfCheckResult>> selfCheck,
        CancellationToken cancellationToken)
    {
        var result = await selfCheck(path, cancellationToken);
        if (!result.IsIntact || !result.IsCompatible)
            throw new ManagerHandoffException("The manager candidate failed its self-check.", result.FailureCode ?? "manager_self_check_failed");
    }
}

public sealed class ManagerHandoffException(string message, string failureCode, Exception? innerException = null)
    : Exception(message, innerException)
{
    public string FailureCode { get; } = failureCode;
}

/// <summary>Waits for any other stable manager image to exit; it never treats the current stable image as stopped.</summary>
public sealed class ProcessManagerExitCoordinator(string stableManagerPath)
{
    private readonly string _stableManagerPath = Path.GetFullPath(stableManagerPath);

    public async Task ExitAndWaitAsync(CancellationToken cancellationToken)
    {
        var currentPath = TryGetCurrentProcessPath() ?? throw new ManagerHandoffException(
            "The current manager process path could not be determined before replacement.",
            "current_process_path_unavailable");
        if (PathsEqual(currentPath, _stableManagerPath))
            throw new ManagerHandoffException("The stable manager must be handed off by an out-of-process launcher before replacement.", "out_of_process_handoff_required");

        var deadline = DateTimeOffset.UtcNow + TimeSpan.FromSeconds(30);
        while (DateTimeOffset.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!IsStableManagerRunning()) return;
            await Task.Delay(100, cancellationToken);
        }
        throw new ManagerHandoffException("The previous stable manager did not exit before replacement.", "manager_exit_timeout");
    }

    private bool IsStableManagerRunning()
    {
        foreach (var process in System.Diagnostics.Process.GetProcesses())
        {
            try
            {
                if (process.Id != Environment.ProcessId && process.MainModule?.FileName is { } path && PathsEqual(path, _stableManagerPath)) return true;
            }
            catch (Exception exception) when (exception is InvalidOperationException or System.ComponentModel.Win32Exception or NotSupportedException) { }
            finally { process.Dispose(); }
        }
        return false;
    }

    private static string? TryGetCurrentProcessPath()
    {
        try { return System.Diagnostics.Process.GetCurrentProcess().MainModule?.FileName; }
        catch (Exception exception) when (exception is InvalidOperationException or System.ComponentModel.Win32Exception or NotSupportedException) { return null; }
    }

    private static bool PathsEqual(string left, string right) => string.Equals(Path.GetFullPath(left), Path.GetFullPath(right), StringComparison.OrdinalIgnoreCase);
}

public sealed class SetupManagerLifecycle : IManagerLifecycle
{
    private readonly string _managerPath;
    private readonly PackageManifest? _manifest;
    private readonly ManagerSelfCheck _selfCheck;
    private readonly ManagerStateStore _stateStore;
    private readonly IManagerRepairSource _repairSource;
    private readonly ManagerHandoff _handoff;

    public SetupManagerLifecycle(
        string managerPath,
        PackageManifest? manifest,
        ManagerSelfCheck selfCheck,
        ManagerStateStore stateStore,
        IManagerRepairSource repairSource,
        ManagerHandoff handoff)
    {
        _managerPath = Path.GetFullPath(managerPath);
        _manifest = manifest;
        _selfCheck = selfCheck;
        _stateStore = stateStore;
        _repairSource = repairSource;
        _handoff = handoff;
    }

    public async Task<ManagerSelfCheckResult> CheckAsync(CancellationToken cancellationToken)
    {
        // manager-state.json is diagnostic telemetry only. Integrity and compatibility are
        // established from the manager image and signed bootstrapper metadata.
        return _manifest is null
            ? new ManagerSelfCheckResult(false, false, "manager_metadata_unavailable")
            : await _selfCheck.CheckAsync(_managerPath, _manifest, null, cancellationToken);
    }

    public async Task<ManagerRepairResult> RepairAsync(Uri latestJsonUri, CancellationToken cancellationToken)
    {
        try
        {
            return await PromoteVerifiedAsync(await _repairSource.AcquireAsync(latestJsonUri, cancellationToken), cancellationToken);
        }
        catch (ManagerHandoffException exception)
        {
            return new ManagerRepairResult(false, null, exception.FailureCode);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception)
        {
            return new ManagerRepairResult(false, null, "repair_failed");
        }
    }

    public async Task PromoteAsync(string verifiedSetupPath, CancellationToken cancellationToken)
    {
        try
        {
            var result = await PromoteVerifiedAsync(
                await _repairSource.AcquireCurrentAsync(verifiedSetupPath, cancellationToken),
                cancellationToken);
            if (!result.Succeeded)
                throw new ManagerHandoffException("The running setup package could not be promoted as the trusted manager.", result.FailureCode ?? "manager_promotion_failed");
        }
        catch (ManagerHandoffException)
        {
            throw;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            throw new ManagerHandoffException("The running setup package could not be promoted as the trusted manager.", "manager_promotion_failed", exception);
        }
    }

    private async Task<ManagerRepairResult> PromoteVerifiedAsync(VerifiedManagerUpdate update, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(update.SignaturePath))
            return new ManagerRepairResult(false, null, "manager_signature_missing");
        try
        {
            var expectedManifest = update.Manifest ?? _manifest ?? throw new InvalidDataException("Signed manager metadata is required for repair.");
            var expectedBootstrapper = update.Bootstrapper ?? expectedManifest.Bootstrapper;
            var candidateCheck = await _selfCheck.CheckAsync(update.SetupPath, expectedBootstrapper, update.SignaturePath, cancellationToken);
            if (!candidateCheck.IsIntact || !candidateCheck.IsCompatible)
                return new ManagerRepairResult(false, null, candidateCheck.FailureCode);

            await _handoff.PromoteAsync(
                new VerifiedManagerArtifact(update.SetupPath, expectedBootstrapper, update.SignaturePath, _selfCheck),
                (path, _) => _selfCheck.CheckAsync(path, expectedBootstrapper, update.SignaturePath, cancellationToken),
                (path, _) => _selfCheck.CheckAsync(path, expectedBootstrapper, update.SignaturePath, cancellationToken),
                cancellationToken);
            // The promoted image was just verified against this signed hash. Reuse it for
            // diagnostics so a post-promotion read failure cannot turn success into failure.
            var hash = expectedBootstrapper.Sha256;
            try
            {
                _stateStore.WriteAuthenticated(new ManagerState(
                    _managerPath,
                    hash,
                    expectedManifest.Version,
                    expectedBootstrapper.ManagerProtocol,
                    expectedBootstrapper.ManifestSchema,
                    expectedBootstrapper.RuntimeStateSchema,
                    expectedBootstrapper.ActivationProtocol,
                    true,
                    null,
                    DateTimeOffset.UtcNow), update.SignaturePath);
            }
            catch
            {
                // Promotion and its post-promotion self-check already succeeded. A diagnostic
                // sidecar failure must not report repair failure or remove the verified manager.
            }
            TryDeleteStagingDirectory(update.StagingDirectory);
            return new ManagerRepairResult(true, _managerPath, null);
        }
        catch (ManagerHandoffException exception)
        {
            return new ManagerRepairResult(false, null, exception.FailureCode);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception)
        {
            return new ManagerRepairResult(false, null, "repair_failed");
        }
    }

    private static void TryDeleteStagingDirectory(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        try { if (Directory.Exists(path)) Directory.Delete(path, true); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

}

public sealed class HttpManagerRepairSource : IManagerRepairSource
{
    private readonly ManagerCapabilities _capabilities;
    private readonly IManifestLoader _manifestLoader;
    private readonly ISetupSignatureVerifier _setupSignatureVerifier;
    private readonly HttpClient _httpClient;
    private readonly Uri _releaseEndpoint;
    private readonly string _managerDirectory;

    public HttpManagerRepairSource(
        ManagerCapabilities capabilities,
        IManifestLoader manifestLoader,
        ISetupSignatureVerifier setupSignatureVerifier,
        Uri releaseEndpoint,
        string managerDirectory,
        HttpClient? httpClient = null)
    {
        _capabilities = capabilities;
        _manifestLoader = manifestLoader;
        _setupSignatureVerifier = setupSignatureVerifier;
        _releaseEndpoint = ValidateReleaseEndpoint(releaseEndpoint);
        _managerDirectory = Path.GetFullPath(managerDirectory);
        _httpClient = httpClient ?? new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
    }

    public async Task<VerifiedManagerUpdate> AcquireAsync(Uri latestJsonUri, CancellationToken cancellationToken)
    {
        EnsureReleaseUri(latestJsonUri);
        var root = Path.Combine(_managerDirectory, "repair", $"repair-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        var latest = await ReadJsonAsync(latestJsonUri, cancellationToken);
        var version = latest.RootElement.GetProperty("version").GetString();
        if (!string.Equals(version, _capabilities.Version, StringComparison.Ordinal)) throw new InvalidDataException("Latest manager metadata version is incompatible.");
        var platform = latest.RootElement.GetProperty("platforms").GetProperty("windows-x86_64");
        var setupUri = new Uri(platform.GetProperty("url").GetString() ?? throw new InvalidDataException("Latest manager metadata has no setup URL."));
        EnsureReleaseUri(setupUri);
        var signature = platform.GetProperty("signature").GetString();
        if (string.IsNullOrWhiteSpace(signature)) throw new CryptographicException("Latest manager metadata has no setup signature.");

        var setupName = Path.GetFileName(setupUri.LocalPath);
        if (string.IsNullOrWhiteSpace(setupName) || setupName is "." or "..") throw new InvalidDataException("Latest manager metadata has an unsafe setup name.");
        var setupPath = Path.Combine(root, setupName);
        var signaturePath = setupPath + ".sig";
        await DownloadAsync(setupUri, setupPath, cancellationToken);
        await File.WriteAllTextAsync(signaturePath, signature, cancellationToken);

        var manifestPath = Path.Combine(root, "package-manifest.json");
        var manifestSignaturePath = manifestPath + ".sig";
        await DownloadAsync(new Uri(new Uri(latestJsonUri, "."), "package-manifest.json"), manifestPath, cancellationToken);
        await DownloadAsync(new Uri(new Uri(latestJsonUri, "."), "package-manifest.json.sig"), manifestSignaturePath, cancellationToken);
        return await VerifyCandidateAsync(setupPath, signaturePath, manifestPath, manifestSignaturePath, root, cancellationToken);
    }

    public async Task<VerifiedManagerUpdate> AcquireCurrentAsync(string currentSetupPath, CancellationToken cancellationToken)
    {
        var sourcePath = Path.GetFullPath(currentSetupPath);
        var sourceDirectory = Path.GetDirectoryName(sourcePath) ?? throw new InvalidDataException("The running setup package path is invalid.");
        var signatureSourcePath = sourcePath + ".sig";
        var manifestSourcePath = Path.Combine(sourceDirectory, "package-manifest.json");
        var manifestSignatureSourcePath = manifestSourcePath + ".sig";
        if (!File.Exists(sourcePath) || !File.Exists(signatureSourcePath) || !File.Exists(manifestSourcePath) || !File.Exists(manifestSignatureSourcePath))
            return await AcquireAsync(new Uri(_releaseEndpoint, $"download/v{_capabilities.Version}/latest.json"), cancellationToken);

        var setupName = Path.GetFileName(sourcePath);
        if (string.IsNullOrWhiteSpace(setupName) || setupName is "." or "..")
            throw new InvalidDataException("The running setup package has an unsafe file name.");
        var root = Path.Combine(_managerDirectory, "staging", $"bootstrap-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            var setupPath = Path.Combine(root, setupName);
            var signaturePath = setupPath + ".sig";
            var manifestPath = Path.Combine(root, "package-manifest.json");
            var manifestSignaturePath = manifestPath + ".sig";
            File.Copy(sourcePath, setupPath);
            File.Copy(signatureSourcePath, signaturePath);
            File.Copy(manifestSourcePath, manifestPath);
            File.Copy(manifestSignatureSourcePath, manifestSignaturePath);
            return await VerifyCandidateAsync(setupPath, signaturePath, manifestPath, manifestSignaturePath, root, cancellationToken);
        }
        catch
        {
            TryDeleteDirectory(root);
            throw;
        }
    }

    private async Task<VerifiedManagerUpdate> VerifyCandidateAsync(
        string setupPath,
        string signaturePath,
        string manifestPath,
        string manifestSignaturePath,
        string stagingDirectory,
        CancellationToken cancellationToken)
    {
        var verified = await _manifestLoader.LoadAndVerifyAsync(manifestPath, manifestSignaturePath, _capabilities.Version, cancellationToken);
        if (!_capabilities.IsCompatibleWith(verified.Manifest) || verified.Manifest.Bootstrapper is null)
            throw new InvalidDataException("Signed manager metadata is incompatible.");
        if (!string.Equals(Path.GetFileName(setupPath), verified.Manifest.Bootstrapper.Name, StringComparison.Ordinal))
            throw new InvalidDataException("Signed manager metadata does not identify the running setup package.");
        await _setupSignatureVerifier.VerifyAsync(setupPath, signaturePath, cancellationToken);
        var bootstrapper = verified.Manifest.Bootstrapper;
        var file = new FileInfo(setupPath);
        if (file.Length != bootstrapper.Size) throw new InvalidDataException("Repaired setup size does not match signed metadata.");
        await using var stream = File.OpenRead(setupPath);
        var actualHash = Convert.ToHexString(await SHA256.HashDataAsync(stream, cancellationToken)).ToLowerInvariant();
        if (!string.Equals(actualHash, bootstrapper.Sha256, StringComparison.OrdinalIgnoreCase)) throw new CryptographicException("Repaired setup hash does not match signed metadata.");
        return new VerifiedManagerUpdate(setupPath, signaturePath, bootstrapper, verified.Manifest, stagingDirectory);
    }

    private async Task DownloadAsync(Uri uri, string path, CancellationToken cancellationToken)
    {
        using var response = await _httpClient.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);
        await using var destination = File.Create(path);
        await source.CopyToAsync(destination, cancellationToken);
    }

    private async Task<JsonDocument> ReadJsonAsync(Uri uri, CancellationToken cancellationToken)
    {
        using var response = await _httpClient.GetAsync(uri, cancellationToken);
        response.EnsureSuccessStatusCode();
        return JsonDocument.Parse(await response.Content.ReadAsStreamAsync(cancellationToken));
    }

    private Uri ValidateReleaseEndpoint(Uri uri)
    {
        if (!uri.IsAbsoluteUri || uri.Scheme != Uri.UriSchemeHttps)
            throw new InvalidDataException("Manager repair requires a configured HTTPS release endpoint.");
        return uri;
    }

    private void EnsureReleaseUri(Uri uri)
    {
        if (!uri.IsAbsoluteUri || uri.Scheme != Uri.UriSchemeHttps ||
            !string.Equals(uri.Host, _releaseEndpoint.Host, StringComparison.OrdinalIgnoreCase) ||
            !uri.AbsolutePath.StartsWith(_releaseEndpoint.AbsolutePath, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Manager repair metadata and assets must come from the configured HTTPS release endpoint.");
    }

    private static void TryDeleteDirectory(string path)
    {
        try { if (Directory.Exists(path)) Directory.Delete(path, true); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}
