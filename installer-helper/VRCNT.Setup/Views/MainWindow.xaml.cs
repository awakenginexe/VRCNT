using System.ComponentModel;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Animation;

namespace VRCNT.Setup.Views;

public partial class MainWindow : Window
{
    private readonly InstallerViewModel _viewModel;
    private InstallerPage _previousPage = InstallerPage.Welcome;

    public MainWindow(InstallerViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        DataContext = viewModel;
        viewModel.CloseRequested += (_, _) => Close();
        viewModel.PropertyChanged += ViewModel_PropertyChanged;
        Loaded += MainWindow_Loaded;
    }

    private void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        AnimatePageTransition(_viewModel.CurrentPage, isForward: true);
    }

    private void ViewModel_PropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(InstallerViewModel.CurrentPage))
        {
            var newPage = _viewModel.CurrentPage;
            var isForward = newPage >= _previousPage;
            _previousPage = newPage;
            Dispatcher.BeginInvoke(() => AnimatePageTransition(newPage, isForward));
        }
    }

    private FrameworkElement? GetPageElement(InstallerPage page) => page switch
    {
        InstallerPage.Welcome => Welcome,
        InstallerPage.Language => LanguageStep,
        InstallerPage.Runtime => RuntimeSelection,
        InstallerPage.Options => Options,
        InstallerPage.Progress => Progress,
        InstallerPage.Error => Error,
        InstallerPage.Complete => Complete,
        _ => null,
    };

    private void AnimatePageTransition(InstallerPage page, bool isForward)
    {
        if (_viewModel.UseReducedMotion) return;

        var target = GetPageElement(page);
        if (target == null) return;

        try
        {
            double startX = isForward ? 48.0 : -48.0;
            var translate = new TranslateTransform(startX, 0.0);
            target.RenderTransform = translate;
            target.Opacity = 0.0;

            var storyboard = new Storyboard();

            var slideAnim = new DoubleAnimation
            {
                From = startX,
                To = 0.0,
                Duration = TimeSpan.FromMilliseconds(280),
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
            };
            Storyboard.SetTarget(slideAnim, target);
            Storyboard.SetTargetProperty(slideAnim, new PropertyPath("RenderTransform.(TranslateTransform.X)"));

            var fadeAnim = new DoubleAnimation
            {
                From = 0.0,
                To = 1.0,
                Duration = TimeSpan.FromMilliseconds(240),
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
            };
            Storyboard.SetTarget(fadeAnim, target);
            Storyboard.SetTargetProperty(fadeAnim, new PropertyPath(UIElement.OpacityProperty));

            storyboard.Children.Add(slideAnim);
            storyboard.Children.Add(fadeAnim);
            storyboard.Begin(target);
        }
        catch
        {
            target.Opacity = 1.0;
        }
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
