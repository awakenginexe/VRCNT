using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace VRCNT.ReleaseHelper;

internal static class Program
{
    private const long MaxGitHubAssetBytes = 2_000_000_000;
    private const string EmbeddedManifestPublicKey =
        "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDY4NTYzNUI0QUI2RTI4RkMKUldUOEtHNnJ0RFZXYUt4L1cwOVhIL1NtZXJGQkxzZkVVYXMrWGJZQlZ5NFNPdldRMk9RdUkrVCsK";

    private static readonly object ConsoleLock = new();
    private static readonly HttpClient Http = new(new HttpClientHandler
    {
        AutomaticDecompression = DecompressionMethods.All,
    })
    {
        Timeout = Timeout.InfiniteTimeSpan,
    };

    public static async Task<int> Main(string[] args)
    {
        try
        {
            Http.DefaultRequestHeaders.UserAgent.ParseAdd("VRCNT-Installer/4.2.2");
            var options = Options.Parse(args);
            await InstallAsync(options);
            return 0;
        }
        catch (Exception exception)
        {
            WriteLine($"[failed] {exception.Message}");
            return 1;
        }
    }

    private static async Task InstallAsync(Options options)
    {
        Directory.CreateDirectory(options.CacheDirectory);
        Directory.CreateDirectory(options.Destination);

        var expectedNames = Enumerable.Range(1, options.PartCount)
            .Select(index => $"VRCNT_{options.Version}.7z.{index:000}")
            .ToArray();
        var allLocalPartsExist = expectedNames.All(name =>
            File.Exists(Path.Combine(options.InstallerDirectory, name)));

        WriteLine(allLocalPartsExist
            ? "[source] Found all multipart package files beside the installer. Network package download will be skipped."
            : "[source] A complete local multipart package was not found. All parts will be downloaded from GitHub Releases.");

        var manifestPath = await AcquireMetadataAsync(options, options.ManifestName, !allLocalPartsExist);
        var signaturePath = await AcquireMetadataAsync(options, options.SignatureName, !allLocalPartsExist);
        VerifyManifestSignature(options, manifestPath, signaturePath);

        var manifest = await LoadAndValidateManifestAsync(
            manifestPath,
            options.Version,
            expectedNames);

        IReadOnlyDictionary<string, string> packagePaths;
        if (allLocalPartsExist)
        {
            packagePaths = expectedNames.ToDictionary(
                name => name,
                name => Path.Combine(options.InstallerDirectory, name),
                StringComparer.OrdinalIgnoreCase);
        }
        else
        {
            packagePaths = await DownloadPartsAsync(options, manifest);
        }

        WriteLine("[verification] Verifying SHA-256 for every package part.");
        foreach (var part in manifest.Files)
        {
            var path = packagePaths[part.Name];
            try
            {
                await VerifyFileAsync(path, part);
            }
            catch when (!allLocalPartsExist)
            {
                TryDelete(path);
                throw;
            }
            WriteLine($"[verified] {part.Name} ({FormatBytes(part.Size)})");
        }

        var firstPart = packagePaths[expectedNames[0]];
        WriteLine("[extraction] Package authentication complete. Extracting application files with 7za.exe.");
        await RunProcessAsync(
            options.SevenZipPath,
            new[] { "x", "-y", "-aoa", $"-o{options.Destination}", firstPart },
            "extract");

        var mainExecutable = Path.Combine(options.Destination, "vrcnt.exe");
        if (!File.Exists(mainExecutable))
        {
            throw new InvalidDataException($"Extraction completed but {mainExecutable} is missing.");
        }

        WriteLine("[finalization] Application payload installed and validated.");
        if (!allLocalPartsExist)
        {
            CleanupDownloadedFiles(options, manifest);
        }
        WriteLine("[complete] VRCNT package installation finished successfully.");
    }

    private static async Task<string> AcquireMetadataAsync(
        Options options,
        string name,
        bool allowNetwork)
    {
        var adjacent = Path.Combine(options.InstallerDirectory, name);
        if (File.Exists(adjacent))
        {
            WriteLine($"[metadata] Using local {name}.");
            return adjacent;
        }

        if (!allowNetwork)
        {
            throw new FileNotFoundException(
                $"All local package parts were found, but required offline metadata {name} is missing beside the installer. " +
                "Download the signed manifest and its signature from the same GitHub Release.",
                adjacent);
        }

        var destination = Path.Combine(options.CacheDirectory, name);
        WriteLine($"[metadata] Downloading {name} from the matching GitHub Release.");
        await DownloadSmallFileAsync(new Uri($"{options.ReleaseBaseUrl.TrimEnd('/')}/{name}"), destination);
        return destination;
    }

    private static async Task DownloadSmallFileAsync(Uri uri, string destination)
    {
        Exception? lastError = null;
        for (var attempt = 1; attempt <= 5; attempt++)
        {
            try
            {
                using var response = await Http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead);
                response.EnsureSuccessStatusCode();
                await using var input = await response.Content.ReadAsStreamAsync();
                await using var output = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None);
                await input.CopyToAsync(output);
                return;
            }
            catch (Exception exception) when (attempt < 5)
            {
                lastError = exception;
                WriteLine($"[retry] {Path.GetFileName(destination)} attempt {attempt} failed: {exception.Message}");
                await Task.Delay(TimeSpan.FromSeconds(Math.Min(30, Math.Pow(2, attempt))));
            }
        }
        throw new IOException($"Unable to download {uri} after five attempts.", lastError);
    }

    private static void VerifyManifestSignature(Options options, string manifestPath, string signaturePath)
    {
        WriteLine("[verification] Verifying the signed package manifest before trusting package hashes.");
        var verificationDirectory = Path.Combine(options.CacheDirectory, "signature-verification");
        Directory.CreateDirectory(verificationDirectory);
        var decodedSignature = Path.Combine(verificationDirectory, "package-manifest.minisig");
        var decodedPublicKey = Path.Combine(verificationDirectory, "package-manifest.pub");
        try
        {
            DecodeTauriBase64File(signaturePath, decodedSignature, "manifest signature");
            File.WriteAllBytes(decodedPublicKey, Convert.FromBase64String(EmbeddedManifestPublicKey));
            RunProcessAsync(
                options.MinisignPath,
                new[] { "-Vm", manifestPath, "-x", decodedSignature, "-p", decodedPublicKey, "-q" },
                "signature").GetAwaiter().GetResult();
            WriteLine("[verified] Package manifest signature is valid.");
        }
        catch (Exception exception)
        {
            throw new CryptographicException(
                "Package manifest signature verification failed. No package hashes were trusted.",
                exception);
        }
        finally
        {
            TryDelete(decodedSignature);
            TryDelete(decodedPublicKey);
            TryDeleteDirectory(verificationDirectory);
        }
    }

    private static void DecodeTauriBase64File(string source, string destination, string description)
    {
        var encoded = File.ReadAllText(source, Encoding.UTF8).Trim().TrimStart('\uFEFF');
        try
        {
            File.WriteAllBytes(destination, Convert.FromBase64String(encoded));
        }
        catch (FormatException exception)
        {
            throw new InvalidDataException($"The {description} is not valid Tauri base64 data.", exception);
        }
    }

    private static async Task<PackageManifest> LoadAndValidateManifestAsync(
        string path,
        string version,
        IReadOnlyList<string> expectedNames)
    {
        await using var input = File.OpenRead(path);
        var manifest = await JsonSerializer.DeserializeAsync<PackageManifest>(input)
            ?? throw new InvalidDataException("The package manifest is empty.");

        if (!string.Equals(manifest.Version, version, StringComparison.Ordinal))
        {
            throw new InvalidDataException(
                $"Manifest version {manifest.Version} does not match installer version {version}.");
        }
        if (manifest.Files.Count != expectedNames.Count)
        {
            throw new InvalidDataException(
                $"Manifest must contain exactly {expectedNames.Count} package parts.");
        }

        for (var index = 0; index < expectedNames.Count; index++)
        {
            var part = manifest.Files[index];
            if (!string.Equals(part.Name, expectedNames[index], StringComparison.Ordinal))
            {
                throw new InvalidDataException(
                    $"Unexpected package part '{part.Name}'; expected '{expectedNames[index]}'.");
            }
            if (part.Size <= 0 || part.Size >= MaxGitHubAssetBytes)
            {
                throw new InvalidDataException(
                    $"Package part {part.Name} has unsafe size {part.Size} bytes.");
            }
            if (part.Sha256.Length != 64 || !part.Sha256.All(Uri.IsHexDigit))
            {
                throw new InvalidDataException($"Package part {part.Name} has an invalid SHA-256 value.");
            }
        }
        return manifest;
    }

    private static async Task<IReadOnlyDictionary<string, string>> DownloadPartsAsync(
        Options options,
        PackageManifest manifest)
    {
        var progress = new AggregateProgress(manifest.Files.Sum(file => file.Size));
        var tasks = manifest.Files.Select(async part =>
        {
            var finalPath = Path.Combine(options.CacheDirectory, part.Name);
            var partialPath = finalPath + ".partial";
            if (File.Exists(finalPath))
            {
                var finalLength = new FileInfo(finalPath).Length;
                if (finalLength == part.Size)
                {
                    File.Move(finalPath, partialPath, true);
                }
                else
                {
                    TryDelete(finalPath);
                }
            }
            await DownloadPartWithRetriesAsync(options, part, partialPath, progress);
            File.Move(partialPath, finalPath, true);
            return (part.Name, finalPath);
        });

        var completed = await Task.WhenAll(tasks);
        return completed.ToDictionary(item => item.Name, item => item.finalPath, StringComparer.OrdinalIgnoreCase);
    }

    private static async Task DownloadPartWithRetriesAsync(
        Options options,
        PackagePart part,
        string partialPath,
        AggregateProgress progress)
    {
        Exception? lastError = null;
        for (var attempt = 1; attempt <= 5; attempt++)
        {
            var existing = File.Exists(partialPath) ? new FileInfo(partialPath).Length : 0;
            if (existing > part.Size)
            {
                TryDelete(partialPath);
                existing = 0;
            }
            progress.SetExisting(part.Name, existing);
            if (existing == part.Size)
            {
                WriteLine($"[resume] {part.Name} is already fully downloaded; verification will follow.");
                return;
            }

            try
            {
                var uri = new Uri($"{options.ReleaseBaseUrl.TrimEnd('/')}/{part.Name}");
                using var request = new HttpRequestMessage(HttpMethod.Get, uri);
                if (existing > 0)
                {
                    request.Headers.Range = new RangeHeaderValue(existing, null);
                    WriteLine($"[resume] {part.Name} from {FormatBytes(existing)}.");
                }

                using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
                if (existing > 0 && response.StatusCode == HttpStatusCode.OK)
                {
                    progress.SetExisting(part.Name, 0);
                    TryDelete(partialPath);
                    existing = 0;
                    WriteLine($"[resume] Server did not honor Range for {part.Name}; restarting that part safely.");
                }
                response.EnsureSuccessStatusCode();
                if (existing > 0 && response.StatusCode != HttpStatusCode.PartialContent)
                {
                    throw new HttpRequestException($"Unexpected resume response {response.StatusCode}.");
                }

                await using var input = await response.Content.ReadAsStreamAsync();
                await using var output = new FileStream(
                    partialPath,
                    existing == 0 ? FileMode.Create : FileMode.Append,
                    FileAccess.Write,
                    FileShare.Read,
                    1024 * 1024,
                    FileOptions.Asynchronous | FileOptions.SequentialScan);
                var buffer = new byte[1024 * 1024];
                var current = existing;
                var lastReport = Stopwatch.StartNew();
                while (true)
                {
                    var read = await input.ReadAsync(buffer);
                    if (read == 0)
                    {
                        break;
                    }
                    await output.WriteAsync(buffer.AsMemory(0, read));
                    current += read;
                    progress.Add(part.Name, read);
                    if (lastReport.Elapsed >= TimeSpan.FromSeconds(1))
                    {
                        progress.Report(part.Name, current, part.Size);
                        lastReport.Restart();
                    }
                }
                await output.FlushAsync();

                if (current != part.Size)
                {
                    throw new IOException(
                        $"Downloaded size for {part.Name} is {current} bytes; expected {part.Size}.");
                }
                progress.Report(part.Name, current, part.Size);
                return;
            }
            catch (Exception exception) when (attempt < 5)
            {
                lastError = exception;
                WriteLine($"[retry] {part.Name} attempt {attempt} failed: {exception.Message}");
                await Task.Delay(TimeSpan.FromSeconds(Math.Min(30, Math.Pow(2, attempt))));
            }
        }
        throw new IOException($"Unable to download {part.Name} after five attempts.", lastError);
    }

    private static async Task VerifyFileAsync(string path, PackagePart part)
    {
        var info = new FileInfo(path);
        if (!info.Exists || info.Length != part.Size)
        {
            throw new InvalidDataException(
                $"Package size mismatch for {part.Name}: expected {part.Size}, got {(info.Exists ? info.Length : 0)}.");
        }
        await using var stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            1024 * 1024,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        var digest = await SHA256.HashDataAsync(stream);
        var actual = Convert.ToHexString(digest).ToLowerInvariant();
        if (!CryptographicOperations.FixedTimeEquals(
                Encoding.ASCII.GetBytes(actual),
                Encoding.ASCII.GetBytes(part.Sha256.ToLowerInvariant())))
        {
            throw new CryptographicException(
                $"SHA-256 mismatch for {part.Name}. The package was rejected.");
        }
    }

    private static async Task RunProcessAsync(string executable, IEnumerable<string> arguments, string prefix)
    {
        if (!File.Exists(executable))
        {
            throw new FileNotFoundException($"Required bundled tool is missing: {executable}");
        }
        var startInfo = new ProcessStartInfo(executable)
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        foreach (var argument in arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }
        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException($"Could not start {executable}.");
        var stdout = PumpAsync(process.StandardOutput, prefix);
        var stderr = PumpAsync(process.StandardError, prefix);
        await Task.WhenAll(stdout, stderr, process.WaitForExitAsync());
        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException(
                $"{Path.GetFileName(executable)} failed with exit code {process.ExitCode}.");
        }
    }

    private static async Task PumpAsync(StreamReader reader, string prefix)
    {
        while (await reader.ReadLineAsync() is { } line)
        {
            if (!string.IsNullOrWhiteSpace(line))
            {
                WriteLine($"[{prefix}] {line}");
            }
        }
    }

    private static void CleanupDownloadedFiles(Options options, PackageManifest manifest)
    {
        WriteLine("[cleanup] Removing verified installer cache files.");
        foreach (var file in manifest.Files)
        {
            TryDelete(Path.Combine(options.CacheDirectory, file.Name));
            TryDelete(Path.Combine(options.CacheDirectory, file.Name + ".partial"));
        }
        TryDelete(Path.Combine(options.CacheDirectory, options.ManifestName));
        TryDelete(Path.Combine(options.CacheDirectory, options.SignatureName));
        TryDeleteDirectory(options.CacheDirectory);
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }

    private static void TryDeleteDirectory(string path)
    {
        try { if (Directory.Exists(path) && !Directory.EnumerateFileSystemEntries(path).Any()) Directory.Delete(path); } catch { }
    }

    private static string FormatBytes(long bytes)
    {
        string[] units = ["B", "KiB", "MiB", "GiB"];
        var value = (double)bytes;
        var unit = 0;
        while (value >= 1024 && unit < units.Length - 1)
        {
            value /= 1024;
            unit++;
        }
        return $"{value:0.0} {units[unit]}";
    }

    private static void WriteLine(string message)
    {
        lock (ConsoleLock)
        {
            Console.WriteLine(message);
            Console.Out.Flush();
        }
    }

    private sealed class AggregateProgress(long totalBytes)
    {
        private readonly Stopwatch _timer = Stopwatch.StartNew();
        private readonly Dictionary<string, long> _files = new(StringComparer.OrdinalIgnoreCase);
        private long _downloadedBytes;
        private long _networkBytes;

        public void SetExisting(string name, long bytes)
        {
            lock (_files)
            {
                _files.TryGetValue(name, out var old);
                _files[name] = bytes;
                Interlocked.Add(ref _downloadedBytes, bytes - old);
            }
        }

        public void Add(string name, int bytes)
        {
            lock (_files)
            {
                _files.TryGetValue(name, out var old);
                _files[name] = old + bytes;
                Interlocked.Add(ref _downloadedBytes, bytes);
                Interlocked.Add(ref _networkBytes, bytes);
            }
        }

        public void Report(string name, long fileBytes, long fileTotal)
        {
            var total = Interlocked.Read(ref _downloadedBytes);
            var network = Interlocked.Read(ref _networkBytes);
            var seconds = Math.Max(_timer.Elapsed.TotalSeconds, 0.001);
            WriteLine(
                $"[download] {name}: {(100d * fileBytes / fileTotal):0.0}% " +
                $"({FormatBytes(fileBytes)}/{FormatBytes(fileTotal)}); total " +
                $"{(100d * total / totalBytes):0.0}% ({FormatBytes(total)}/{FormatBytes(totalBytes)}), " +
                $"average {FormatBytes((long)(network / seconds))}/s");
        }
    }

    private sealed record Options(
        string Version,
        string ReleaseBaseUrl,
        string InstallerDirectory,
        string CacheDirectory,
        string Destination,
        string ManifestName,
        string SignatureName,
        int PartCount,
        string SevenZipPath,
        string MinisignPath)
    {
        public static Options Parse(string[] args)
        {
            var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (var index = 0; index < args.Length; index += 2)
            {
                if (index + 1 >= args.Length || !args[index].StartsWith("--", StringComparison.Ordinal))
                {
                    throw new ArgumentException("Installer helper arguments must be --name value pairs.");
                }
                values[args[index][2..]] = args[index + 1];
            }

            string Required(string key) => values.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value)
                ? value
                : throw new ArgumentException($"Missing required --{key} argument.");
            var partCount = int.Parse(Required("part-count"), CultureInfo.InvariantCulture);
            if (partCount != 3)
            {
                throw new ArgumentException("VRCNT releases must contain exactly three package parts.");
            }
            return new Options(
                Required("version"),
                Required("release-base-url"),
                Path.GetFullPath(Required("installer-directory")),
                Path.GetFullPath(Required("cache-directory")),
                Path.GetFullPath(Required("destination")),
                Required("manifest-name"),
                Required("signature-name"),
                partCount,
                Path.GetFullPath(Required("sevenzip")),
                Path.GetFullPath(Required("minisign")));
        }
    }

    private sealed record PackageManifest(
        [property: JsonPropertyName("version")] string Version,
        [property: JsonPropertyName("files")] List<PackagePart> Files);

    private sealed record PackagePart(
        [property: JsonPropertyName("name")] string Name,
        [property: JsonPropertyName("size")] long Size,
        [property: JsonPropertyName("sha256")] string Sha256);
}
