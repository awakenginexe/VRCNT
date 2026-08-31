using VRCNT.RuntimeCore.Models;
using VRCNT.RuntimeCore.Hardware;
using VRCNT.Setup.CommandLine;
using VRCNT.Setup.Localization;
using VRCNT.Setup.Views;
using Xunit;
using System.Xml.Linq;

namespace VRCNT.RuntimeCore.Tests;

public sealed class InstallerViewModelTests
{
    [Fact]
    public async Task Install_binds_actual_transaction_progress_and_error_detail()
    {
        var operations = new DeferredProgressOperations();
        var viewModel = CreateViewModel(operations);

        var install = viewModel.InstallAsync();
        await operations.ProgressReported.Task;

        Assert.Equal(18.75, viewModel.ProgressValue);
        Assert.Equal("runtime.7z", viewModel.ProgressDetail);

        operations.Fail(new InvalidOperationException("Signed release metadata could not be verified."));
        await install;

        Assert.Equal(InstallerPage.Error, viewModel.CurrentPage);
        Assert.Equal("Signed release metadata could not be verified.", viewModel.ErrorDetail);
    }

    [Fact]
    public async Task Install_keeps_phase_progress_determinate_and_records_live_history()
    {
        var operations = new DeferredProgressOperations
        {
            ReportedProgress =
            [
                new InstallProgress(TransactionPhase.Preflight, 0, 0, "Validating replacement paths."),
                new InstallProgress(TransactionPhase.Acquire, 0, 0, "Acquiring resumable runtime archives."),
                new InstallProgress(TransactionPhase.Stage, 0, 0, "Extracting archive into the transaction staging directory."),
            ],
        };
        var viewModel = CreateViewModel(operations);

        var install = viewModel.InstallAsync();
        await operations.ProgressReported.Task;

        Assert.Equal(70, viewModel.ProgressValue);
        Assert.Equal("Extracting archive into the transaction staging directory.", viewModel.ProgressDetail);
        var historyProperty = typeof(InstallerViewModel).GetProperty("ProgressHistory");
        Assert.NotNull(historyProperty);
        var history = Assert.IsAssignableFrom<IEnumerable<string>>(historyProperty!.GetValue(viewModel));
        Assert.Equal(
            [
                "Validating replacement paths.",
                "Acquiring resumable runtime archives.",
                "Extracting archive into the transaction staging directory.",
            ],
            history);

        operations.Fail(new InvalidOperationException("Installation interrupted."));
        await install;
    }

    [Fact]
    public async Task Automatic_launch_respects_the_checkbox_but_completion_launch_always_runs()
    {
        var launcher = new RecordingLauncher();
        var viewModel = CreateViewModel(new DeferredProgressOperations { CompleteImmediately = true }, launcher);
        viewModel.LaunchAfterSetup = false;

        await viewModel.InstallAsync();
        Assert.Equal(0, launcher.Count);

        viewModel.LaunchCommand.Execute(null);
        Assert.Equal(1, launcher.Count);

        var automaticLauncher = new RecordingLauncher();
        var automaticViewModel = CreateViewModel(new DeferredProgressOperations { CompleteImmediately = true }, automaticLauncher);

        await automaticViewModel.InstallAsync();

        Assert.Equal(1, automaticLauncher.Count);
    }

    [Fact]
    public void Inconclusive_gpu_advice_keeps_cpu_recommended_and_reports_staged_post_download_validation()
    {
        var viewModel = CreateViewModel(new DeferredProgressOperations(), gpuAdvisoryPolicy: new FixedGpuAdvisoryPolicy(GpuAdvisory.Inconclusive));

        Assert.Equal("Recommended", viewModel.CpuStatus);
        Assert.Equal("Requires a compatible NVIDIA GPU", viewModel.CudaStatus);
        Assert.Equal("CUDA is checked locally after download and before VRCNT is replaced.", viewModel.CudaAdvisory);
    }

    [Fact]
    public void Nvidia_detection_marks_cuda_recommended_and_cpu_compatible()
    {
        var viewModel = CreateViewModel(
            new DeferredProgressOperations(),
            new SetupCommandLineOptions(false, false, false, false, false, RuntimeVariant.Cpu, "C:\\VRCNT", null, [], "en"),
            new FixedGpuSelectionPolicy(RuntimeVariant.Cuda));

        Assert.Equal(RuntimeVariant.Cuda, viewModel.SelectedVariant);
        Assert.False(viewModel.IsCpuSelected);
        Assert.True(viewModel.IsCudaSelected);
        Assert.Equal("Compatible", viewModel.CpuStatus);
        Assert.Equal("Recommended", viewModel.CudaStatus);
    }

    [Fact]
    public void Runtime_page_binds_cuda_availability_detection_and_the_deliberate_advanced_override_control()
    {
        var xamlPath = Path.Combine(AppContext.BaseDirectory, "Views", "MainWindow.xaml");
        var xaml = File.ReadAllText(xamlPath);

        Assert.Contains("IsEnabled=\"{Binding CanSelectCudaRadio}\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Command=\"{Binding EnableAdvancedCudaOverrideCommand}\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Text=\"{Binding GpuDetectionState}\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Text=\"{Binding AdvancedCudaWarning}\"", xaml, StringComparison.Ordinal);
    }

    [Fact]
    public void Progress_value_binding_is_one_way_for_the_read_only_view_model_property()
    {
        var xamlPath = Path.Combine(AppContext.BaseDirectory, "Views", "MainWindow.xaml");
        var xaml = XDocument.Load(xamlPath);
        XNamespace presentation = "http://schemas.microsoft.com/winfx/2006/xaml/presentation";

        var progressBar = xaml.Descendants(presentation + "ProgressBar").Single();

        Assert.Equal("{Binding ProgressValue, Mode=OneWay}", progressBar.Attribute("Value")?.Value);
        Assert.Equal("False", progressBar.Attribute("IsIndeterminate")?.Value);
        var progressHistory = xaml.Descendants(presentation + "ItemsControl").Single();
        Assert.Equal("{Binding ProgressHistory}", progressHistory.Attribute("ItemsSource")?.Value);
    }

    [Theory]
    [InlineData(RuntimeVariant.Cpu, RuntimeVariant.Cuda)]
    [InlineData(RuntimeVariant.Cuda, RuntimeVariant.Cpu)]
    public async Task Switch_mode_keeps_the_confirmed_target_when_gpu_recommendation_disagrees(RuntimeVariant target, RuntimeVariant recommended)
    {
        var operations = new DeferredProgressOperations { CompleteImmediately = true };
        var options = SetupCommandLine.Parse(["--switch", "--variant", target == RuntimeVariant.Cuda ? "cuda" : "cpu"]);
        var launcher = new RecordingLauncher();
        var viewModel = CreateViewModel(operations, options, new FixedGpuSelectionPolicy(recommended), launcher);

        Assert.Equal(target, viewModel.SelectedVariant);
        await viewModel.InstallAsync();

        Assert.Equal(target, operations.ReceivedOptions!.Variant);
        Assert.Equal(1, launcher.Count);
    }

    private static InstallerViewModel CreateViewModel(DeferredProgressOperations operations, IApplicationLauncher? launcher = null, IGpuAdvisoryPolicy? gpuAdvisoryPolicy = null)
        => CreateViewModel(operations, new SetupCommandLineOptions(false, false, false, false, false, RuntimeVariant.Cpu, "C:\\VRCNT", null, [], "en"), new FixedGpuSelectionPolicy(RuntimeVariant.Cpu), launcher, gpuAdvisoryPolicy);

    private static InstallerViewModel CreateViewModel(DeferredProgressOperations operations, SetupCommandLineOptions options, IGpuSelectionPolicy gpuSelectionPolicy, IApplicationLauncher? launcher = null, IGpuAdvisoryPolicy? gpuAdvisoryPolicy = null)
    {
        var languages = new[] { new InstallerLanguage("en", "English"), new InstallerLanguage("th", "ไทย") };
        var translations = languages.ToDictionary(
            language => language.Id,
            _ => (IReadOnlyDictionary<string, string>)new Dictionary<string, string>
            {
                ["app_name"] = "VRCNT", ["welcome_title"] = "Welcome", ["welcome_body"] = "Body", ["continue"] = "Continue", ["back"] = "Back",
                ["language_title"] = "Language", ["language_body"] = "Language body", ["runtime_title"] = "Runtime", ["runtime_body"] = "Runtime body",
                ["cpu_title"] = "CPU", ["cpu_body"] = "CPU body", ["cpu_size"] = "1 GB", ["cpu_time"] = "5 min", ["cuda_title"] = "CUDA", ["cuda_body"] = "CUDA body", ["cuda_size"] = "2 GB", ["cuda_time"] = "10 min",
                ["recommended"] = "Recommended", ["compatible"] = "Compatible", ["cuda_requires_nvidia"] = "Requires a compatible NVIDIA GPU", ["cuda_advisory_inconclusive"] = "CUDA is checked locally after download and before VRCNT is replaced.", ["gpu_detection_nvidia"] = "NVIDIA GPU detected.", ["gpu_detection_no_nvidia"] = "No NVIDIA GPU detected.", ["gpu_detection_inconclusive"] = "GPU detection is inconclusive.", ["cuda_advanced_warning"] = "CUDA is not verified before download.", ["cuda_advanced_override"] = "I understand and enable CUDA",
                ["install_size"] = "Install size", ["install_time"] = "Install time", ["options_title"] = "Options", ["options_body"] = "Options body", ["launch_vrcnt"] = "Launch VRCNT", ["install"] = "Install",
                ["progress_title"] = "Installing", ["progress_body"] = "Please wait", ["error_title"] = "Error", ["error_body"] = "We could not install", ["retry"] = "Retry", ["complete_title"] = "Complete", ["complete_body"] = "Done", ["close"] = "Close",
            }, StringComparer.Ordinal);
        return new InstallerViewModel(operations, options, InstallerLocalizer.FromCatalog(languages, translations), launcher, gpuAdvisoryPolicy, gpuSelectionPolicy: gpuSelectionPolicy);
    }

    private sealed class DeferredProgressOperations : ISetupCommandOperations
    {
        private readonly TaskCompletionSource _completion = new();
        public TaskCompletionSource ProgressReported { get; } = new();
        public bool CompleteImmediately { get; init; }
        public IReadOnlyList<InstallProgress> ReportedProgress { get; init; } = [new InstallProgress(TransactionPhase.Acquire, 250, 1000, "runtime.7z")];
        public SetupCommandLineOptions? ReceivedOptions { get; private set; }

        public Task ExecuteRuntimeAsync(SetupCommandLineOptions options, IProgress<InstallProgress>? progress, CancellationToken cancellationToken)
        {
            ReceivedOptions = options;
            foreach (var item in ReportedProgress) progress?.Report(item);
            ProgressReported.TrySetResult();
            return CompleteImmediately ? Task.CompletedTask : _completion.Task;
        }

        public Task ExecuteRepairManagerAsync(SetupCommandLineOptions options, CancellationToken cancellationToken) => Task.CompletedTask;
        public Task HandoffToCurrentAppAsync(SetupCommandLineOptions options, CancellationToken cancellationToken) => Task.CompletedTask;
        public void Fail(Exception exception) => _completion.TrySetException(exception);
    }

    private sealed class RecordingLauncher : IApplicationLauncher
    {
        public int Count { get; private set; }
        public void Launch(string executablePath) => Count++;
    }

    private sealed class FixedGpuAdvisoryPolicy(GpuAdvisory advisory) : IGpuAdvisoryPolicy
    {
        public GpuAdvisory Assess() => advisory;
    }

    private sealed class FixedGpuSelectionPolicy(RuntimeVariant recommendedVariant) : IGpuSelectionPolicy
    {
        public GpuSelectionRecommendation Assess() => new(
            recommendedVariant,
            recommendedVariant == RuntimeVariant.Cuda,
            recommendedVariant != RuntimeVariant.Cuda,
            new GpuDetectionResult(
                recommendedVariant == RuntimeVariant.Cuda ? GpuDetectionStatus.NvidiaDetected : GpuDetectionStatus.NoNvidiaHardware,
                null,
                null,
                "fixture"));
    }
}
