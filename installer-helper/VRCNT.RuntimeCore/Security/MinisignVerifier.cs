using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using VRCNT.RuntimeCore.Manifest;

namespace VRCNT.RuntimeCore.Security;

public sealed class MinisignVerifier(string minisignPath) : IManifestSignatureVerifier
{
    public const string EmbeddedManifestPublicKey = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDY4NTYzNUI0QUI2RTI4RkMKUldUOEtHNnJ0RFZXYUt4L1cwOVhIL1NtZXJGQkxzZkVVYXMrWGJZQlZ5NFNPdldRMk9RdUkrVCsK";

    public async Task VerifyAsync(string manifestPath, string signaturePath, CancellationToken cancellationToken)
    {
        if (!File.Exists(minisignPath)) throw new FileNotFoundException("Required bundled tool is missing.", minisignPath);
        var directory = Path.Combine(Path.GetDirectoryName(manifestPath)!, $".signature-verification-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        var signature = Path.Combine(directory, "manifest.minisig");
        var publicKey = Path.Combine(directory, "manifest.pub");
        try
        {
            var encoded = (await File.ReadAllTextAsync(signaturePath, cancellationToken)).Trim().TrimStart('\uFEFF');
            await File.WriteAllBytesAsync(signature, Convert.FromBase64String(encoded), cancellationToken);
            await File.WriteAllBytesAsync(publicKey, Convert.FromBase64String(EmbeddedManifestPublicKey), cancellationToken);
            var start = new ProcessStartInfo(minisignPath) { UseShellExecute = false, CreateNoWindow = true };
            start.ArgumentList.Add("-Vm"); start.ArgumentList.Add(manifestPath); start.ArgumentList.Add("-x"); start.ArgumentList.Add(signature);
            start.ArgumentList.Add("-p"); start.ArgumentList.Add(publicKey); start.ArgumentList.Add("-q");
            using var process = System.Diagnostics.Process.Start(start) ?? throw new InvalidOperationException("Could not start minisign.");
            await process.WaitForExitAsync(cancellationToken);
            if (process.ExitCode != 0) throw new CryptographicException("Package manifest signature verification failed. No package hashes were trusted.");
        }
        catch (CryptographicException) { throw; }
        catch (Exception exception) { throw new CryptographicException("Package manifest signature verification failed. No package hashes were trusted.", exception); }
        finally { try { Directory.Delete(directory, true); } catch { } }
    }
}
