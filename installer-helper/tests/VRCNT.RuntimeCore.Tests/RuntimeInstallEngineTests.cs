using System.Net;
using System.Security.Cryptography;
using VRCNT.RuntimeCore.Manifest;
using VRCNT.RuntimeCore.Models;
using VRCNT.RuntimeCore.Transactions;
using Xunit;

namespace VRCNT.RuntimeCore.Tests;

public sealed class RuntimeInstallEngineTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "vrcnt-runtime-install-engine-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task ExecuteAsync_uses_adjacent_candidate_metadata_before_contacting_the_release_endpoint()
    {
        var candidateDirectory = Path.Combine(_root, "candidate");
        var cacheDirectory = Path.Combine(_root, "cache");
        Directory.CreateDirectory(candidateDirectory);
        await File.WriteAllTextAsync(Path.Combine(candidateDirectory, "package-manifest.json"), "candidate manifest");
        await File.WriteAllTextAsync(Path.Combine(candidateDirectory, "package-manifest.json.sig"), "candidate signature");

        var handler = new RecordingHandler();
        using var client = new HttpClient(handler);
        var manifestLoader = new RejectingManifestLoader();
        var engine = new RuntimeInstallEngine(
            candidateDirectory,
            cacheDirectory,
            Path.Combine(_root, "missing-minisign.exe"),
            Path.Combine(_root, "missing-7za.exe"),
            client,
            manifestLoader);

        var exception = await Assert.ThrowsAsync<CryptographicException>(() => engine.ExecuteAsync(
            new RuntimeInstallRequest(
                RuntimeVariant.Cpu,
                "5.15.0",
                Path.Combine(_root, "install"),
                "https://example.invalid/releases/latest/download/",
                string.Empty,
                false),
            null,
            default));

        Assert.Contains("invalid signature", exception.Message, StringComparison.Ordinal);
        Assert.Equal(1, manifestLoader.Calls);
        Assert.Empty(handler.Requests);
        Assert.Equal("candidate manifest", await File.ReadAllTextAsync(Path.Combine(candidateDirectory, "package-manifest.json")));
        Assert.Equal("candidate signature", await File.ReadAllTextAsync(Path.Combine(candidateDirectory, "package-manifest.json.sig")));
    }

    [Fact]
    public async Task ExecuteAsync_refreshes_cached_metadata_after_signature_verification_fails()
    {
        var candidateDirectory = Path.Combine(_root, "candidate");
        var cacheDirectory = Path.Combine(_root, "cache");
        var versionCacheDirectory = Path.Combine(cacheDirectory, "5.15.0");
        Directory.CreateDirectory(candidateDirectory);
        Directory.CreateDirectory(versionCacheDirectory);
        await File.WriteAllTextAsync(Path.Combine(versionCacheDirectory, "package-manifest.json"), "cached manifest");
        await File.WriteAllTextAsync(Path.Combine(versionCacheDirectory, "package-manifest.json.sig"), "cached signature");

        var handler = new RecordingHandler();
        using var client = new HttpClient(handler);
        var manifestLoader = new RejectingManifestLoader();
        var engine = new RuntimeInstallEngine(
            candidateDirectory,
            cacheDirectory,
            Path.Combine(_root, "missing-minisign.exe"),
            Path.Combine(_root, "missing-7za.exe"),
            client,
            manifestLoader);

        var exception = await Assert.ThrowsAsync<CryptographicException>(() => engine.ExecuteAsync(
            new RuntimeInstallRequest(
                RuntimeVariant.Cpu,
                "5.15.0",
                Path.Combine(_root, "install"),
                "https://example.invalid/releases/latest/download/",
                string.Empty,
                false),
            null,
            default));

        Assert.Contains("invalid signature", exception.Message, StringComparison.Ordinal);
        Assert.Equal(2, manifestLoader.Calls);
        Assert.Collection(
            handler.Requests,
            request => Assert.Equal("https://example.invalid/releases/latest/download/package-manifest.json", request.ToString()),
            request => Assert.Equal("https://example.invalid/releases/latest/download/package-manifest.json.sig", request.ToString()));
        Assert.Equal("remote response", await File.ReadAllTextAsync(Path.Combine(versionCacheDirectory, "package-manifest.json")));
        Assert.Equal("remote response", await File.ReadAllTextAsync(Path.Combine(versionCacheDirectory, "package-manifest.json.sig")));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    private sealed class RecordingHandler : HttpMessageHandler
    {
        public List<Uri> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(request.RequestUri!);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                RequestMessage = request,
                Content = new StringContent("remote response"),
            });
        }
    }

    private sealed class RejectingManifestLoader : IManifestLoader
    {
        public int Calls { get; private set; }

        public Task<VerifiedManifest> LoadAndVerifyAsync(
            string manifestPath,
            string signaturePath,
            string expectedVersion,
            CancellationToken cancellationToken)
        {
            Calls++;
            throw new CryptographicException("invalid signature");
        }
    }
}
