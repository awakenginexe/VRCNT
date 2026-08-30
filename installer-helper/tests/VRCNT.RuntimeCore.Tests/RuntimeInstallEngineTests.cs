using System.Net;
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
        var engine = new RuntimeInstallEngine(
            candidateDirectory,
            cacheDirectory,
            Path.Combine(_root, "missing-minisign.exe"),
            Path.Combine(_root, "missing-7za.exe"),
            client);

        var exception = await Assert.ThrowsAsync<FileNotFoundException>(() => engine.ExecuteAsync(
            new RuntimeInstallRequest(
                RuntimeVariant.Cpu,
                "5.15.0",
                Path.Combine(_root, "install"),
                "https://example.invalid/releases/latest/download/",
                string.Empty,
                false),
            null,
            default));

        Assert.Contains("Required bundled tool is missing", exception.Message, StringComparison.Ordinal);
        Assert.Empty(handler.Requests);
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
}
