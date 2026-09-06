using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using VRCNT.RuntimeCore.Manifest;
using VRCNT.RuntimeCore.Models;
using VRCNT.RuntimeCore.Security;

namespace VRCNT.RuntimeCore.Manager;

public sealed record ManagerSelfCheckResult(
    bool IsIntact,
    bool IsCompatible,
    string? FailureCode);

public interface ISetupSignatureVerifier
{
    Task VerifyAsync(string setupPath, string signaturePath, CancellationToken cancellationToken);
}

public sealed class MinisignSetupSignatureVerifier(string minisignPath) : ISetupSignatureVerifier
{
    private readonly MinisignVerifier _verifier = new(minisignPath);

    public Task VerifyAsync(string setupPath, string signaturePath, CancellationToken cancellationToken) =>
        _verifier.VerifyAsync(setupPath, signaturePath, cancellationToken);
}

public sealed class ManagerSelfCheck(ManagerCapabilities capabilities, ISetupSignatureVerifier? signatureVerifier = null)
{
    public Task<ManagerSelfCheckResult> CheckEmbeddedAsync(string managerPath, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!File.Exists(managerPath)) return Task.FromResult(Failure("manager_missing"));
        try
        {
            var expectedVersion = Version.Parse(capabilities.Version);
            var fileVersion = FileVersionInfo.GetVersionInfo(managerPath).FileVersion;
            var actualVersion = Version.TryParse(fileVersion, out var parsedFileVersion)
                ? parsedFileVersion
                : AssemblyName.GetAssemblyName(managerPath).Version;
            return Task.FromResult(actualVersion is not null && actualVersion.Major == expectedVersion.Major &&
                actualVersion.Minor == expectedVersion.Minor && actualVersion.Build == expectedVersion.Build
                ? new ManagerSelfCheckResult(true, true, null)
                : Failure("manager_embedded_version_mismatch"));
        }
        catch (Exception exception) when (exception is BadImageFormatException or FileLoadException or IOException or UnauthorizedAccessException)
        {
            return Task.FromResult(Failure("manager_embedded_metadata_invalid"));
        }
    }

    public async Task<ManagerSelfCheckResult> CheckAsync(
        string managerPath,
        PackageManifest manifest,
        string? signaturePath,
        CancellationToken cancellationToken)
    {
        if (!capabilities.IsCompatibleWith(manifest)) return Failure("manager_incompatible");
        return await CheckAsync(managerPath, manifest.Bootstrapper, signaturePath, cancellationToken);
    }

    public async Task<ManagerSelfCheckResult> CheckAsync(
        string managerPath,
        BootstrapperMetadata expected,
        string? signaturePath,
        CancellationToken cancellationToken)
    {
        if (!capabilities.IsCompatibleWith(expected)) return Failure("manager_incompatible");
        if (!File.Exists(managerPath)) return Failure("manager_missing");

        try
        {
            var file = new FileInfo(managerPath);
            if (file.Length != expected.Size) return Failure("manager_size_mismatch");
            await using var stream = File.OpenRead(managerPath);
            var actualHash = Convert.ToHexString(await SHA256.HashDataAsync(stream, cancellationToken)).ToLowerInvariant();
            if (!string.Equals(actualHash, expected.Sha256, StringComparison.OrdinalIgnoreCase)) return Failure("manager_hash_mismatch");
            if (signaturePath is not null)
            {
                if (signatureVerifier is null || !File.Exists(signaturePath)) return Failure("manager_signature_missing");
                await signatureVerifier.VerifyAsync(managerPath, signaturePath, cancellationToken);
            }
            return new ManagerSelfCheckResult(true, true, null);
        }
        catch (CryptographicException)
        {
            return Failure("manager_signature_invalid");
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException)
        {
            return Failure("manager_check_failed");
        }
    }

    private static ManagerSelfCheckResult Failure(string code) => new(false, false, code);
}
