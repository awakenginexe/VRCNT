using System.Windows;

namespace VRCNT.Setup.Views;

public partial class MainWindow : Window
{
    public MainWindow(InstallerViewModel viewModel)
    {
        InitializeComponent();
        DataContext = viewModel;
        viewModel.CloseRequested += (_, _) => Close();
    }

    private void Minimize_Click(object sender, RoutedEventArgs e)
    {
        WindowState = WindowState.Minimized;
    }
}
