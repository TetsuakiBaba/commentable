using System;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using Windows.Devices.Enumeration;

namespace Commentable;

// ========== カメラ設定 ==========
sealed class CameraSettingsWindow : Window
{
    private readonly ListBox list = new() { Height = 110 };
    private readonly ContentControl devicesArea = new();
    private readonly Image preview = new() { Stretch = Stretch.Uniform };
    private readonly TextBlock previewMessage = new()
    {
        Text = "カメラを選択するとプレビューが表示されます", Foreground = Brushes.Gray,
        HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.Wrap,
    };
    private readonly Button save = new() { Content = "設定を保存", IsDefault = true, IsEnabled = false, Padding = new Thickness(12, 4, 12, 4), MinWidth = 88 };
    // 選んだカメラのプレビュー（設定画面専用）
    private readonly CameraController previewCamera = new() { ShowsErrors = false };

    public CameraSettingsWindow()
    {
        Title = "カメラ設定";
        Width = 600;
        Height = 520;
        ResizeMode = ResizeMode.NoResize;
        Topmost = true;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Icon = AppResources.Image("icon.app.png");

        var root = new DockPanel { Margin = new Thickness(24) };
        var heading = new StackPanel();
        heading.Children.Add(new TextBlock { Text = "カメラ設定", FontSize = 22, FontWeight = FontWeights.Bold, Margin = new Thickness(0, 0, 0, 12) });
        heading.Children.Add(new TextBlock { Text = "利用可能なカメラデバイス", FontWeight = FontWeights.Bold, Margin = new Thickness(0, 0, 0, 6) });
        devicesArea.Content = new TextBlock { Text = "カメラデバイスを読み込み中..." };
        heading.Children.Add(devicesArea);
        heading.Children.Add(new TextBlock { Text = "プレビュー", FontWeight = FontWeights.Bold, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 16, 0, 6) });
        DockPanel.SetDock(heading, Dock.Top);
        root.Children.Add(heading);

        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 16, 0, 0) };
        var cancel = new Button { Content = "キャンセル", IsCancel = true, Padding = new Thickness(12, 4, 12, 4), MinWidth = 88, Margin = new Thickness(8, 0, 0, 0) };
        save.Click += (_, _) =>
        {
            CameraSettings.DeviceID = (list.SelectedItem as ListBoxItem)?.Tag as string;
            Dialogs.Message("カメラ設定を保存しました");
            Close();
        };
        cancel.Click += (_, _) => Close();
        buttons.Children.Add(save);
        buttons.Children.Add(cancel);
        DockPanel.SetDock(buttons, Dock.Bottom);
        root.Children.Add(buttons);

        var previewArea = new Grid();
        previewArea.Children.Add(new Border { Background = new SolidColorBrush(Color.FromArgb(0x0f, 0, 0, 0)), CornerRadius = new CornerRadius(8) });
        previewArea.Children.Add(previewMessage);
        previewArea.Children.Add(preview);
        root.Children.Add(previewArea);
        Content = root;

        previewCamera.OnFrame = image => preview.Source = image;
        previewCamera.OnError = message =>
        {
            previewMessage.Text = message;
            previewMessage.Foreground = Brushes.Red;
        };
        list.SelectionChanged += (_, _) => SelectionChanged();
        Loaded += async (_, _) =>
        {
            Activate();
            try
            {
                var devices = await CameraSettings.AvailableDevices();
                ShowDevices(devices.ToArray());
            }
            catch (Exception e)
            {
                devicesArea.Content = new TextBlock { Text = $"カメラの一覧を取得できませんでした: {e.Message}", Foreground = Brushes.Red, TextWrapping = TextWrapping.Wrap };
            }
        };
        // プレビューのカメラを止める
        Closed += (_, _) => previewCamera.Stop();
    }

    private void ShowDevices(DeviceInformation[] devices)
    {
        if (devices.Length == 0)
        {
            devicesArea.Content = new TextBlock { Text = "カメラが見つかりませんでした" };
            return;
        }
        foreach (var device in devices)
        {
            list.Items.Add(new ListBoxItem { Content = device.Name, Tag = device.Id, Padding = new Thickness(4, 3, 4, 3) });
        }
        devicesArea.Content = list;
        var saved = CameraSettings.DeviceID;
        list.SelectedItem = list.Items.OfType<ListBoxItem>().FirstOrDefault(item => (string)item.Tag == saved);
    }

    private void SelectionChanged()
    {
        var deviceID = (list.SelectedItem as ListBoxItem)?.Tag as string;
        save.IsEnabled = deviceID != null;
        previewMessage.Text = "カメラを選択するとプレビューが表示されます";
        previewMessage.Foreground = Brushes.Gray;
        if (deviceID != null) previewCamera.Start(deviceID); else previewCamera.Stop();
    }
}

// ========== About ==========
sealed class AboutWindow : Window
{
    public AboutWindow()
    {
        Title = "About Commentable";
        Width = 300;
        Height = 300;
        ResizeMode = ResizeMode.NoResize;
        Topmost = true;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Icon = AppResources.Image("icon.app.png");

        var root = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(24) };
        root.Children.Add(new Image { Source = AppResources.Image("icon.app.png"), Width = 96, Height = 96 });
        root.Children.Add(new TextBlock { Text = "Commentable", FontSize = 26, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 8, 0, 4) });
        root.Children.Add(Caption($"Version {AppConfig.Version}（Windows ネイティブ版）"));
        var link = new Hyperlink(new Run(AppConfig.Homepage)) { NavigateUri = new Uri(AppConfig.Homepage) };
        link.RequestNavigate += (_, e) => Shell.Open(e.Uri.AbsoluteUri);
        root.Children.Add(new TextBlock(link) { FontSize = 11, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 4, 0, 4) });
        root.Children.Add(Caption($"© {AppConfig.CopyrightYear} Tetsuaki Baba"));
        Content = root;
        Loaded += (_, _) => Activate();
    }

    private static TextBlock Caption(string text) =>
        new() { Text = text, FontSize = 11, Foreground = Brushes.Gray, HorizontalAlignment = HorizontalAlignment.Center };
}
