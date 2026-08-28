using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
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
    private InstallerPage _currentPage = InstallerPage.Welcome;
    private InstallerLanguage _selectedLanguage;
    private RuntimeVariant _selectedVariant = RuntimeVariant.Cpu;
    private bool _launchAfterSetup = true;
    private bool _isInstalling;

    public InstallerViewModel(ISetupCommandOperations operations, SetupCommandLineOptions options, InstallerLocalizer localizer)
    {
        _operations = operations ?? throw new ArgumentNullException(nameof(operations));
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _localizer = localizer ?? throw new ArgumentNullException(nameof(localizer));
        if (options.InstallerLanguage is not null) _localizer.SetLanguage(options.InstallerLanguage);
        _selectedLanguage = _localizer.Languages.Single(language => language.Id == _localizer.CurrentLanguage);
        _localizer.LanguageChanged += (_, _) => RefreshLocalizedProperties();
        ContinueCommand = new DelegateCommand(Continue);
        BackCommand = new DelegateCommand(Back);
        InstallCommand = new AsyncDelegateCommand(InstallAsync, () => !IsInstalling);
        RetryCommand = new DelegateCommand(() => CurrentPage = InstallerPage.Options);
        LaunchCommand = new DelegateCommand(LaunchVrcnt, () => CurrentPage == InstallerPage.Complete);
        CloseCommand = new DelegateCommand(() => CloseRequested?.Invoke(this, EventArgs.Empty));
    }

    public event PropertyChangedEventHandler? PropertyChanged;
    public event EventHandler? CloseRequested;

    public ICommand ContinueCommand { get; }
    public ICommand BackCommand { get; }
    public ICommand InstallCommand { get; }
    public ICommand RetryCommand { get; }
    public ICommand LaunchCommand { get; }
    public ICommand CloseCommand { get; }

    public IReadOnlyList<InstallerLanguage> Languages => _localizer.Languages;
    public InstallerPage CurrentPage
    {
        get => _currentPage;
        private set
        {
            if (SetField(ref _currentPage, value)) OnPropertyChanged(nameof(ProgressValue));
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
    public RuntimeVariant SelectedVariant { get => _selectedVariant; set { if (SetField(ref _selectedVariant, value)) RefreshLocalizedProperties(); } }
    public bool IsCpuSelected { get => SelectedVariant == RuntimeVariant.Cpu; set { if (value) SelectedVariant = RuntimeVariant.Cpu; } }
    public bool IsCudaSelected { get => SelectedVariant == RuntimeVariant.Cuda; set { if (value) SelectedVariant = RuntimeVariant.Cuda; } }
    public bool LaunchAfterSetup { get => _launchAfterSetup; set => SetField(ref _launchAfterSetup, value); }
    public bool IsInstalling
    {
        get => _isInstalling;
        private set
        {
            if (!SetField(ref _isInstalling, value)) return;
            ((AsyncDelegateCommand)InstallCommand).RaiseCanExecuteChanged();
            OnPropertyChanged(nameof(ProgressValue));
            OnPropertyChanged(nameof(IsProgressIndeterminate));
        }
    }
    public bool UseReducedMotion => !SystemParameters.ClientAreaAnimation;
    public bool IsProgressIndeterminate => IsInstalling && !UseReducedMotion;
    public double ProgressValue => CurrentPage == InstallerPage.Complete ? 100 : IsInstalling ? 35 : 0;

    public string AppTitle => T("app_name");
    public string WelcomeTitle => T("welcome_title");
    public string WelcomeBody => T("welcome_body");
    public string ContinueText => T("continue");
    public string BackText => T("back");
    public string LanguageTitle => T("language_title");
    public string LanguageBody => T("language_body");
    public string RuntimeTitle => T("runtime_title");
    public string RuntimeBody => T("runtime_body");
    public string CpuTitle => T("cpu_title");
    public string CpuBody => T("cpu_body");
    public string CpuSize => T("cpu_size");
    public string CpuTime => T("cpu_time");
    public string CudaTitle => T("cuda_title");
    public string CudaBody => T("cuda_body");
    public string CudaSize => T("cuda_size");
    public string CudaTime => T("cuda_time");
    public string CpuStatus => SelectedVariant == RuntimeVariant.Cpu ? T("recommended") : T("compatible");
    public string CudaStatus => SelectedVariant == RuntimeVariant.Cuda ? T("recommended") : T("compatible");
    public string InstallSizeLabel => T("install_size");
    public string InstallTimeLabel => T("install_time");
    public string OptionsTitle => T("options_title");
    public string OptionsBody => T("options_body");
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

    private async Task InstallAsync()
    {
        var installPath = _options.InstallPath ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VRCNT");
        var configPath = Path.Combine(installPath, "config.json");
        var initializeLanguage = !_options.IsUpdate && !_options.IsSwitch && !File.Exists(configPath);
        IsInstalling = true;
        CurrentPage = InstallerPage.Progress;
        try
        {
            var request = _options with { Variant = SelectedVariant, InstallerLanguage = SelectedLanguage.Id };
            await new SetupCommandDispatcher(_operations).DispatchAsync(request, CancellationToken.None);
            if (initializeLanguage && !File.Exists(configPath))
            {
                Directory.CreateDirectory(installPath);
                await File.WriteAllTextAsync(configPath, JsonSerializer.Serialize(new Dictionary<string, string>
                {
                    ["UI_LANGUAGE"] = SelectedLanguage.Id,
                }));
            }
            CurrentPage = InstallerPage.Complete;
        }
        catch (Exception)
        {
            CurrentPage = InstallerPage.Error;
        }
        finally
        {
            IsInstalling = false;
        }
    }

    private void LaunchVrcnt()
    {
        if (!LaunchAfterSetup) return;
        var installPath = _options.InstallPath ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VRCNT");
        var executable = Path.Combine(installPath, "VRCNT.exe");
        if (File.Exists(executable)) Process.Start(new ProcessStartInfo(executable) { UseShellExecute = true });
    }

    private string T(string key) => _localizer[key];

    private void RefreshLocalizedProperties()
    {
        foreach (var property in new[]
        {
            nameof(AppTitle), nameof(WelcomeTitle), nameof(WelcomeBody), nameof(ContinueText), nameof(BackText),
            nameof(LanguageTitle), nameof(LanguageBody), nameof(RuntimeTitle), nameof(RuntimeBody), nameof(CpuTitle),
            nameof(CpuBody), nameof(CpuSize), nameof(CpuTime), nameof(CudaTitle), nameof(CudaBody), nameof(CudaSize),
            nameof(CudaTime), nameof(CpuStatus), nameof(CudaStatus), nameof(InstallSizeLabel), nameof(InstallTimeLabel),
            nameof(OptionsTitle), nameof(OptionsBody), nameof(LaunchVrcntText), nameof(InstallText), nameof(ProgressTitle),
            nameof(ProgressBody), nameof(ErrorTitle), nameof(ErrorBody), nameof(RetryText), nameof(CompleteTitle),
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
        public event EventHandler? CanExecuteChanged
        {
            add => CommandManager.RequerySuggested += value;
            remove => CommandManager.RequerySuggested -= value;
        }
        public bool CanExecute(object? parameter) => canExecute?.Invoke() ?? true;
        public void Execute(object? parameter) => execute();
    }

    private sealed class AsyncDelegateCommand(Func<Task> execute, Func<bool> canExecute) : ICommand
    {
        public event EventHandler? CanExecuteChanged;
        public bool CanExecute(object? parameter) => canExecute();
        public async void Execute(object? parameter) => await execute();
        public void RaiseCanExecuteChanged() => CanExecuteChanged?.Invoke(this, EventArgs.Empty);
    }
}
