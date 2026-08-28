using System.Windows;
using System.Windows.Media;
using VRCNT.RuntimeCore.Manager;
using VRCNT.Setup.CommandLine;
using VRCNT.Setup.Localization;
using VRCNT.Setup.Views;

namespace VRCNT.Setup;

public partial class App : Application
{
    public static ManagerCapabilities Capabilities { get; } = ManagerCapabilities.Current;

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        ApplyAccessibilityTokens();
        try
        {
            var options = SetupCommandLine.Parse(e.Args);
            var operations = SetupCommandOperations.CreateProduction(Capabilities);
            if (!SetupCommandLine.ShouldShowUi(options))
            {
                var exitCode = await new SetupCommandDispatcher(operations).DispatchAsync(options, CancellationToken.None);
                Shutdown(exitCode);
                return;
            }
            var viewModel = new InstallerViewModel(operations, options, InstallerLocalizer.FromEmbedded());
            MainWindow = new MainWindow(viewModel);
            MainWindow.Show();
        }
        catch (ArgumentException exception)
        {
            if (!TryIsPassive(e.Args)) MessageBox.Show(exception.Message, "VRCNT Setup", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(2);
        }
        catch (Exception exception)
        {
            if (!TryIsPassive(e.Args)) MessageBox.Show(exception.Message, "VRCNT Setup", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
        }
    }

    private static bool TryIsPassive(IReadOnlyList<string> args) => args.Any(argument => argument.Equals("/passive", StringComparison.OrdinalIgnoreCase));

    private void ApplyAccessibilityTokens()
    {
        Resources["InstallerBodyFontSize"] = Math.Max(14d, SystemFonts.MessageFontSize);
        Resources["InstallerHeadingFontSize"] = Math.Max(28d, SystemFonts.MessageFontSize * 2d);
        if (SystemParameters.HighContrast)
        {
            Resources["InstallerCanvasBrush"] = SystemColors.WindowBrush;
            Resources["InstallerSurfaceBrush"] = SystemColors.WindowBrush;
            Resources["InstallerSurfaceMutedBrush"] = SystemColors.ControlBrush;
            Resources["InstallerTextBrush"] = SystemColors.WindowTextBrush;
            Resources["InstallerTextMutedBrush"] = SystemColors.GrayTextBrush;
            Resources["InstallerBorderBrush"] = SystemColors.WindowTextBrush;
            Resources["InstallerAccentBrush"] = SystemColors.HighlightBrush;
            Resources["InstallerAccentTextBrush"] = SystemColors.HighlightTextBrush;
            Resources["InstallerFocusBrush"] = SystemColors.HighlightBrush;
            return;
        }
        if (IsDarkMode())
        {
            SetBrush("InstallerCanvasBrush", "#171B22");
            SetBrush("InstallerSurfaceBrush", "#202632");
            SetBrush("InstallerSurfaceMutedBrush", "#2A3341");
            SetBrush("InstallerTextBrush", "#F1F4F8");
            SetBrush("InstallerTextMutedBrush", "#B7C1D0");
            SetBrush("InstallerBorderBrush", "#455264");
        }
    }

    private static bool IsDarkMode()
    {
        try
        {
            return Microsoft.Win32.Registry.GetValue(
                @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
                "AppsUseLightTheme", 1) is int value && value == 0;
        }
        catch (Exception) { return false; }
    }

    private void SetBrush(string key, string color) => Resources[key] = new SolidColorBrush((Color)ColorConverter.ConvertFromString(color));
}
