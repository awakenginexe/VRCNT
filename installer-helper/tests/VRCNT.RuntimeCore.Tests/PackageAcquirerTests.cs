using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using VRCNT.RuntimeCore.Models;
using VRCNT.RuntimeCore.Packages;
using Xunit;

namespace VRCNT.RuntimeCore.Tests;

public sealed class PackageAcquirerTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task AcquireAsync_downloads_selected_cuda_parts_in_manifest_order()
    {
        var manifest = ManifestValidationTests.CreateManifest(cudaParts: 3);
        using var client = new HttpClient(new AssetHandler(new Dictionary<string, byte[]> { ["cuda.001"] = Bytes("cuda1"), ["cuda.002"] = Bytes("cuda2"), ["cuda.003"] = Bytes("cuda3") }));

        var paths = await new VariantPackageAcquirer(client).AcquireAsync(manifest, RuntimeVariant.Cuda, new Uri("https://example.test/release/"), _root, null, default);

        Assert.Equal(["cuda.001", "cuda.002", "cuda.003"], paths.Select(Path.GetFileName));
    }

    [Fact]
    public async Task AcquireAsync_restarts_partial_when_server_ignores_range_and_rejects_hash_mismatch()
    {
        var manifest = ManifestValidationTests.CreateManifest();
        Directory.CreateDirectory(_root);
        await File.WriteAllBytesAsync(Path.Combine(_root, "cpu.001.partial"), Bytes("bad"));
        using var client = new HttpClient(new AssetHandler(new Dictionary<string, byte[]> { ["cpu.001"] = Bytes("cpu1") }, ignoreRanges: true));

        var paths = await new VariantPackageAcquirer(client).AcquireAsync(manifest, RuntimeVariant.Cpu, new Uri("https://example.test/release/"), _root, null, default);

        Assert.Equal("cpu1", await File.ReadAllTextAsync(paths.Single()));
        await File.WriteAllTextAsync(paths.Single(), "evil");
        using var mismatchedClient = new HttpClient(new AssetHandler(new Dictionary<string, byte[]> { ["cpu.001"] = Bytes("bad!") }));
        await Assert.ThrowsAsync<CryptographicException>(() => new VariantPackageAcquirer(mismatchedClient)
            .AcquireAsync(manifest, RuntimeVariant.Cpu, new Uri("https://example.test/release/"), _root, null, default));
    }

    [Fact]
    public async Task AcquireAsync_uses_verified_local_parts_without_network()
    {
        var manifest = ManifestValidationTests.CreateManifest();
        Directory.CreateDirectory(_root);
        await File.WriteAllBytesAsync(Path.Combine(_root, "cpu.001"), Bytes("cpu1"));
        using var client = new HttpClient(new AssetHandler(new Dictionary<string, byte[]>(), throwOnRequest: true));

        var paths = await new VariantPackageAcquirer(client).AcquireAsync(manifest, RuntimeVariant.Cpu, new Uri("https://example.test/release/"), _root, null, default);

        Assert.Single(paths);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    private static byte[] Bytes(string value) => Encoding.UTF8.GetBytes(value);

    private sealed class AssetHandler(IReadOnlyDictionary<string, byte[]> assets, bool ignoreRanges = false, bool throwOnRequest = false) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (throwOnRequest) throw new Xunit.Sdk.XunitException("network was used");
            var name = request.RequestUri!.Segments[^1];
            var data = assets[name];
            var range = request.Headers.Range?.Ranges.SingleOrDefault();
            var start = range?.From ?? 0;
            var status = range is not null && !ignoreRanges ? HttpStatusCode.PartialContent : HttpStatusCode.OK;
            var payload = status == HttpStatusCode.PartialContent ? data[(int)start..] : data;
            var response = new HttpResponseMessage(status) { Content = new ByteArrayContent(payload) };
            response.Content.Headers.ContentLength = payload.Length;
            if (status == HttpStatusCode.PartialContent) response.Content.Headers.ContentRange = new ContentRangeHeaderValue(start, data.Length - 1, data.Length);
            return Task.FromResult(response);
        }
    }
}
