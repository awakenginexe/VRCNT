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

    private bool _autoScroll = true;

    private void ProgressScrollViewer_ScrollChanged(object sender, System.Windows.Controls.ScrollChangedEventArgs e)
    {
        if (sender is not System.Windows.Controls.ScrollViewer scrollViewer) return;

        if (e.ExtentHeightChange == 0)
        {
            _autoScroll = scrollViewer.VerticalOffset >= scrollViewer.ScrollableHeight - 8;
        }
        else if (_autoScroll && e.ExtentHeightChange > 0)
        {
            scrollViewer.ScrollToBottom();
        }
    }
}
