using System.ComponentModel;
using System.Collections.ObjectModel;
using System.IO;
using System.Runtime.CompilerServices;
using System.Windows.Input;
using VRCNT.RuntimeCore.Hardware;
using VRCNT.RuntimeCore.Models;
using VRCNT.Setup.CommandLine;
using VRCNT.Setup.Localization;

namespace VRCNT.Setup.Views;

public enum InstallerPage
{
    Welcome,
    Language,
    Runtime,
    Options,
    Progress,
    Error,
    Complete,
}

public sealed class InstallerViewModel : INotifyPropertyChanged
{
    private readonly ISetupCommandOperations _operations;
    private readonly SetupCommandLineOptions _options;
    private readonly InstallerLocalizer _localizer;
    private readonly IApplicationLauncher _applicationLauncher;
    private readonly IInstallDirectoryPicker _installDirectoryPicker;
    private readonly IGpuAdvisoryPolicy _gpuAdvisoryPolicy;
    private readonly bool _usesInjectedGpuAdvisoryPolicy;
    private readonly GpuSelectionRecommendation _gpuSelection;
    private readonly bool _useReducedMotion;
    private readonly DelegateCommand _launchCommand;
    private readonly ObservableCollection<string> _progressHistory = [];
    private InstallerPage _currentPage = InstallerPage.Welcome;
    private InstallerLanguage _selectedLanguage;
    private RuntimeVariant _selectedVariant = RuntimeVariant.Cpu;
    private bool _launchAfterSetup;
    private string _installPath = string.Empty;
    private bool _isInstalling;
    private bool _advancedCudaOverrideEnabled;
    private double _progressValue;
    private string _progressDetail = string.Empty;
    private string _errorDetail = string.Empty;

    public InstallerViewModel(
        ISetupCommandOperations operations,
        SetupCommandLineOptions options,
        InstallerLocalizer localizer,
        IApplicationLauncher? applicationLauncher = null,
        IGpuAdvisoryPolicy? gpuAdvisoryPolicy = null,
        bool useReducedMotion = false,
        IGpuSelectionPolicy? gpuSelectionPolicy = null,
        IInstallDirectoryPicker? installDirectoryPicker = null)
    {
        _operations = operations ?? throw new ArgumentNullException(nameof(operations));
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _localizer = localizer ?? throw new ArgumentNullException(nameof(localizer));
        _applicationLauncher = applicationLauncher ?? new ApplicationLauncher();
        _installDirectoryPicker = installDirectoryPicker ?? new NullInstallDirectoryPicker();
        _gpuAdvisoryPolicy = gpuAdvisoryPolicy ?? new InconclusiveGpuAdvisoryPolicy();
        _usesInjectedGpuAdvisoryPolicy = gpuAdvisoryPolicy is not null;
        _gpuSelection = (gpuSelectionPolicy ?? new GpuSelectionPolicy(new DxgiGpuDetector())).Assess();
        _selectedVariant = options.IsSwitch
            ? options.TargetVariant ?? throw new ArgumentException("A runtime switch requires an explicit target variant.", nameof(options))
            : _gpuSelection.RecommendedVariant;
        _installPath = options.InstallPath ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VRCNT");
        _useReducedMotion = useReducedMotion;
        ProgressHistory = new ReadOnlyObservableCollection<string>(_progressHistory);
        if (options.InstallerLanguage is not null) _localizer.SetLanguage(options.InstallerLanguage);
        _selectedLanguage = _localizer.Languages.Single(language => language.Id == _localizer.CurrentLanguage);
        _localizer.LanguageChanged += (_, _) => RefreshLocalizedProperties();
        ContinueCommand = new DelegateCommand(Continue);
        BackCommand = new DelegateCommand(Back);
        InstallCommand = new AsyncDelegateCommand(InstallAsync, () => !IsInstalling);
        RetryCommand = new DelegateCommand(() => CurrentPage = InstallerPage.Options);
        _launchCommand = new DelegateCommand(() => LaunchVrcnt(force: true), () => CurrentPage == InstallerPage.Complete);
        LaunchCommand = _launchCommand;
        CloseCommand = new DelegateCommand(() => CloseRequested?.Invoke(this, EventArgs.Empty));
        EnableAdvancedCudaOverrideCommand = new DelegateCommand(EnableAdvancedCudaOverride, () => RequiresAdvancedCudaOverride && !AdvancedCudaOverrideEnabled);
        BrowseInstallDirectoryCommand = new DelegateCommand(BrowseInstallDirectory, () => CanChooseInstallDirectory && !IsInstalling);
    }

    public event PropertyChangedEventHandler? PropertyChanged;
    public event EventHandler? CloseRequested;

    public ICommand ContinueCommand { get; }
    public ICommand BackCommand { get; }
    public ICommand InstallCommand { get; }
    public ICommand RetryCommand { get; }
    public ICommand LaunchCommand { get; }
    public ICommand CloseCommand { get; }
    public ICommand EnableAdvancedCudaOverrideCommand { get; }
    public ICommand BrowseInstallDirectoryCommand { get; }

    public IReadOnlyList<InstallerLanguage> Languages => _localizer.Languages;

    public Task BeginSwitchAsync() => IsSwitch ? InstallAsync() : Task.CompletedTask;

    public InstallerPage CurrentPage
    {
        get => _currentPage;
        private set
        {
            if (SetField(ref _currentPage, value))
            {
                OnPropertyChanged(nameof(CurrentPageTitle));
                OnPropertyChanged(nameof(ProgressValue));
                _launchCommand.RaiseCanExecuteChanged();
            }
        }
    }
    public InstallerLanguage SelectedLanguage
    {
        get => _selectedLanguage;
        set
        {
            if (SetField(ref _selectedLanguage, value)) _localizer.SetLanguage(value.Id);
        }
    }
    public bool IsSwitch => _options.IsSwitch;
    public RuntimeVariant TargetVariant => _options.TargetVariant ?? throw new InvalidOperationException("The switch target is unavailable.");
    public bool IsRuntimeSelectionLocked => IsSwitch;
    public bool CanChangeRuntimeSelection => !IsSwitch;
    public bool CanSelectCudaRadio => !IsSwitch && CanSelectCuda;
    public RuntimeVariant SelectedVariant
    {
        get => _selectedVariant;
        set
        {
            if (IsSwitch && value != TargetVariant) return;
            if (!IsSwitch && value == RuntimeVariant.Cuda && !CanSelectCuda) return;
            if (SetField(ref _selectedVariant, value)) RefreshLocalizedProperties();
        }
    }
    public bool IsCpuSelected { get => SelectedVariant == RuntimeVariant.Cpu; set { if (value) SelectedVariant = RuntimeVariant.Cpu; } }
    public bool IsCudaSelected
    {
        get => SelectedVariant == RuntimeVariant.Cuda;
        set
        {
            if (!value) return;
            if (CanSelectCuda) SelectedVariant = RuntimeVariant.Cuda;
        }
    }
    public bool IsCudaNormallyAvailable => _gpuSelection.IsCudaNormallyAvailable;
    public bool RequiresAdvancedCudaOverride => _gpuSelection.RequiresAdvancedCudaOverride;
    public bool AdvancedCudaOverrideEnabled
    {
        get => _advancedCudaOverrideEnabled;
        private set
        {
            if (!SetField(ref _advancedCudaOverrideEnabled, value)) return;
            OnPropertyChanged(nameof(CanSelectCuda));
            ((DelegateCommand)EnableAdvancedCudaOverrideCommand).RaiseCanExecuteChanged();
        }
    }
    public bool CanSelectCuda => IsSwitch ? TargetVariant == RuntimeVariant.Cuda : IsCudaNormallyAvailable || (RequiresAdvancedCudaOverride && AdvancedCudaOverrideEnabled);
    public bool LaunchAfterSetup { get => _launchAfterSetup; set => SetField(ref _launchAfterSetup, value); }
    public bool CanChooseInstallDirectory => !IsSwitch;
    public string InstallPath { get => _installPath; set => SetField(ref _installPath, value); }
    public bool IsInstalling
    {
        get => _isInstalling;
        private set
        {
            if (!SetField(ref _isInstalling, value)) return;
            ((AsyncDelegateCommand)InstallCommand).RaiseCanExecuteChanged();
            ((DelegateCommand)BrowseInstallDirectoryCommand).RaiseCanExecuteChanged();
        }
    }
    public bool UseReducedMotion => _useReducedMotion;
    public double ProgressValue
    {
        get => _progressValue;
        private set
        {
            if (SetField(ref _progressValue, Math.Clamp(value, 0, 100)))
                OnPropertyChanged(nameof(ProgressPercentText));
        }
    }
    public string ProgressPercentText => $"{Math.Round(ProgressValue):0}%";
    public string ProgressDetail { get => _progressDetail; private set => SetField(ref _progressDetail, value); }
    public ReadOnlyObservableCollection<string> ProgressHistory { get; }
    public string ErrorDetail { get => _errorDetail; private set => SetField(ref _errorDetail, value); }

    public string AppTitle => T("app_name");
    public string WelcomeTitle => T("welcome_title");
    public string WelcomeBody => T("welcome_body");
    public string ContinueText => T("continue");
    public string BackText => T("back");
    public string LanguageTitle => T("language_title");
    public string LanguageBody => T("language_body");
    public string RuntimeTitle => T("runtime_title");
    public string RuntimeBody => T("runtime_body");
    public string ConfirmedTargetText => IsSwitch ? SelectedRuntimeTitle : string.Empty;
    public string CpuTitle => T("cpu_title");
    public string CpuBody => T("cpu_body");
    public string CpuSize => T("cpu_size");
    public string CpuTime => T("cpu_time");
    public string CudaTitle => T("cuda_title");
    public string CudaBody => T("cuda_body");
    public string CudaSize => T("cuda_size");
    public string CudaTime => T("cuda_time");
    public string CurrentPageTitle => CurrentPage switch
    {
        InstallerPage.Welcome => WelcomeTitle,
        InstallerPage.Language => LanguageTitle,
        InstallerPage.Runtime => RuntimeTitle,
        InstallerPage.Options => OptionsTitle,
        InstallerPage.Progress => ProgressTitle,
        InstallerPage.Error => ErrorTitle,
        InstallerPage.Complete => CompleteTitle,
        _ => AppTitle,
    };
    public string SelectedRuntimeTitle => SelectedVariant == RuntimeVariant.Cpu ? CpuTitle : CudaTitle;
    public string SelectedRuntimeSize => SelectedVariant == RuntimeVariant.Cpu ? CpuSize : CudaSize;
    public string SelectedRuntimeTime => SelectedVariant == RuntimeVariant.Cpu ? CpuTime : CudaTime;
    public string CpuStatus => _gpuSelection.RecommendedVariant == RuntimeVariant.Cpu ? T("recommended") : T("compatible");
    public string CudaStatus => !_usesInjectedGpuAdvisoryPolicy && _gpuSelection.Detection.Status == GpuDetectionStatus.NvidiaDetected ? T("recommended") : _gpuAdvisoryPolicy.Assess().Compatibility switch
    {
        GpuCompatibility.Recommended => T("recommended"),
        GpuCompatibility.Compatible => T("compatible"),
        _ => T("cuda_requires_nvidia"),
    };
    public string CudaAdvisory => !_usesInjectedGpuAdvisoryPolicy && _gpuSelection.Detection.Status == GpuDetectionStatus.NvidiaDetected ? string.Empty : _gpuAdvisoryPolicy.Assess().Compatibility switch
    {
        GpuCompatibility.Recommended or GpuCompatibility.Compatible => string.Empty,
        _ => T("cuda_advisory_inconclusive"),
    };
    public string GpuDetectionState => _gpuSelection.Detection.Status switch
    {
        GpuDetectionStatus.NvidiaDetected => T("gpu_detection_nvidia"),
        GpuDetectionStatus.NoNvidiaHardware => T("gpu_detection_no_nvidia"),
        _ => T("gpu_detection_inconclusive"),
    };
    public string AdvancedCudaWarning => RequiresAdvancedCudaOverride ? T("cuda_advanced_warning") : string.Empty;
    public string EnableAdvancedCudaOverrideText => T("cuda_advanced_override");
    public string InstallSizeLabel => T("install_size");
    public string InstallTimeLabel => T("install_time");
    public string OptionsTitle => T("options_title");
    public string OptionsBody => T("options_body");
    public string InstallLocationLabel => T("install_location");
    public string BrowseInstallDirectoryText => T("browse_install_directory");
    public string LaunchAfterSetupText => T("launch_after_setup");
    public string LaunchVrcntText => T("launch_vrcnt");
    public string InstallText => T("install");
    public string ProgressTitle => T("progress_title");
    public string ProgressBody => T("progress_body");
    public string ErrorTitle => T("error_title");
    public string ErrorBody => T("error_body");
    public string RetryText => T("retry");
    public string CompleteTitle => T("complete_title");
    public string CompleteBody => T("complete_body");
    public string CloseText => T("close");

    private void Continue()
    {
        CurrentPage = CurrentPage switch
        {
            InstallerPage.Welcome => InstallerPage.Language,
            InstallerPage.Language => InstallerPage.Runtime,
            InstallerPage.Runtime => InstallerPage.Options,
            _ => CurrentPage,
        };
    }

    private void EnableAdvancedCudaOverride()
    {
        if (RequiresAdvancedCudaOverride) AdvancedCudaOverrideEnabled = true;
    }

    private void BrowseInstallDirectory()
    {
        if (!CanChooseInstallDirectory) return;
        var selected = _installDirectoryPicker.PickDirectory(InstallPath);
        if (!string.IsNullOrWhiteSpace(selected)) InstallPath = selected;
    }

    private void Back()
    {
        CurrentPage = CurrentPage switch
        {
            InstallerPage.Language => InstallerPage.Welcome,
            InstallerPage.Runtime => InstallerPage.Language,
            InstallerPage.Options => InstallerPage.Runtime,
            _ => CurrentPage,
        };
    }

    public async Task InstallAsync()
    {
        ProgressValue = 0;
        ProgressDetail = string.Empty;
        _progressHistory.Clear();
        ErrorDetail = string.Empty;
        IsInstalling = true;
        CurrentPage = InstallerPage.Progress;
        try
        {
            var request = _options with { TargetVariant = IsSwitch ? TargetVariant : SelectedVariant, InstallPath = InstallPath, InstallerLanguage = SelectedLanguage.Id };
            await new SetupCommandDispatcher(_operations).DispatchAsync(request, CancellationToken.None, new InlineProgress<InstallProgress>(ReportProgress));
            ProgressValue = 100;
            CurrentPage = InstallerPage.Complete;
            if (LaunchAfterSetup || IsSwitch) LaunchVrcnt(force: IsSwitch);
        }
        catch (Exception exception)
        {
            ErrorDetail = exception.Message;
            CurrentPage = InstallerPage.Error;
        }
        finally
        {
            IsInstalling = false;
        }
    }

    private void LaunchVrcnt(bool force)
    {
        if (!force && !LaunchAfterSetup) return;
        var executable = Path.Combine(InstallPath, "VRCNT.exe");
        _applicationLauncher.Launch(executable);
        if (force) CloseRequested?.Invoke(this, EventArgs.Empty);
    }

    private void ReportProgress(InstallProgress progress)
    {
        ProgressDetail = progress.Message;
        ProgressValue = GetProgressValue(progress);
        if (_progressHistory.LastOrDefault() != progress.Message)
            _progressHistory.Add(progress.Message);
    }

    private static double GetProgressValue(InstallProgress progress) => progress.Phase switch
    {
        TransactionPhase.Preflight => 0,
        TransactionPhase.Acquire when progress.TotalBytes > 0 => 5 + 55 * Math.Clamp(progress.CompletedBytes / (double)progress.TotalBytes, 0, 1),
        TransactionPhase.Acquire => 5,
        TransactionPhase.Verify => 60,
        TransactionPhase.Stage => 70,
        TransactionPhase.Quiesce => 80,
        TransactionPhase.Replace => 87,
        TransactionPhase.Activate => 94,
        TransactionPhase.Commit => 98,
        TransactionPhase.Cleanup => 100,
        _ => 0,
    };

    private string T(string key) => _localizer[key];

    private void RefreshLocalizedProperties()
    {
        foreach (var property in new[]
        {
            nameof(AppTitle), nameof(WelcomeTitle), nameof(WelcomeBody), nameof(ContinueText), nameof(BackText),
            nameof(LanguageTitle), nameof(LanguageBody), nameof(RuntimeTitle), nameof(RuntimeBody), nameof(ConfirmedTargetText), nameof(CpuTitle),
            nameof(CpuBody), nameof(CpuSize), nameof(CpuTime), nameof(CudaTitle), nameof(CudaBody), nameof(CudaSize),
            nameof(CudaTime), nameof(CpuStatus), nameof(CudaStatus), nameof(CudaAdvisory), nameof(GpuDetectionState), nameof(AdvancedCudaWarning), nameof(EnableAdvancedCudaOverrideText), nameof(IsCudaNormallyAvailable), nameof(RequiresAdvancedCudaOverride), nameof(AdvancedCudaOverrideEnabled), nameof(CanSelectCuda), nameof(SelectedRuntimeTitle), nameof(SelectedRuntimeSize), nameof(SelectedRuntimeTime), nameof(CurrentPageTitle), nameof(InstallSizeLabel), nameof(InstallTimeLabel),
            nameof(OptionsTitle), nameof(OptionsBody), nameof(LaunchAfterSetupText), nameof(LaunchVrcntText), nameof(InstallText), nameof(ProgressTitle), nameof(CanChangeRuntimeSelection), nameof(CanSelectCudaRadio),
            nameof(InstallLocationLabel), nameof(BrowseInstallDirectoryText), nameof(ProgressBody), nameof(ErrorTitle), nameof(ErrorBody), nameof(RetryText), nameof(CompleteTitle),
            nameof(CompleteBody), nameof(CloseText),
        }) OnPropertyChanged(property);
    }

    private bool SetField<T>(ref T field, T value, [CallerMemberName] string? propertyName = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return false;
        field = value;
        OnPropertyChanged(propertyName);
        return true;
    }

    private void OnPropertyChanged([CallerMemberName] string? propertyName = null) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));

    private sealed class DelegateCommand(Action execute, Func<bool>? canExecute = null) : ICommand
    {
        public event EventHandler? CanExecuteChanged;
        public bool CanExecute(object? parameter) => canExecute?.Invoke() ?? true;
        public void Execute(object? parameter) => execute();
        public void RaiseCanExecuteChanged() => CanExecuteChanged?.Invoke(this, EventArgs.Empty);
    }

    private sealed class AsyncDelegateCommand(Func<Task> execute, Func<bool> canExecute) : ICommand
    {
        public event EventHandler? CanExecuteChanged;
        public bool CanExecute(object? parameter) => canExecute();
        public async void Execute(object? parameter) => await execute();
        public void RaiseCanExecuteChanged() => CanExecuteChanged?.Invoke(this, EventArgs.Empty);
    }

    private sealed class InlineProgress<T>(Action<T> report) : IProgress<T>
    {
        public void Report(T value) => report(value);
    }
}
