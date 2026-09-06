using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using VRCNT.RuntimeCore.Archive;
using VRCNT.RuntimeCore.Filesystem;
using VRCNT.RuntimeCore.Hardware;
using VRCNT.RuntimeCore.Models;
using VRCNT.RuntimeCore.Packages;
using VRCNT.RuntimeCore.Process;
using VRCNT.RuntimeCore.Storage;
using VRCNT.RuntimeCore.Transactions;
using VRCNT.Setup.CommandLine;
using VRCNT.Setup.Localization;
using VRCNT.Setup.Views;
using Xunit;

namespace VRCNT.RuntimeCore.Tests;

public sealed class GpuDetectionTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "vrcnt-gpu-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public void Detect_returns_nvidia_when_dxgi_reports_an_nvidia_adapter()
    {
        var result = new DxgiGpuDetector(new FixedAdapterEnumerator([new GpuAdapterInfo("NVIDIA GeForce RTX 4090", "PCI\\VEN_10DE", false)]), new WmiGpuDetector(new FixedAdapterEnumerator([])), new NvidiaSmiProbe(new FixedNvidiaSmiRunner(NvidiaSmiProbeResult.Unavailable))).Detect();

        Assert.Equal(GpuDetectionStatus.NvidiaDetected, result.Status);
        Assert.Equal("NVIDIA GeForce RTX 4090", result.DisplayName);
        Assert.Contains("DXGI", result.Evidence, StringComparison.Ordinal);
    }

    [Fact]
    public void Detect_treats_microsoft_software_adapter_as_inconclusive_when_no_hardware_can_be_enumerated()
    {
        var result = new DxgiGpuDetector(new FixedAdapterEnumerator([new GpuAdapterInfo("Microsoft Basic Render Driver", "SW", true)]), new WmiGpuDetector(new FixedAdapterEnumerator([])), new NvidiaSmiProbe(new FixedNvidiaSmiRunner(NvidiaSmiProbeResult.Unavailable))).Detect();

        Assert.Equal(GpuDetectionStatus.Inconclusive, result.Status);
    }

    [Fact]
    public void Detect_confirms_no_nvidia_when_dxgi_enumerates_only_physical_non_nvidia_adapters()
    {
        var result = new DxgiGpuDetector(new FixedAdapterEnumerator([new GpuAdapterInfo("AMD Radeon RX 7900 XTX", "PCI\\VEN_1002", false)]), new WmiGpuDetector(new FixedAdapterEnumerator([])), new NvidiaSmiProbe(new FixedNvidiaSmiRunner(NvidiaSmiProbeResult.Unavailable))).Detect();

        Assert.Equal(GpuDetectionStatus.NoNvidiaHardware, result.Status);
    }

    [Fact]
    public void Detect_uses_wmi_when_dxgi_enumeration_is_unavailable()
    {
        var result = new DxgiGpuDetector(new ThrowingAdapterEnumerator(), new WmiGpuDetector(new FixedAdapterEnumerator([new GpuAdapterInfo("NVIDIA RTX A4000", "PCI\\VEN_10DE", false)])), new NvidiaSmiProbe(new FixedNvidiaSmiRunner(NvidiaSmiProbeResult.Unavailable))).Detect();

        Assert.Equal(GpuDetectionStatus.NvidiaDetected, result.Status);
        Assert.Contains("WMI", result.Evidence, StringComparison.Ordinal);
    }

    [Fact]
    public void Detect_does_not_change_confirmed_absence_when_nvidia_smi_is_missing()
    {
        var result = new DxgiGpuDetector(new FixedAdapterEnumerator([new GpuAdapterInfo("Intel Arc", "PCI\\VEN_8086", false)]), new WmiGpuDetector(new FixedAdapterEnumerator([])), new NvidiaSmiProbe(new FixedNvidiaSmiRunner(NvidiaSmiProbeResult.Unavailable))).Detect();

        Assert.Equal(GpuDetectionStatus.NoNvidiaHardware, result.Status);
        Assert.Contains("nvidia-smi unavailable", result.Evidence, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Detect_does_not_let_path_nvidia_smi_override_confirmed_physical_non_nvidia_hardware()
    {
        var result = new DxgiGpuDetector(
            new FixedAdapterEnumerator([new GpuAdapterInfo("AMD Radeon RX 7900 XTX", "PCI\\VEN_1002", false)]),
            new WmiGpuDetector(new FixedAdapterEnumerator([])),
            new NvidiaSmiProbe(new FixedNvidiaSmiRunner(new NvidiaSmiProbeResult(true, true, "Forged NVIDIA", "0000:01:00.0", "nvidia-smi reported NVIDIA")))).Detect();

        Assert.Equal(GpuDetectionStatus.NoNvidiaHardware, result.Status);
        Assert.DoesNotContain("Forged NVIDIA", result.Evidence, StringComparison.Ordinal);
    }

    [Fact]
    public void Detect_does_not_accept_path_nvidia_smi_without_enumerated_nvidia_evidence()
    {
        var result = new DxgiGpuDetector(
            new FixedAdapterEnumerator([new GpuAdapterInfo("Microsoft Remote Display Adapter", "ROOT\\DISPLAY", false)]),
            new WmiGpuDetector(new FixedAdapterEnumerator([])),
            new NvidiaSmiProbe(new FixedNvidiaSmiRunner(new NvidiaSmiProbeResult(true, true, "Forged NVIDIA", "0000:01:00.0", "nvidia-smi reported NVIDIA")))).Detect();

        Assert.Equal(GpuDetectionStatus.Inconclusive, result.Status);
    }

    [Fact]
    public void Detect_keeps_nvidia_named_virtual_adapter_inconclusive_even_when_nvidia_smi_succeeds()
    {
        var detector = new DxgiGpuDetector(
            new FixedAdapterEnumerator([new GpuAdapterInfo("NVIDIA Virtual Display Adapter", "ROOT\\DISPLAY", false)]),
            new WmiGpuDetector(new FixedAdapterEnumerator([])),
            new NvidiaSmiProbe(new FixedNvidiaSmiRunner(new NvidiaSmiProbeResult(true, true, "Forged NVIDIA", "0000:01:00.0", "nvidia-smi reported NVIDIA"))));

        var detection = detector.Detect();
        var selection = new GpuSelectionPolicy(detector).Assess();

        Assert.Equal(GpuDetectionStatus.Inconclusive, detection.Status);
        Assert.Equal(RuntimeVariant.Cpu, selection.RecommendedVariant);
        Assert.False(selection.IsCudaNormallyAvailable);
        Assert.True(selection.RequiresAdvancedCudaOverride);
    }

    [Theory]
    [InlineData("Microsoft Remote Display Adapter")]
    [InlineData("Microsoft Basic Render Driver")]
    [InlineData("VMware SVGA 3D")]
    [InlineData("VirtualBox Graphics Adapter")]
    [InlineData("Generic Virtual Display Adapter")]
    public void Detect_treats_remote_virtual_and_software_adapters_as_inconclusive_without_physical_hardware(string displayName)
    {
        var result = new DxgiGpuDetector(
            new FixedAdapterEnumerator([new GpuAdapterInfo(displayName, "ROOT\\DISPLAY", false)]),
            new WmiGpuDetector(new FixedAdapterEnumerator([])),
            new NvidiaSmiProbe(new FixedNvidiaSmiRunner(NvidiaSmiProbeResult.Unavailable))).Detect();

        Assert.Equal(GpuDetectionStatus.Inconclusive, result.Status);
    }

    [Fact]
    public void Detect_preserves_physical_non_nvidia_absence_when_remote_adapters_are_also_present()
    {
        var result = new DxgiGpuDetector(
            new FixedAdapterEnumerator([
                new GpuAdapterInfo("Microsoft Remote Display Adapter", "ROOT\\DISPLAY", false),
                new GpuAdapterInfo("AMD Radeon RX 7900 XTX", "PCI\\VEN_1002", false),
            ]),
            new WmiGpuDetector(new FixedAdapterEnumerator([])),
            new NvidiaSmiProbe(new FixedNvidiaSmiRunner(NvidiaSmiProbeResult.Unavailable))).Detect();

        Assert.Equal(GpuDetectionStatus.NoNvidiaHardware, result.Status);
    }

    [Fact]
    public void Detect_keeps_remote_or_failed_enumeration_inconclusive()
    {
        var result = new DxgiGpuDetector(new ThrowingAdapterEnumerator(), new WmiGpuDetector(new ThrowingAdapterEnumerator()), new NvidiaSmiProbe(new FixedNvidiaSmiRunner(NvidiaSmiProbeResult.Unavailable))).Detect();

        Assert.Equal(GpuDetectionStatus.Inconclusive, result.Status);
    }

    [Fact]
    public void Detect_finds_nvidia_among_multiple_adapters()
    {
        var result = new DxgiGpuDetector(new FixedAdapterEnumerator([
            new GpuAdapterInfo("Intel Iris Xe", "PCI\\VEN_8086", false),
            new GpuAdapterInfo("NVIDIA GeForce RTX 4060", "PCI\\VEN_10DE", false),
        ]), new WmiGpuDetector(new FixedAdapterEnumerator([])), new NvidiaSmiProbe(new FixedNvidiaSmiRunner(NvidiaSmiProbeResult.Unavailable))).Detect();

        Assert.Equal(GpuDetectionStatus.NvidiaDetected, result.Status);
        Assert.Equal("NVIDIA GeForce RTX 4060", result.DisplayName);
    }

    [Theory]
    [InlineData(GpuDetectionStatus.NvidiaDetected, RuntimeVariant.Cuda, true, false)]
    [InlineData(GpuDetectionStatus.NoNvidiaHardware, RuntimeVariant.Cpu, false, false)]
    [InlineData(GpuDetectionStatus.Inconclusive, RuntimeVariant.Cpu, false, true)]
    public void Selection_policy_uses_safe_defaults_and_exposes_the_advanced_override_only_when_detection_is_inconclusive(GpuDetectionStatus status, RuntimeVariant expectedVariant, bool cudaNormallyAvailable, bool requiresOverride)
    {
        var policy = new GpuSelectionPolicy(new FixedGpuDetector(new GpuDetectionResult(status, null, null, "test")));

        var selection = policy.Assess();

        Assert.Equal(expectedVariant, selection.RecommendedVariant);
        Assert.Equal(cudaNormallyAvailable, selection.IsCudaNormallyAvailable);
        Assert.Equal(requiresOverride, selection.RequiresAdvancedCudaOverride);
    }

    [Fact]
    public void View_model_preselects_cuda_when_nvidia_is_detected()
    {
        var viewModel = CreateViewModel(GpuDetectionStatus.NvidiaDetected);

        Assert.Equal(RuntimeVariant.Cuda, viewModel.SelectedVariant);
        Assert.True(viewModel.IsCudaNormallyAvailable);
        Assert.False(viewModel.RequiresAdvancedCudaOverride);
    }

    [Fact]
    public void View_model_keeps_cuda_unavailable_when_nvidia_hardware_is_confirmed_absent()
    {
        var viewModel = CreateViewModel(GpuDetectionStatus.NoNvidiaHardware);

        Assert.Equal(RuntimeVariant.Cpu, viewModel.SelectedVariant);
        Assert.False(viewModel.IsCudaNormallyAvailable);
        Assert.False(viewModel.CanSelectCuda);
    }

    [Fact]
    public void View_model_requires_an_explicit_advanced_override_when_detection_is_inconclusive()
    {
        var viewModel = CreateViewModel(GpuDetectionStatus.Inconclusive);

        Assert.Equal(RuntimeVariant.Cpu, viewModel.SelectedVariant);
        Assert.True(viewModel.RequiresAdvancedCudaOverride);
        Assert.False(viewModel.CanSelectCuda);

        viewModel.IsCudaSelected = true;

        Assert.False(viewModel.AdvancedCudaOverrideEnabled);
        Assert.False(viewModel.CanSelectCuda);
        Assert.Equal(RuntimeVariant.Cpu, viewModel.SelectedVariant);

        viewModel.EnableAdvancedCudaOverrideCommand.Execute(null);
        viewModel.IsCudaSelected = true;

        Assert.True(viewModel.AdvancedCudaOverrideEnabled);
        Assert.True(viewModel.CanSelectCuda);
        Assert.Equal(RuntimeVariant.Cuda, viewModel.SelectedVariant);
        Assert.NotEmpty(viewModel.CudaAdvisory);
    }

    [Fact]
    public async Task Capability_probe_requires_the_staged_backend_to_report_a_conclusive_local_cuda_success()
    {
        var staged = Path.Combine(_root, "probe");
        Directory.CreateDirectory(staged);
        File.WriteAllText(Path.Combine(staged, "VRCNT-backend.exe"), "backend");
        var probe = new CudaCapabilityProbe(new FixedBackendRunner(new BackendProcessResult(0, "{\"supported\":true,\"conclusive\":true,\"failureCode\":null,\"detail\":null}", string.Empty)));

        var result = await probe.ProbeAsync(staged, CancellationToken.None);

        Assert.True(result.Supported);
        Assert.True(result.Conclusive);
    }

    [Fact]
    public async Task Capability_probe_returns_the_backend_unsupported_result_without_running_normal_initialization()
    {
        var staged = Path.Combine(_root, "unsupported-probe");
        Directory.CreateDirectory(staged);
        File.WriteAllText(Path.Combine(staged, "VRCNT-backend.exe"), "backend");
        var probe = new CudaCapabilityProbe(new FixedBackendRunner(new BackendProcessResult(0, "{\"supported\":false,\"conclusive\":true,\"failureCode\":\"cuda_unavailable\",\"detail\":\"No compatible local CUDA device is available.\"}", string.Empty)));

        var result = await probe.ProbeAsync(staged, CancellationToken.None);

        Assert.False(result.Supported);
        Assert.True(result.Conclusive);
        Assert.Equal("cuda_unavailable", result.FailureCode);
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("{\"supported\":true,\"conclusive\":\"true\"}")]
    [InlineData("{\"supported\":true}")]
    public async Task Capability_probe_rejects_malformed_backend_output(string output)
    {
        var staged = Path.Combine(_root, Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(staged);
        File.WriteAllText(Path.Combine(staged, "VRCNT-backend.exe"), "backend");
        var probe = new CudaCapabilityProbe(new FixedBackendRunner(new BackendProcessResult(0, output, string.Empty)));

        var result = await probe.ProbeAsync(staged, CancellationToken.None);

        Assert.False(result.Supported);
        Assert.False(result.Conclusive);
        Assert.Equal("cuda_probe_malformed_response", result.FailureCode);
    }

    [Fact]
    public async Task Capability_probe_classifies_a_nonzero_backend_exit_without_exposing_stderr()
    {
        var staged = Path.Combine(_root, "failed-probe");
        Directory.CreateDirectory(staged);
        File.WriteAllText(Path.Combine(staged, "VRCNT-backend.exe"), "backend");
        var probe = new CudaCapabilityProbe(new FixedBackendRunner(new BackendProcessResult(9, string.Empty, "untrusted process output")));

        var result = await probe.ProbeAsync(staged, CancellationToken.None);

        Assert.False(result.Supported);
        Assert.True(result.Conclusive);
        Assert.Equal("cuda_probe_failed", result.FailureCode);
        Assert.DoesNotContain("untrusted", result.Detail, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Capability_probe_classifies_timeout_and_propagates_caller_cancellation()
    {
        var staged = Path.Combine(_root, "timeout-probe");
        Directory.CreateDirectory(staged);
        File.WriteAllText(Path.Combine(staged, "VRCNT-backend.exe"), "backend");

        var timeout = await new CudaCapabilityProbe(new ThrowingBackendRunner(new TimeoutException())).ProbeAsync(staged, CancellationToken.None);

        Assert.Equal("cuda_probe_timeout", timeout.FailureCode);
        Assert.False(timeout.Conclusive);

        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => new CudaCapabilityProbe(new ThrowingBackendRunner(new OperationCanceledException(cancellation.Token))).ProbeAsync(staged, cancellation.Token));
    }

    [Fact]
    public async Task Staged_backend_runner_cancels_and_waits_for_a_real_process_before_returning()
    {
        if (!OperatingSystem.IsWindows()) return;
        var runnerType = typeof(CudaCapabilityProbe).Assembly.GetType("VRCNT.RuntimeCore.Hardware.StagedBackendProcessRunner");
        Assert.NotNull(runnerType);
        var runner = Assert.IsAssignableFrom<IBackendProcessRunner>(Activator.CreateInstance(runnerType!, [TimeSpan.FromSeconds(30)]));
        var powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
        Directory.CreateDirectory(_root);
        using var cancellation = new CancellationTokenSource();

        var running = runner.RunAsync(powershell, ["-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Seconds 30"], _root, cancellation.Token);
        await Task.Delay(150);
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => running);
    }

    [Fact]
    public async Task Transaction_cleans_staging_when_the_cuda_probe_is_cancelled_before_quiesce()
    {
        var request = CreateCudaRequest();
        var processes = new RecordingProcessCoordinator();
        var engine = new RuntimeTransactionEngine(
            new FixedArchiveAcquirer(),
            new StagedCudaExtractor(request.ExpectedIdentity),
            new RuntimePathValidator(new FixedVolumeProbe()),
            new RequiredSpaceCalculator(new FixedSpaceProbe()),
            processes,
            new FixedHealthMonitor(),
            new TransactionJournalStore(),
            new RuntimeDirectoryMover(),
            new FixedStateTransition(),
            cudaCapabilityProbe: new CancellingCapabilityProbe());

        var result = await engine.ExecuteAsync(request, null, CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal("cancelled", result.ErrorCode);
        Assert.False(processes.StopRequested);
        Assert.Empty(Directory.EnumerateDirectories(_root, ".vrcnt-transaction-*", SearchOption.TopDirectoryOnly));
    }

    [Fact]
    public async Task Transaction_blocks_cuda_replacement_before_shutdown_when_the_staged_probe_fails()
    {
        var request = CreateCudaRequest();
        var processes = new RecordingProcessCoordinator();
        var engine = new RuntimeTransactionEngine(
            new FixedArchiveAcquirer(),
            new StagedCudaExtractor(request.ExpectedIdentity),
            new RuntimePathValidator(new FixedVolumeProbe()),
            new RequiredSpaceCalculator(new FixedSpaceProbe()),
            processes,
            new FixedHealthMonitor(),
            new TransactionJournalStore(),
            new RuntimeDirectoryMover(),
            new FixedStateTransition(),
            cudaCapabilityProbe: new FixedCapabilityProbe(new CapabilityProbeResult(false, true, "cuda_probe_failed", "CUDA load failed.")));

        var result = await engine.ExecuteAsync(request, null, CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal("cuda_probe_failed", result.ErrorCode);
        Assert.False(processes.StopRequested);
        Assert.False(Directory.Exists(request.InstallPath));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    private static InstallerViewModel CreateViewModel(GpuDetectionStatus status) => new(
        new NoOpOperations(),
        new SetupCommandLineOptions(false, false, false, false, false, RuntimeVariant.Cpu, "C:\\VRCNT", null, [], "en"),
        InstallerLocalizer.FromCatalog([new InstallerLanguage("en", "English")], new Dictionary<string, IReadOnlyDictionary<string, string>>
        {
            ["en"] = new Dictionary<string, string>
            {
                ["app_name"] = "VRCNT", ["welcome_title"] = "Welcome", ["welcome_body"] = "", ["continue"] = "Continue", ["back"] = "Back",
                ["language_title"] = "Language", ["language_body"] = "", ["runtime_title"] = "Runtime", ["runtime_body"] = "", ["cpu_title"] = "CPU", ["cpu_body"] = "", ["cpu_size"] = "", ["cpu_time"] = "", ["cuda_title"] = "CUDA", ["cuda_body"] = "", ["cuda_size"] = "", ["cuda_time"] = "",
                ["recommended"] = "Recommended", ["compatible"] = "Compatible", ["cuda_requires_nvidia"] = "Requires NVIDIA", ["cuda_advisory_inconclusive"] = "Advanced CUDA may fail unless the staged backend validates local CUDA support.", ["gpu_detection_nvidia"] = "NVIDIA GPU detected.", ["gpu_detection_no_nvidia"] = "No NVIDIA GPU detected.", ["gpu_detection_inconclusive"] = "GPU detection is inconclusive.", ["cuda_advanced_warning"] = "CUDA is not verified before download.", ["cuda_advanced_override"] = "I understand and enable CUDA",
                ["install_size"] = "", ["install_time"] = "", ["options_title"] = "", ["options_body"] = "", ["launch_vrcnt"] = "", ["install"] = "", ["progress_title"] = "", ["progress_body"] = "", ["error_title"] = "", ["error_body"] = "", ["retry"] = "", ["complete_title"] = "", ["complete_body"] = "", ["close"] = "",
            }
        }),
        gpuSelectionPolicy: new GpuSelectionPolicy(new FixedGpuDetector(new GpuDetectionResult(status, null, null, "test"))));

    private RuntimeReplacementRequest CreateCudaRequest()
    {
        var staging = Path.Combine(_root, "cache");
        Directory.CreateDirectory(staging);
        var archive = Path.Combine(staging, "runtime.7z");
        File.WriteAllText(archive, "archive");
        const string marker = "{\"Product\":\"VRCNT\",\"Version\":\"5.15.0\",\"Variant\":\"Cuda\",\"Architecture\":\"x64\",\"BuildIdentity\":\"build\"}";
        var identity = new RuntimeIdentity("VRCNT", "5.15.0", RuntimeVariant.Cuda, "x64", "build", Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(marker))).ToLowerInvariant());
        return new RuntimeReplacementRequest(Path.Combine(_root, "runtime"), staging, [archive], 1, identity, new ActivationRequest("pipe", "token", "nonce"), false);
    }

    private sealed class FixedAdapterEnumerator(IReadOnlyList<GpuAdapterInfo> adapters) : IGpuAdapterEnumerator
    {
        public IReadOnlyList<GpuAdapterInfo> Enumerate() => adapters;
    }

    private sealed class ThrowingAdapterEnumerator : IGpuAdapterEnumerator
    {
        public IReadOnlyList<GpuAdapterInfo> Enumerate() => throw new InvalidOperationException("adapter enumeration unavailable");
    }

    private sealed class FixedNvidiaSmiRunner(NvidiaSmiProbeResult result) : INvidiaSmiRunner
    {
        public NvidiaSmiProbeResult Run() => result;
    }

    private sealed class FixedGpuDetector(GpuDetectionResult result) : IGpuDetector
    {
        public GpuDetectionResult Detect() => result;
    }

    private sealed class FixedBackendRunner(BackendProcessResult result) : IBackendProcessRunner
    {
        public Task<BackendProcessResult> RunAsync(string executablePath, IReadOnlyList<string> arguments, string workingDirectory, CancellationToken cancellationToken) => Task.FromResult(result);
    }

    private sealed class ThrowingBackendRunner(Exception exception) : IBackendProcessRunner
    {
        public Task<BackendProcessResult> RunAsync(string executablePath, IReadOnlyList<string> arguments, string workingDirectory, CancellationToken cancellationToken) => Task.FromException<BackendProcessResult>(exception);
    }

    private sealed class FixedCapabilityProbe(CapabilityProbeResult result) : ICudaCapabilityProbe
    {
        public Task<CapabilityProbeResult> ProbeAsync(string stagedInstallPath, CancellationToken cancellationToken) => Task.FromResult(result);
    }

    private sealed class CancellingCapabilityProbe : ICudaCapabilityProbe
    {
        public Task<CapabilityProbeResult> ProbeAsync(string stagedInstallPath, CancellationToken cancellationToken) => Task.FromCanceled<CapabilityProbeResult>(new CancellationToken(true));
    }

    private sealed class NoOpOperations : ISetupCommandOperations
    {
        public Task ExecuteRuntimeAsync(SetupCommandLineOptions options, IProgress<InstallProgress>? progress, CancellationToken cancellationToken) => Task.CompletedTask;
        public Task ExecuteRepairManagerAsync(SetupCommandLineOptions options, CancellationToken cancellationToken) => Task.CompletedTask;
        public Task HandoffToCurrentAppAsync(SetupCommandLineOptions options, CancellationToken cancellationToken) => Task.CompletedTask;
    }

    private sealed class FixedArchiveAcquirer : IRuntimeArchiveAcquirer
    {
        public Task<IReadOnlyList<string>> AcquireAsync(RuntimeReplacementRequest request, CancellationToken cancellationToken) => Task.FromResult(request.ArchiveParts);
    }

    private sealed class StagedCudaExtractor(RuntimeIdentity identity) : IArchiveExtractor
    {
        public Task<IReadOnlyList<string>> ListEntriesAsync(IReadOnlyList<string> archiveParts, CancellationToken cancellationToken) => Task.FromResult((IReadOnlyList<string>)["VRCNT.exe", "VRCNT-backend.exe", "VRCNT.runtime.json"]);
        public Task TestAsync(IReadOnlyList<string> archiveParts, CancellationToken cancellationToken) => Task.CompletedTask;
        public Task ExtractAsync(IReadOnlyList<string> archiveParts, string destination, CancellationToken cancellationToken)
        {
            Directory.CreateDirectory(destination);
            File.WriteAllText(Path.Combine(destination, "VRCNT.exe"), "app");
            File.WriteAllText(Path.Combine(destination, "VRCNT-backend.exe"), "backend");
            File.WriteAllText(Path.Combine(destination, "VRCNT.runtime.json"), JsonSerializer.Serialize(new { identity.Product, identity.Version, identity.Variant, identity.Architecture, BuildIdentity = identity.BuildIdentity }));
            return Task.CompletedTask;
        }
    }

    private sealed class FixedVolumeProbe : IVolumeIdentityProbe
    {
        public string GetVolumeIdentity(string path) => "volume";
    }

    private sealed class FixedSpaceProbe : IAvailableSpaceProbe
    {
        public long GetAvailableBytes(string path) => long.MaxValue;
    }

    private sealed class RecordingProcessCoordinator : IRuntimeProcessCoordinator
    {
        public bool StopRequested { get; private set; }
        public Task<ProcessStopResult> RequestGracefulStopAsync(CancellationToken cancellationToken) { StopRequested = true; return Task.FromResult(new ProcessStopResult(true, [], false, null)); }
        public Task<bool> AreKnownProcessesStoppedAsync(CancellationToken cancellationToken) => Task.FromResult(true);
        public Task LaunchForActivationAsync(string installPath, RuntimeIdentity expectedIdentity, ActivationRequest request, CancellationToken cancellationToken) => Task.CompletedTask;
        public Task RelaunchActiveRuntimeAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    }

    private sealed class FixedHealthMonitor : IRuntimeActivationHealthMonitor
    {
        public Task<RuntimeActivationHealthResult> WaitForReadyAsync(string installPath, RuntimeIdentity expectedIdentity, ActivationRequest request, CancellationToken cancellationToken) => Task.FromResult(new RuntimeActivationHealthResult(true, false, null));
    }

    private sealed class FixedStateTransition : IRuntimeStateTransition
    {
        public void ValidateExistingRuntime(string installPath) { }
        public void WriteActiveRuntime(string installPath, RuntimeIdentity identity) { }
    }
}
