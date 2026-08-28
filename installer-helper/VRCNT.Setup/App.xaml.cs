using System.Windows;
using System.Windows.Controls;
using VRCNT.RuntimeCore.Manager;
using VRCNT.Setup.CommandLine;

namespace VRCNT.Setup;

public partial class App : Application
{
    public static ManagerCapabilities Capabilities { get; } = ManagerCapabilities.Current;

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        try
        {
            var options = SetupCommandLine.Parse(e.Args);
            if (SetupCommandLine.ShouldShowUi(options))
            {
                MainWindow = CreateShell(options);
                MainWindow.Show();
            }

            var operations = SetupCommandOperations.CreateProduction(Capabilities);
            var exitCode = await new SetupCommandDispatcher(operations).DispatchAsync(options, CancellationToken.None);
            Shutdown(exitCode);
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

    private static Window CreateShell(SetupCommandLineOptions options)
    {
        var operation = options.IsRepairManager ? "Repairing setup manager" :
            options.IsSwitch ? $"Switching runtime to {options.Variant?.ToString().ToLowerInvariant()}" :
            options.IsUpdate ? "Updating VRCNT" : "VRCNT Setup";
        var detail = options.IsPassive ? "Passive mode" : "Setup manager ready";
        return new Window
        {
            Title = "VRCNT Setup",
            Width = 420,
            Height = 180,
            ResizeMode = ResizeMode.NoResize,
            WindowStartupLocation = WindowStartupLocation.CenterScreen,
            Content = new StackPanel
            {
                Margin = new Thickness(28),
                Children =
                {
                    new TextBlock { Text = operation, FontSize = 20, FontWeight = FontWeights.SemiBold },
                    new TextBlock { Text = detail, Margin = new Thickness(0, 12, 0, 0) },
                    new TextBlock { Text = $"VRCNT {Capabilities.Version}", Margin = new Thickness(0, 18, 0, 0), Opacity = 0.7 },
                },
            },
        };
    }
}
