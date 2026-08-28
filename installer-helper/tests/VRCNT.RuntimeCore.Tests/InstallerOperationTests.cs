using System.Text.Json;
using VRCNT.RuntimeCore.Manager;
using VRCNT.RuntimeCore.Models;
using VRCNT.RuntimeCore.Paths;
using VRCNT.Setup;
using VRCNT.Setup.CommandLine;
using Xunit;

namespace VRCNT.RuntimeCore.Tests;

public sealed class InstallerOperationTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "vrcnt-installer-operation-tests", Guid.NewGuid().ToString("N"));

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Execute_runtime_forwards_transaction_progress_and_initializes_fresh_language_in_the_canonical_data_root(bool passive)
    {
        var dataRoot = Path.Combine(_root, "VRCNTData");
        var engine = new RecordingRuntimeEngine();
        var operations = CreateOperations(engine, dataRoot);
        var progressValues = new List<InstallProgress>();
        var options = new SetupCommandLineOptions(false, passive, false, false, false, RuntimeVariant.Cpu, Path.Combine(_root, "VRCNT"), null, [], "th");

        await operations.ExecuteRuntimeAsync(options, new CollectingProgress(progressValues), default);

        Assert.Single(progressValues);
        Assert.Equal(TransactionPhase.Acquire, progressValues[0].Phase);
        Assert.Equal(250, progressValues[0].CompletedBytes);
        var config = JsonDocument.Parse(File.ReadAllText(Path.Combine(dataRoot, "config.json")));
        Assert.Equal("th", config.RootElement.GetProperty("UI_LANGUAGE").GetString());
    }

    [Fact]
    public async Task Execute_runtime_does_not_overwrite_an_existing_language_on_reinstall()
    {
        var dataRoot = Path.Combine(_root, "VRCNTData");
        Directory.CreateDirectory(dataRoot);
        File.WriteAllText(Path.Combine(dataRoot, "config.json"), "{\"UI_LANGUAGE\":\"ja\",\"FONT_FAMILY\":\"VRCNT Noto\"}");
        var operations = CreateOperations(new RecordingRuntimeEngine(), dataRoot);
        var options = new SetupCommandLineOptions(true, false, false, false, false, RuntimeVariant.Cpu, Path.Combine(_root, "VRCNT"), null, [], "th");

        await operations.ExecuteRuntimeAsync(options, null, default);

        Assert.Equal("{\"UI_LANGUAGE\":\"ja\",\"FONT_FAMILY\":\"VRCNT Noto\"}", File.ReadAllText(Path.Combine(dataRoot, "config.json")));
    }

    [Fact]
    public async Task Execute_runtime_skips_initial_language_for_a_reinstall_when_the_canonical_config_is_absent()
    {
        var dataRoot = Path.Combine(_root, "VRCNTData");
        var operations = CreateOperations(new RecordingRuntimeEngine(), dataRoot);
        var options = new SetupCommandLineOptions(true, false, false, false, false, RuntimeVariant.Cpu, Path.Combine(_root, "VRCNT"), null, [], "th");

        await operations.ExecuteRuntimeAsync(options, null, default);

        Assert.False(File.Exists(Path.Combine(dataRoot, "config.json")));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    private SetupCommandOperations CreateOperations(RecordingRuntimeEngine engine, string dataRoot) => new(
        engine,
        new NoopManagerLifecycle(),
        new Uri("https://example.invalid/latest.json"),
        Path.Combine(_root, "manager"),
        Path.Combine(_root, "manager", "VRCNT.Setup.exe"),
        _ => new UserDataPaths(dataRoot, Path.Combine(_root, "VRCNT-NextData"), Path.Combine(_root, "VRCNT")));

    private sealed class RecordingRuntimeEngine : IRuntimeTransactionEngine
    {
        public Task<RuntimeOperationResult> ExecuteAsync(RuntimeInstallRequest request, IProgress<InstallProgress>? progress, CancellationToken cancellationToken)
        {
            progress?.Report(new InstallProgress(TransactionPhase.Acquire, 250, 1000, "runtime.7z"));
            return Task.FromResult(new RuntimeOperationResult(true, false, false, null, null));
        }
    }

    private sealed class CollectingProgress(List<InstallProgress> values) : IProgress<InstallProgress>
    {
        public void Report(InstallProgress value) => values.Add(value);
    }

    private sealed class NoopManagerLifecycle : IManagerLifecycle
    {
        public Task<ManagerSelfCheckResult> CheckAsync(CancellationToken cancellationToken) => Task.FromResult(new ManagerSelfCheckResult(true, false, null));
        public Task<ManagerRepairResult> RepairAsync(Uri latestJsonUri, CancellationToken cancellationToken) => Task.FromResult(new ManagerRepairResult(true, null, null));
        public Task PromoteAsync(string verifiedSetupPath, CancellationToken cancellationToken) => Task.CompletedTask;
    }
}
