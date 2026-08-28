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
    PackageManifest? Manifest = null);

public interface IManagerRepairSource
{
    Task<VerifiedManagerUpdate> AcquireAsync(Uri latestJsonUri, CancellationToken cancellationToken);
}

public sealed class ManagerHandoff
{
    private readonly string _stableManagerPath;
    private readonly Func<string, CancellationToken, Task<ManagerSelfCheckResult>> _newManagerSelfCheck;
    private readonly Func<CancellationToken, Task> _exitOldManager;

    public ManagerHandoff(
        string stableManagerPath,
        Func<string, CancellationToken, Task<ManagerSelfCheckResult>>? newManagerSelfCheck = null,
        Func<CancellationToken, Task>? exitOldManager = null)
    {
        _stableManagerPath = Path.GetFullPath(stableManagerPath);
        _newManagerSelfCheck = newManagerSelfCheck ?? ((_, _) => Task.FromResult(new ManagerSelfCheckResult(true, true, null)));
        _exitOldManager = exitOldManager ?? (_ => Task.CompletedTask);
    }

    public async Task PromoteAsync(string verifiedSetupPath, CancellationToken cancellationToken)
    {
        var candidatePath = Path.GetFullPath(verifiedSetupPath);
        EnsureSameVolume(candidatePath, _stableManagerPath);
        if (!File.Exists(candidatePath)) throw new ManagerHandoffException("Verified setup candidate is missing.", "candidate_missing");
        if (string.Equals(candidatePath, _stableManagerPath, StringComparison.OrdinalIgnoreCase))
            throw new ManagerHandoffException("The manager cannot replace itself from its active image.", "candidate_is_active_manager");

        var backupPath = _stableManagerPath + ".last-known-good";
        var hadPrevious = File.Exists(_stableManagerPath);
        await _exitOldManager(cancellationToken);
        var promoted = false;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_stableManagerPath)!);
            if (hadPrevious)
                File.Replace(candidatePath, _stableManagerPath, backupPath, true);
            else
                File.Move(candidatePath, _stableManagerPath);
            promoted = true;

            var selfCheck = await _newManagerSelfCheck(_stableManagerPath, cancellationToken);
            if (!selfCheck.IsIntact || !selfCheck.IsCompatible)
            {
                Rollback(_stableManagerPath, backupPath, hadPrevious);
                promoted = false;
                throw new ManagerHandoffException("The promoted manager failed its self-check.", selfCheck.FailureCode ?? "manager_self_check_failed");
            }
            if (File.Exists(backupPath)) File.Delete(backupPath);
        }
        catch (ManagerHandoffException)
        {
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

    private static void EnsureSameVolume(string candidatePath, string stablePath)
    {
        var candidateRoot = Path.GetPathRoot(candidatePath);
        var stableRoot = Path.GetPathRoot(stablePath);
        if (string.IsNullOrWhiteSpace(candidateRoot) || !string.Equals(candidateRoot, stableRoot, StringComparison.OrdinalIgnoreCase))
            throw new ManagerHandoffException("Manager handoff must stay on one volume.", "different_volume");
    }
}

public sealed class ManagerHandoffException(string message, string failureCode, Exception? innerException = null)
    : Exception(message, innerException)
{
    public string FailureCode { get; } = failureCode;
}

public sealed class SetupManagerLifecycle : IManagerLifecycle
{
    private readonly string _managerPath;
    private readonly PackageManifest _manifest;
    private readonly ManagerSelfCheck _selfCheck;
    private readonly ManagerStateStore _stateStore;
    private readonly IManagerRepairSource _repairSource;
    private readonly ManagerHandoff _handoff;

    public SetupManagerLifecycle(
        string managerPath,
        PackageManifest manifest,
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
        if (_stateStore.Read() is null) return new ManagerSelfCheckResult(false, false, "manager_state_missing");
        return await _selfCheck.CheckAsync(_managerPath, _manifest, null, cancellationToken);
    }

    public async Task<ManagerRepairResult> RepairAsync(Uri latestJsonUri, CancellationToken cancellationToken)
    {
        try
        {
            var update = await _repairSource.AcquireAsync(latestJsonUri, cancellationToken);
            var expectedManifest = update.Manifest ?? _manifest;
            var expectedBootstrapper = update.Bootstrapper ?? expectedManifest.Bootstrapper;
            var candidateCheck = await _selfCheck.CheckAsync(update.SetupPath, expectedBootstrapper, update.SignaturePath, cancellationToken);
            if (!candidateCheck.IsIntact || !candidateCheck.IsCompatible)
                return new ManagerRepairResult(false, null, candidateCheck.FailureCode);

            await _handoff.PromoteAsync(update.SetupPath, cancellationToken);
            var hash = await HashAsync(_managerPath, cancellationToken);
            _stateStore.Write(new ManagerState(
                _managerPath,
                hash,
                expectedManifest.Version,
                expectedBootstrapper.ManagerProtocol,
                expectedBootstrapper.ManifestSchema,
                expectedBootstrapper.RuntimeStateSchema,
                expectedBootstrapper.ActivationProtocol,
                true,
                null,
                DateTimeOffset.UtcNow));
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

    public Task PromoteAsync(string verifiedSetupPath, CancellationToken cancellationToken) =>
        _handoff.PromoteAsync(verifiedSetupPath, cancellationToken);

    private static async Task<string> HashAsync(string path, CancellationToken cancellationToken)
    {
        await using var stream = File.OpenRead(path);
        return Convert.ToHexString(await SHA256.HashDataAsync(stream, cancellationToken)).ToLowerInvariant();
    }
}

public sealed class HttpManagerRepairSource : IManagerRepairSource
{
    private readonly ManagerCapabilities _capabilities;
    private readonly IManifestLoader _manifestLoader;
    private readonly ISetupSignatureVerifier _setupSignatureVerifier;
    private readonly HttpClient _httpClient;

    public HttpManagerRepairSource(
        ManagerCapabilities capabilities,
        IManifestLoader manifestLoader,
        ISetupSignatureVerifier setupSignatureVerifier,
        HttpClient? httpClient = null)
    {
        _capabilities = capabilities;
        _manifestLoader = manifestLoader;
        _setupSignatureVerifier = setupSignatureVerifier;
        _httpClient = httpClient ?? new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
    }

    public async Task<VerifiedManagerUpdate> AcquireAsync(Uri latestJsonUri, CancellationToken cancellationToken)
    {
        EnsureRemoteUri(latestJsonUri);
        var root = Path.Combine(Path.GetTempPath(), "VRCNTInstaller", $"repair-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        var latest = await ReadJsonAsync(latestJsonUri, cancellationToken);
        var version = latest.RootElement.GetProperty("version").GetString();
        if (!string.Equals(version, _capabilities.Version, StringComparison.Ordinal)) throw new InvalidDataException("Latest manager metadata version is incompatible.");
        var platform = latest.RootElement.GetProperty("platforms").GetProperty("windows-x86_64");
        var setupUri = new Uri(platform.GetProperty("url").GetString() ?? throw new InvalidDataException("Latest manager metadata has no setup URL."));
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
        var verified = await _manifestLoader.LoadAndVerifyAsync(manifestPath, manifestSignaturePath, _capabilities.Version, cancellationToken);
        if (!_capabilities.IsCompatibleWith(verified.Manifest) || verified.Manifest.Bootstrapper is null)
            throw new InvalidDataException("Signed manager metadata is incompatible.");
        await _setupSignatureVerifier.VerifyAsync(setupPath, signaturePath, cancellationToken);
        var bootstrapper = verified.Manifest.Bootstrapper;
        var file = new FileInfo(setupPath);
        if (file.Length != bootstrapper.Size) throw new InvalidDataException("Repaired setup size does not match signed metadata.");
        await using var stream = File.OpenRead(setupPath);
        var actualHash = Convert.ToHexString(await SHA256.HashDataAsync(stream, cancellationToken)).ToLowerInvariant();
        if (!string.Equals(actualHash, bootstrapper.Sha256, StringComparison.OrdinalIgnoreCase)) throw new CryptographicException("Repaired setup hash does not match signed metadata.");
        return new VerifiedManagerUpdate(setupPath, signaturePath, bootstrapper, verified.Manifest);
    }

    private async Task DownloadAsync(Uri uri, string path, CancellationToken cancellationToken)
    {
        if (uri.IsFile)
        {
            File.Copy(uri.LocalPath, path, true);
            return;
        }
        using var response = await _httpClient.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);
        await using var destination = File.Create(path);
        await source.CopyToAsync(destination, cancellationToken);
    }

    private async Task<JsonDocument> ReadJsonAsync(Uri uri, CancellationToken cancellationToken)
    {
        if (uri.IsFile) return JsonDocument.Parse(await File.ReadAllTextAsync(uri.LocalPath, cancellationToken));
        using var response = await _httpClient.GetAsync(uri, cancellationToken);
        response.EnsureSuccessStatusCode();
        return JsonDocument.Parse(await response.Content.ReadAsStreamAsync(cancellationToken));
    }

    private static void EnsureRemoteUri(Uri uri)
    {
        if (!uri.IsAbsoluteUri || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeFile))
            throw new InvalidDataException("Manager repair requires an absolute HTTP(S) or local metadata URI.");
    }
}
