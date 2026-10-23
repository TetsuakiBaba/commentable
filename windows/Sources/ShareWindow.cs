using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;

namespace Commentable;

// ========== 共有用ウィンドウ ==========
// Zoom などでアプリのウィンドウだけを共有すると、画面全体に重ねたコメントは映らない
// （共有されるのはそのウィンドウの中身だけ）。そこで対象のウィンドウ（例: PowerPoint）を
// Windows.Graphics.Capture で取り込み、その映像にコメントを重ねたウィンドウを作って、こちらを共有してもらう

// 共有できるウィンドウ
sealed record ShareTarget(IntPtr Handle, string AppName, string Title, bool OnScreen, int Width, int Height)
{
    public string Description => Title.Length == 0 ? AppName : $"{AppName}: {Title}";

    // 普通のウィンドウの一覧（タスクバーや Alt+Tab に出るもの）。見えているものを先に並べる
    public static List<ShareTarget> All()
    {
        var ownProcess = (uint)Environment.ProcessId;
        var appNames = new Dictionary<uint, string>();
        var targets = new List<ShareTarget>();
        Native.EnumWindows((hwnd, _) =>
        {
            if (Read(hwnd, ownProcess, appNames) is { } target) targets.Add(target);
            return true;
        }, IntPtr.Zero);
        return targets
            .OrderBy(t => t.OnScreen ? 0 : 1)
            .ThenBy(t => t.AppName, StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(t => t.Title, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
    }

    private static readonly HashSet<string> ShellClasses = ["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow"];

    private static ShareTarget? Read(IntPtr hwnd, uint ownProcess, Dictionary<uint, string> appNames)
    {
        if (!Native.IsWindowVisible(hwnd)) return null;
        Native.GetWindowThreadProcessId(hwnd, out var processId);
        if (processId == ownProcess) return null;
        var exStyle = Native.ExStyle(hwnd);
        var appWindow = (exStyle & Native.WS_EX_APPWINDOW) != 0;
        if (!appWindow && ((exStyle & Native.WS_EX_TOOLWINDOW) != 0 || Native.GetWindow(hwnd, Native.GW_OWNER) != IntPtr.Zero)) return null;
        if (ShellClasses.Contains(Native.ClassName(hwnd))) return null;
        var title = Native.WindowText(hwnd);
        // 別の仮想デスクトップにあるウィンドウ（全画面のスライドショーなど）も選べるようにする
        var cloaked = Native.Cloaked(hwnd);
        if (cloaked != 0 && (cloaked != Native.DWM_CLOAKED_SHELL || title.Length == 0)) return null;

        var minimized = Native.IsIconic(hwnd);
        Native.RECT bounds;
        if (minimized)
        {
            var placement = new Native.WINDOWPLACEMENT { length = System.Runtime.InteropServices.Marshal.SizeOf<Native.WINDOWPLACEMENT>() };
            Native.GetWindowPlacement(hwnd, ref placement);
            bounds = placement.rcNormalPosition;
        }
        else
        {
            bounds = Native.WindowBounds(hwnd);
        }
        if (bounds.Width < 160 || bounds.Height < 120) return null;

        if (!appNames.TryGetValue(processId, out var appName))
        {
            appName = DisplayName(processId);
            appNames[processId] = appName;
        }
        return new ShareTarget(hwnd, appName, title, !minimized && cloaked == 0, bounds.Width, bounds.Height);
    }

    // アプリの表示名（例: Microsoft PowerPoint）
    private static string DisplayName(uint processId)
    {
        var path = Native.ProcessImagePath(processId);
        if (path == null) return "";
        try
        {
            var description = FileVersionInfo.GetVersionInfo(path).FileDescription;
            if (!string.IsNullOrWhiteSpace(description)) return description.Trim();
        }
        catch (FileNotFoundException)
        {
        }
        return Path.GetFileNameWithoutExtension(path);
    }

    // --share <アプリ名> で起動したとき用（アプリの表示名か exe の名前）
    public static ShareTarget? Find(string appName) =>
        All().FirstOrDefault(t => t.OnScreen && (t.AppName.Equals(appName, StringComparison.OrdinalIgnoreCase)
            || ProcessName(t.Handle).Equals(appName, StringComparison.OrdinalIgnoreCase)));

    private static string ProcessName(IntPtr hwnd)
    {
        Native.GetWindowThreadProcessId(hwnd, out var processId);
        return Native.ProcessImagePath(processId) is { } path ? Path.GetFileNameWithoutExtension(path) : "";
    }
}

// ========== ウィンドウの選択 ==========
sealed class WindowPickerWindow : Window
{
    private readonly ListBox list = new();
    private readonly TextBlock error = new() { Foreground = Brushes.Red, TextWrapping = TextWrapping.Wrap, Visibility = Visibility.Collapsed };
    private readonly Button open = new() { Content = "共有用ウィンドウを開く", IsDefault = true, IsEnabled = false, Padding = new Thickness(12, 4, 12, 4), Margin = new Thickness(8, 0, 0, 0) };

    public WindowPickerWindow(Action<ShareTarget> onSelect)
    {
        Title = "共有用ウィンドウ";
        Width = 640;
        Height = 500;
        MinWidth = 560;
        MinHeight = 460;
        Topmost = true;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Icon = AppResources.Image("icon.app.png");

        var root = new DockPanel { Margin = new Thickness(20) };
        var header = new StackPanel();
        header.Children.Add(new TextBlock { Text = "共有用ウィンドウ", FontSize = 22, FontWeight = FontWeights.Bold, Margin = new Thickness(0, 0, 0, 12) });
        header.Children.Add(new TextBlock
        {
            Text = "コメントを重ねて共有したいウィンドウ（例: PowerPoint のスライドショー）を選んでください。選んだウィンドウにコメントを重ねた「Commentable 共有用」のウィンドウが、そのウィンドウの後ろに用意されます（画面には見えません）。Zoom などではこの「Commentable 共有用」のウィンドウを、アプリのウィンドウとして共有してください。配信者はいつもどおり、選んだウィンドウを操作してください。",
            TextWrapping = TextWrapping.Wrap,
            Foreground = Brushes.DimGray,
            Margin = new Thickness(0, 0, 0, 12),
        });
        header.Children.Add(error);
        DockPanel.SetDock(header, Dock.Top);
        root.Children.Add(header);

        var buttons = new DockPanel { Margin = new Thickness(0, 12, 0, 0), LastChildFill = false };
        var reload = new Button { Content = "再読み込み", Padding = new Thickness(12, 4, 12, 4) };
        var cancel = new Button { Content = "キャンセル", IsCancel = true, Padding = new Thickness(12, 4, 12, 4) };
        reload.Click += (_, _) => Reload();
        cancel.Click += (_, _) => Close();
        open.Click += (_, _) =>
        {
            if (list.SelectedItem is ListBoxItem { Tag: ShareTarget target }) onSelect(target);
        };
        DockPanel.SetDock(reload, Dock.Left);
        DockPanel.SetDock(open, Dock.Right);
        DockPanel.SetDock(cancel, Dock.Right);
        buttons.Children.Add(reload);
        buttons.Children.Add(open);
        buttons.Children.Add(cancel);
        DockPanel.SetDock(buttons, Dock.Bottom);
        root.Children.Add(buttons);

        root.Children.Add(list);
        Content = root;

        list.SelectionChanged += (_, _) => open.IsEnabled = list.SelectedItem != null;
        list.MouseDoubleClick += (_, _) =>
        {
            if (list.SelectedItem is ListBoxItem { Tag: ShareTarget target }) onSelect(target);
        };
        Loaded += (_, _) =>
        {
            Activate();
            Reload();
        };
    }

    private void Reload()
    {
        list.Items.Clear();
        try
        {
            foreach (var target in ShareTarget.All()) list.Items.Add(Row(target));
            error.Visibility = Visibility.Collapsed;
        }
        catch (Exception e)
        {
            error.Text = $"ウィンドウの一覧を取得できませんでした: {e.Message}";
            error.Visibility = Visibility.Visible;
        }
    }

    private static ListBoxItem Row(ShareTarget target)
    {
        var row = new DockPanel { LastChildFill = true };
        var size = new TextBlock { Text = $"{target.Width}×{target.Height}", FontSize = 11, Foreground = Brushes.Gray, Margin = new Thickness(8, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center };
        DockPanel.SetDock(size, Dock.Right);
        row.Children.Add(size);
        if (!target.OnScreen)
        {
            var hidden = new TextBlock { Text = "最小化・別のデスクトップ", FontSize = 11, Foreground = Brushes.Gray, Margin = new Thickness(8, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center };
            DockPanel.SetDock(hidden, Dock.Right);
            row.Children.Add(hidden);
        }
        var name = new TextBlock { Text = target.AppName, FontWeight = FontWeights.Bold, Margin = new Thickness(0, 0, 8, 0) };
        DockPanel.SetDock(name, Dock.Left);
        row.Children.Add(name);
        row.Children.Add(new TextBlock
        {
            Text = target.Title.Length == 0 ? "（タイトルなし）" : target.Title,
            Foreground = Brushes.DimGray,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        return new ListBoxItem { Content = row, Tag = target, Padding = new Thickness(6, 4, 6, 4) };
    }
}

// ========== 共有用ウィンドウ ==========
// 共有用ウィンドウは対象のウィンドウと同じ位置・同じ大きさにして、そのすぐ後ろに隠しておく
// （配信者はデスクトップ上に流れるコメントを見ながら対象のウィンドウをそのまま操作し、
//   Zoom などではこの共有用ウィンドウを共有してもらう）
// 隠れていても Windows.Graphics.Capture では中身を取り込める
sealed class ShareWindowController
{
    public Action? OnClose { get; set; }

    private readonly ShareTarget target;
    private readonly OverlayGroup overlays;
    private readonly Window window;
    private readonly Image captureImage = new() { Stretch = Stretch.Uniform };
    private readonly OverlayView overlay = new(hoverEnabled: false);
    private readonly WindowCapture capture;
    private readonly DispatcherTimer followTimer = new() { Interval = TimeSpan.FromSeconds(0.1) };
    private IntPtr hwnd;
    private DateTime lastOrderCheck = DateTime.MinValue;
    private bool closing;

    public string TargetDescription => target.Description;

    public ShareWindowController(ShareTarget target, OverlayGroup overlays)
    {
        this.target = target;
        this.overlays = overlays;
        capture = new WindowCapture(target.Handle);

        var content = new Grid { Background = Brushes.Black };
        content.Children.Add(captureImage);
        content.Children.Add(overlay);
        // Zoom の共有の一覧ではこのタイトルで表示される（タイトルバーはないので共有先には映らない）
        window = new Window
        {
            Title = $"Commentable 共有用 – {target.Description}",
            WindowStyle = WindowStyle.None,
            ResizeMode = ResizeMode.NoResize,
            Background = Brushes.Black,
            ShowActivated = false,
            ShowInTaskbar = true, // 共有の一覧に出るように、普通のウィンドウにしておく
            WindowStartupLocation = WindowStartupLocation.Manual,
            Icon = AppResources.Image("icon.app.png"),
            Content = content,
        };
        window.Closed += (_, _) => Closed();
        overlays.Attach(overlay);
    }

    // ========== 開始 ==========
    public void Start()
    {
        if (!WindowCapture.IsSupported)
        {
            Finish("この Windows ではウィンドウを取り込めません（Windows 10 バージョン 2004 以降が必要です）");
            return;
        }
        hwnd = new WindowInteropHelper(window).EnsureHandle();
        window.Show();
        Follow(force: true); // 表示されるより前に対象のウィンドウの後ろに置く

        capture.OnFrame = image => captureImage.Source = image;
        capture.OnClosed = () => Finish("対象のウィンドウが閉じられたので、共有用ウィンドウでの共有を終了しました");
        try
        {
            capture.Start();
        }
        catch (Exception e)
        {
            Finish($"ウィンドウを取り込めませんでした: {e.Message}");
            return;
        }

        // 対象のウィンドウの位置・大きさ・重なり順に合わせ続ける
        followTimer.Tick += (_, _) => Follow();
        followTimer.Start();
        overlays.ShowNotification("Zoom などで「Commentable 共有用」のウィンドウを共有してください");
    }

    // ========== 対象のウィンドウに合わせる ==========
    private void Follow(bool force = false)
    {
        if (closing) return;
        if (!Native.IsWindow(target.Handle))
        {
            Finish("対象のウィンドウが閉じられたので、共有用ウィンドウでの共有を終了しました");
            return;
        }
        var onScreen = Native.IsWindowVisible(target.Handle) && !Native.IsIconic(target.Handle) && Native.Cloaked(target.Handle) == 0;

        var moved = false;
        if (onScreen)
        {
            var bounds = Native.WindowBounds(target.Handle);
            Native.GetWindowRect(hwnd, out var current);
            if (bounds.Width > 0 && bounds.Height > 0 &&
                (bounds.Left != current.Left || bounds.Top != current.Top || bounds.Width != current.Width || bounds.Height != current.Height))
            {
                Native.SetWindowPos(hwnd, IntPtr.Zero, bounds.Left, bounds.Top, bounds.Width, bounds.Height, Native.SWP_NOZORDER | Native.SWP_NOACTIVATE);
                moved = true;
            }
        }

        // 対象のウィンドウのすぐ後ろに置く（見えていないとき＝最小化や別のデスクトップでは最背面に下げる）
        if (!force && !moved && DateTime.UtcNow - lastOrderCheck < TimeSpan.FromSeconds(0.5)) return;
        lastOrderCheck = DateTime.UtcNow;
        if (onScreen)
        {
            if (!IsDirectlyBelowTarget())
            {
                Native.SetWindowPos(hwnd, target.Handle, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE | Native.SWP_NOOWNERZORDER);
            }
        }
        else
        {
            // 見えていないと Zoom の共有の一覧に出ないので、閉じずに最背面に置く
            Native.SetWindowPos(hwnd, Native.HWND_BOTTOM, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE | Native.SWP_NOOWNERZORDER);
        }
    }

    // 対象のウィンドウのすぐ下（見えているウィンドウの中で）にあるか
    private bool IsDirectlyBelowTarget()
    {
        var next = Native.GetWindow(target.Handle, Native.GW_HWNDNEXT);
        while (next != IntPtr.Zero && next != hwnd && !Native.IsWindowVisible(next))
        {
            next = Native.GetWindow(next, Native.GW_HWNDNEXT);
        }
        return next == hwnd;
    }

    // ========== 終了 ==========
    // 共有用ウィンドウは見えないので、終わった理由はデスクトップの通知で知らせる
    private void Finish(string message)
    {
        if (closing) return;
        overlays.ShowNotification(message);
        Close();
    }

    private void Closed()
    {
        closing = true;
        followTimer.Stop();
        capture.Dispose();
        overlays.Detach(overlay);
        OnClose?.Invoke();
    }

    public void Close()
    {
        if (window.IsLoaded || window.IsVisible) window.Close();
        else if (!closing) Closed();
    }
}
