using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using VRCNT.RuntimeCore.Manifest;
using VRCNT.RuntimeCore.Models;

namespace VRCNT.RuntimeCore.Packages;

public sealed record TransferProgress(string Name, long FileBytes, long FileTotal, long TotalBytes, long TotalBytesExpected);

public interface IVariantPackageAcquirer
{
    Task<IReadOnlyList<string>> AcquireAsync(PackageManifest manifest, RuntimeVariant variant, Uri releaseBaseUri, string cacheDirectory, IProgress<TransferProgress>? progress, CancellationToken cancellationToken);
}

public sealed class VariantPackageAcquirer(HttpClient? httpClient) : IVariantPackageAcquirer
{
    public async Task<IReadOnlyList<string>> AcquireAsync(PackageManifest manifest, RuntimeVariant variant, Uri releaseBaseUri, string cacheDirectory, IProgress<TransferProgress>? progress, CancellationToken cancellationToken)
    {
        var key = variant == RuntimeVariant.Cpu ? "cpu" : "cuda";
        if (!manifest.Variants.TryGetValue(key, out var package)) throw new InvalidDataException($"Package manifest does not contain variant '{key}'.");
        Directory.CreateDirectory(cacheDirectory);
        var total = package.Parts.Sum(part => part.Size);
        var complete = new List<string>();
        long completed = 0;
        foreach (var part in package.Parts)
        {
            if (!ManifestLoader.IsSafeAssetName(part.Name) || part.Size <= 0 || !ManifestLoader.IsSha256(part.Sha256)) throw new InvalidDataException($"Unsafe package part '{part.Name}'.");
            var finalPath = Path.Combine(cacheDirectory, part.Name);
            if (await IsVerifiedAsync(finalPath, part, cancellationToken)) { completed += part.Size; complete.Add(finalPath); continue; }
            if (httpClient is null && File.Exists(finalPath))
                throw new CryptographicException($"SHA-256 mismatch for {part.Name}. The package was rejected.");
            TryDelete(finalPath);
            var partialPath = finalPath + ".partial";
            if (await IsVerifiedAsync(partialPath, part, cancellationToken))
            {
                File.Move(partialPath, finalPath, true);
                completed += part.Size;
                complete.Add(finalPath);
                continue;
            }
            if (File.Exists(partialPath) && new FileInfo(partialPath).Length == part.Size) TryDelete(partialPath);
            if (httpClient is null) throw new FileNotFoundException($"Required offline package part is missing: {part.Name}.", finalPath);
            await DownloadAsync(new Uri(releaseBaseUri, part.Name), partialPath, part, completed, total, progress, cancellationToken);
            if (!await IsVerifiedAsync(partialPath, part, cancellationToken)) { TryDelete(partialPath); throw new CryptographicException($"SHA-256 mismatch for {part.Name}. The package was rejected."); }
            File.Move(partialPath, finalPath, true);
            completed += part.Size;
            complete.Add(finalPath);
        }
        return complete;
    }

    private async Task DownloadAsync(Uri uri, string partialPath, PackagePart part, long completed, long total, IProgress<TransferProgress>? progress, CancellationToken cancellationToken)
    {
        var recoveredUnsatisfiableRange = false;
        for (var attempt = 1; attempt <= 5; attempt++)
        {
            var existing = File.Exists(partialPath) ? new FileInfo(partialPath).Length : 0;
            if (existing > part.Size) { TryDelete(partialPath); existing = 0; }
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, uri);
                if (existing > 0) request.Headers.Range = new RangeHeaderValue(existing, null);
                using var response = await httpClient!.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
                if (existing > 0 && response.StatusCode == HttpStatusCode.RequestedRangeNotSatisfiable && !recoveredUnsatisfiableRange)
                {
                    TryDelete(partialPath);
                    recoveredUnsatisfiableRange = true;
                    attempt--;
                    continue;
                }
                if (existing > 0 && response.StatusCode == HttpStatusCode.OK) { TryDelete(partialPath); existing = 0; }
                response.EnsureSuccessStatusCode();
                if (existing > 0 && response.StatusCode != HttpStatusCode.PartialContent) throw new HttpRequestException($"Unexpected resume response {response.StatusCode}.");
                await using var input = await response.Content.ReadAsStreamAsync(cancellationToken);
                await using var output = new FileStream(partialPath, existing == 0 ? FileMode.Create : FileMode.Append, FileAccess.Write, FileShare.Read, 1024 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
                var buffer = new byte[1024 * 1024]; var current = existing;
                while (true) { var read = await input.ReadAsync(buffer, cancellationToken); if (read == 0) break; await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken); current += read; progress?.Report(new TransferProgress(part.Name, current, part.Size, completed + current, total)); }
                await output.FlushAsync(cancellationToken);
                if (current != part.Size) throw new IOException($"Downloaded size for {part.Name} is {current} bytes; expected {part.Size}.");
                return;
            }
            catch when (attempt < 5) { await Task.Delay(TimeSpan.FromSeconds(Math.Min(30, Math.Pow(2, attempt))), cancellationToken); }
        }
        throw new IOException($"Unable to download {part.Name} after five attempts.");
    }

    private static async Task<bool> IsVerifiedAsync(string path, PackagePart part, CancellationToken cancellationToken)
    {
        if (!File.Exists(path) || new FileInfo(path).Length != part.Size) return false;
        await using var stream = File.OpenRead(path); var actual = Convert.ToHexString(await SHA256.HashDataAsync(stream, cancellationToken)).ToLowerInvariant();
        return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(actual), Encoding.ASCII.GetBytes(part.Sha256.ToLowerInvariant()));
    }
    private static void TryDelete(string path) { try { if (File.Exists(path)) File.Delete(path); } catch { } }
}
