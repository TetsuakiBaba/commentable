using System;
using System.Collections.Generic;
using Icon = System.Drawing.Icon;
using SystemIcons = System.Drawing.SystemIcons;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using Forms = System.Windows.Forms;

namespace Commentable;

// アプリ本体（Electron 版の main.js、macOS 版の AppDelegate に相当）
// 透明なオーバーレイのウィンドウ、タスクトレイのメニュー、入室・配信者の鍵の管理を行う
sealed class AppController(string[] args)
{
    private OverlayWindow window = null!;
    private OverlayGroup overlay = null!; // 画面全体のオーバーレイ（Main）と共有用ウィンドウ
    private Forms.NotifyIcon? trayIcon;
    private Forms.ContextMenuStrip? trayMenu;
    private GlobalHotKey? hotKey;

    private RoomSession? session;
    private string? room;
    private string? hostKey; // 入室中の部屋の鍵
    private bool handlingJoinRejection;

    private readonly SoundPlayer sounds = new();
    private readonly SurveyManager surveys = new();
    private readonly LogArchiver archiver = new();
    private readonly CameraController camera = new();
    private readonly UpdateChecker updateChecker = new();
    private bool cameraEnabled; // 起動時は常に OFF（メニューから ON にする）

    // メニューの状態
    private QRPosition qrPosition = QRPosition.TopRight;
    private bool commentControl;
    private bool clock;
    private string? displayName; // 表示するディスプレイ（Screen.DeviceName）

    private SurveyWindow? surveyWindow;
    private CameraSettingsWindow? cameraSettingsWindow;
    private AboutWindow? aboutWindow;
    private WindowPickerWindow? sharePickerWindow;
    private ShareWindowController? shareWindow;

    // ========== 起動 ==========
    public void Start()
    {
        CreateWindow();

        hotKey = new GlobalHotKey(SendClipboardToCodeSnippet);

        surveys.OnStart = survey => session?.SurveyStarted(survey);
        surveys.OnEnd = survey => session?.SurveyEnded(survey);
        camera.OnFrame = image => overlay.SetCameraFrame(image);

        // ディスプレイ構成やタスクバーの位置が変わったらウィンドウを合わせる
        Microsoft.Win32.SystemEvents.DisplaySettingsChanged += (_, _) => window.Dispatcher.BeginInvoke(AdjustWindowToCurrentDisplay);
        SystemParameters.StaticPropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(SystemParameters.WorkArea)) window.Dispatcher.BeginInvoke(AdjustWindowToCurrentDisplay);
        };

        Dispatcher.CurrentDispatcher.BeginInvoke(() =>
        {
            // --room <部屋名> で起動したときは入室のダイアログを出さない
            if ((Argument("--room")?.Trim() is { Length: > 0 } argument ? argument : Dialogs.AskRoomName()) is not { } name)
            {
                Log.Write("user cancelled");
                Program.Quit();
                return;
            }
            EnterRoom(name);
        });
    }

    private string? Argument(string name)
    {
        var index = Array.IndexOf(args, name);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }

    public void Terminate()
    {
        session?.Stop();
        camera.Stop();
        hotKey?.Dispose();
        if (trayIcon != null) trayIcon.Visible = false; // 終了後にアイコンが残らないように
        trayIcon?.Dispose();
        updateChecker.ApplicationWillTerminate(); // 「あとで」を選んだアップデートを入れ替える
    }

    // 部屋に入ったらオーバーレイ表示を開始する
    private void EnterRoom(string name)
    {
        if (EnsureHostKey(name) is not { } key)
        {
            Program.Quit();
            return;
        }
        session?.Stop();
        overlay.ClearComments();
        overlay.SetAdminMessage(false, "");

        room = name;
        hostKey = key;
        var newSession = new RoomSession(name, key, overlay, sounds, surveys, archiver);
        newSession.OnJoinRejected = reason => window.Dispatcher.BeginInvoke(() => HandleJoinRejected(reason));
        session = newSession;
        newSession.Start();

        overlay.SetQR(qrPosition, QRText());
        window.Show();
        AdjustWindowToCurrentDisplay();
        SetupTrayIcon();
        if (args.Contains("--update-now"))
        {
            // 新しいバージョンがあれば確認なしで入れ替えて再起動する（動作確認用）
            updateChecker.Check(manual: true, installImmediately: true);
        }
        else
        {
            updateChecker.CheckInBackground();
        }
        OpenShareWindowFromArguments();
    }

    // --share <アプリ名> で起動したときは、そのアプリのウィンドウの共有用ウィンドウを開く（開発・確認用）
    private void OpenShareWindowFromArguments()
    {
        if (Argument("--share") is not { } appName) return;
        if (ShareTarget.Find(appName) is { } target) OpenShareWindow(target);
        else Log.Write($"Share window: no window of {appName}");
    }

    // ========== メインウィンドウ ==========
    private void CreateWindow()
    {
        overlay = new OverlayGroup(new OverlayView());
        window = new OverlayWindow(overlay.Main);
        displayName = Forms.Screen.PrimaryScreen?.DeviceName;
    }

    // ディスプレイの作業領域（タスクバーを除く）いっぱいに合わせる
    private void MoveWindow(Forms.Screen screen)
    {
        displayName = screen.DeviceName;
        window.MoveTo(screen.WorkingArea);
    }

    private void AdjustWindowToCurrentDisplay()
    {
        var screen = Forms.Screen.AllScreens.FirstOrDefault(s => s.DeviceName == displayName) ?? Forms.Screen.PrimaryScreen;
        if (screen != null && window.IsVisible) MoveWindow(screen);
    }

    // ========== 配信者の鍵 ==========
    // 入室前に鍵を用意する。保存場所が見つからなければ、どうするかを尋ねる（終了を選んだら null）
    private static string? EnsureHostKey(string name)
    {
        while (true)
        {
            try
            {
                return HostKeyStore.Key(name);
            }
            catch (HostKeyStore.DirectoryMissingException error)
            {
                var response = Dialogs.Message("配信者の鍵の保存場所が見つかりません",
                    $"{error.Path}\n\nDropbox や OneDrive の同期が終わっているか確認してください。",
                    ["再試行", "保存場所を変更...", "既定の場所に戻す", "終了"], DialogStyle.Warning);
                switch (response)
                {
                    case 1: HostKeyStore.ChooseDirectory(); break;
                    case 2: HostKeyStore.Move(null); break;
                    case 3: return null;
                }
            }
            catch (Exception error) when (error is System.IO.IOException or UnauthorizedAccessException)
            {
                Log.Write($"Error preparing host key: {error.Message}");
                Dialogs.Message("配信者の鍵を用意できませんでした", error.Message, style: DialogStyle.Critical);
                return null;
            }
        }
    }

    // 鍵の保存場所を変えたら、入室中の部屋の鍵（ダッシュボードのトークン）も合わせる
    private void ApplyMovedKeys(Dictionary<string, string>? keys)
    {
        if (room != null && keys != null && keys.TryGetValue(room, out var key)) hostKey = key;
    }

    // サーバーに配信画面としての入室を断られた（同じ部屋名を別の配信者が使用中）
    private void HandleJoinRejected(string? reason)
    {
        if (handlingJoinRejection || room is not { } current) return;
        handlingJoinRejection = true;
        try
        {
            var detail = reason == "host_taken"
                ? "この部屋名は、別の配信者のアプリが使用しています。別の部屋名で入室してください。\n\n自分の別の Mac / PC で使っていた部屋なら、メニュー「配信者の鍵」で、そちらと同じ保存場所（Dropbox など）を選んでから入り直してください。"
                : $"サーバーに入室を断られました（{reason ?? "unknown"}）。";
            var response = Dialogs.Message($"部屋「{current}」には入室できません", detail,
                ["別の部屋名で入室", "鍵の保存場所を変更して入り直す", "終了"], DialogStyle.Warning);
            if (response == 1)
            {
                HostKeyStore.ChooseDirectory();
                EnterRoom(current);
                return;
            }
            if (response != 0)
            {
                Program.Quit();
                return;
            }
            if (Dialogs.AskRoomName() is not { } newRoom)
            {
                Program.Quit();
                return;
            }
            EnterRoom(newRoom);
        }
        finally
        {
            handlingJoinRejection = false;
        }
    }

    // ========== URL ==========
    private string PostPageURL() => $"{AppConfig.ServerURL}/?room={UriEncoding.EncodeURIComponent(room ?? "")}&v={AppConfig.Version}";

    private string QRText() => $"{AppConfig.ServerURL}/?room={UriEncoding.EncodeURI(room ?? "")}&v={AppConfig.Version}";

    // ダッシュボードの URL（トークンは # 以降に付けるのでサーバーのアクセスログには残らない）
    private string? DashboardURL()
    {
        if (room == null || hostKey == null) return null;
        return $"{AppConfig.ServerURL}/dashboard/?room={UriEncoding.EncodeURIComponent(room)}&v={AppConfig.Version}#token={HostKeyStore.DashboardToken(hostKey)}";
    }

    private static void Open(string? url)
    {
        if (url != null) Shell.Open(url);
    }

    // ========== 操作 ==========
    private void SendClipboardToCodeSnippet()
    {
        try
        {
            if (!Clipboard.ContainsText()) return;
            session?.SendCodeSnippet(Clipboard.GetText());
        }
        catch (System.Runtime.InteropServices.COMException e)
        {
            Log.Write($"Cannot read clipboard: {e.Message}"); // 他のアプリがクリップボードを使っているとき
        }
    }

    private void ToggleCamera(bool enabled)
    {
        if (!enabled)
        {
            camera.Stop();
            return;
        }
        if (CameraSettings.DeviceID is { } deviceID)
        {
            ApplyCameraDisplaySettings();
            camera.Start(deviceID);
        }
        else
        {
            // デバイスが選ばれていなければ設定画面を開く
            OpenCameraSettings();
        }
    }

    // 保存済みの表示位置・サイズを画面に反映
    private void ApplyCameraDisplaySettings()
    {
        overlay.CameraPosition = CameraSettings.Position;
        overlay.CameraScale = CameraSettings.Scale(CameraSettings.Size);
    }

    private void OpenCameraSettings()
    {
        cameraSettingsWindow?.Close();
        var settings = new CameraSettingsWindow();
        // 閉じたときにカメラが ON なら選び直したカメラで再起動
        settings.Closed += (_, _) =>
        {
            if (cameraSettingsWindow == settings) cameraSettingsWindow = null;
            if (cameraEnabled && CameraSettings.DeviceID is { } deviceID)
            {
                ApplyCameraDisplaySettings();
                camera.Start(deviceID);
            }
        };
        cameraSettingsWindow = settings;
        settings.Show();
    }

    private void OpenSurveyWindow()
    {
        surveyWindow ??= new SurveyWindow(surveys);
        surveyWindow.Present();
    }

    // ========== 共有用ウィンドウ ==========
    private void OpenSharePicker()
    {
        sharePickerWindow?.Close();
        WindowPickerWindow? picker = null;
        picker = new WindowPickerWindow(target =>
        {
            picker?.Close();
            OpenShareWindow(target);
        });
        picker.Closed += (_, _) =>
        {
            if (sharePickerWindow == picker) sharePickerWindow = null;
        };
        sharePickerWindow = picker;
        picker.Show();
    }

    private void OpenShareWindow(ShareTarget target)
    {
        shareWindow?.Close();
        var controller = new ShareWindowController(target, overlay);
        controller.OnClose = () =>
        {
            if (shareWindow == controller) shareWindow = null;
        };
        shareWindow = controller;
        controller.Start(); // 共有用ウィンドウは対象のウィンドウの後ろに置くので、前面には出さない
    }

    private IEnumerable<Forms.ToolStripItem> BuildShareMenu()
    {
        yield return Item("ウィンドウを選んで開く...", OpenSharePicker);
        if (shareWindow is { } controller)
        {
            yield return new Forms.ToolStripSeparator();
            yield return Disabled($"共有中: {controller.TargetDescription}");
            yield return Disabled("Zoom などで「Commentable 共有用」のウィンドウを共有してください");
            yield return Item("共有用ウィンドウでの共有をやめる", controller.Close);
        }
    }

    private void OpenAboutWindow()
    {
        if (aboutWindow == null)
        {
            aboutWindow = new AboutWindow();
            aboutWindow.Closed += (_, _) => aboutWindow = null;
        }
        aboutWindow.Show();
        aboutWindow.Activate();
    }

    // ========== タスクトレイ ==========
    private void SetupTrayIcon()
    {
        if (trayIcon != null) return;
        trayMenu = new Forms.ContextMenuStrip { ShowCheckMargin = true, ShowImageMargin = false };
        trayMenu.Items.Add("..."); // 空のメニューは開かないので仮の項目を入れておく
        // メニューは開くたびに作り直す（ディスプレイ一覧や設定を最新にする）
        trayMenu.Opening += (_, _) =>
        {
            trayMenu.Items.Clear();
            trayMenu.Items.AddRange(BuildTrayMenu().ToArray());
        };
        // オーバーレイはメニューより手前に表示されることがあるので、メニューを開いている間は QR コードを隠す
        trayMenu.Opened += (_, _) => overlay.Main.SetQRSuppressed(true);
        trayMenu.Closed += (_, _) => overlay.Main.SetQRSuppressed(false);

        using var iconStream = AppResources.Stream("icon.ico");
        trayIcon = new Forms.NotifyIcon
        {
            Icon = iconStream != null ? new Icon(iconStream, Forms.SystemInformation.SmallIconSize) : SystemIcons.Application,
            Text = "commentable-desktop",
            ContextMenuStrip = trayMenu,
            Visible = true,
        };
        // 左クリックでもメニューを開く（Electron 版と同じ）
        trayIcon.MouseUp += (_, e) =>
        {
            if (e.Button == Forms.MouseButtons.Left)
            {
                typeof(Forms.NotifyIcon).GetMethod("ShowContextMenu", BindingFlags.Instance | BindingFlags.NonPublic)?.Invoke(trayIcon, null);
            }
        };
    }

    private IEnumerable<Forms.ToolStripItem> BuildTrayMenu()
    {
        yield return Item("投稿ページを開く", () => Open(PostPageURL()));
        yield return Item("投稿ページURLをコピー", () =>
        {
            try
            {
                Clipboard.SetText(PostPageURL());
            }
            catch (System.Runtime.InteropServices.COMException e)
            {
                Log.Write($"Cannot write clipboard: {e.Message}");
            }
        });
        yield return new Forms.ToolStripSeparator();
        yield return Submenu("表示ディスプレイ選択", BuildDisplayMenu());
        // アプリのウィンドウだけを共有するとき用（Zoom などで共有用ウィンドウを選んでもらう）
        yield return Submenu("共有用ウィンドウ（アプリの共有）", BuildShareMenu());
        yield return Disabled($"サーバー: {AppConfig.ServerURL}");
        yield return new Forms.ToolStripSeparator();

        (string Label, QRPosition Value)[] qrItems = [("非表示", QRPosition.None), ("QR Code [CENTER]", QRPosition.Center), ("QR Code [TOP RIGHT]", QRPosition.TopRight)];
        yield return Submenu("QR Code表示", qrItems.Select(item => Item(item.Label, () =>
        {
            qrPosition = item.Value;
            overlay.SetQR(item.Value, QRText());
        }, qrPosition == item.Value)));
        yield return new Forms.ToolStripSeparator();

        yield return Item("投稿制限解除", () =>
        {
            commentControl = !commentControl;
            session?.SetCommentControl(commentControl);
        }, commentControl);
        yield return Item("サウンドコメントのミュート", () => sounds.IsMuted = !sounds.IsMuted, sounds.IsMuted);
        yield return Item("時刻表示", () =>
        {
            clock = !clock;
            overlay.SetClock(clock);
        }, clock);
        var clipboard = Item("クリップボード内容を配布資料欄に送信", SendClipboardToCodeSnippet);
        clipboard.ShortcutKeyDisplayString = "Ctrl+Alt+V";
        yield return clipboard;
        yield return Item("アンケート...", OpenSurveyWindow);
        yield return Item("授業ログのフォルダを開く", LogArchiver.OpenFolder);
        yield return Submenu("配信者の鍵", BuildHostKeyMenu());
        yield return Item("ダッシュボード", () => Open(DashboardURL()));
        // 授業ログはブラウザ内で読み込むので、トークンは渡さない
        yield return Item("授業参画度", () => Open($"{AppConfig.ServerURL}/engagement/"));
        yield return Submenu("カメラ", BuildCameraMenu());
        yield return new Forms.ToolStripSeparator();
        if (updateChecker.Ready is { } ready)
        {
            yield return Item($"再起動して {ready.Version} に更新", () => updateChecker.Check(manual: true, installImmediately: true));
        }
        else
        {
            yield return Item("アップデートを確認...", () => updateChecker.Check(manual: true));
        }
        yield return Item("About", OpenAboutWindow);
        yield return Item("Quit", Program.Quit);
    }

    private IEnumerable<Forms.ToolStripItem> BuildDisplayMenu() =>
        Forms.Screen.AllScreens.Select(screen =>
        {
            var bounds = screen.Bounds;
            var scale = Native.ScaleForPoint(bounds.Left + bounds.Width / 2, bounds.Top + bounds.Height / 2);
            var name = screen.DeviceName.TrimStart('\\', '.');
            var label = $"{name}{(screen.Primary ? "（メイン）" : "")} [{bounds.X}, {bounds.Y}] {bounds.Width}x{bounds.Height} (Scale: {scale.ToString(CultureInfo.InvariantCulture)})";
            return (Forms.ToolStripItem)Item(label, () => MoveWindow(screen), screen.DeviceName == displayName);
        });

    private IEnumerable<Forms.ToolStripItem> BuildHostKeyMenu()
    {
        var dir = HostKeyStore.KeysDirectory;
        yield return Disabled($"保存場所: {dir ?? "既定（このアプリのデータフォルダ）"}");
        yield return new Forms.ToolStripSeparator();
        yield return Item("保存場所を変更...", () => ApplyMovedKeys(HostKeyStore.ChooseDirectory()));
        var reset = Item("既定の場所に戻す", () => ApplyMovedKeys(HostKeyStore.Move(null)));
        reset.Enabled = dir != null;
        yield return reset;
        yield return Item("保存場所を開く", HostKeyStore.RevealKeysFile);
    }

    private IEnumerable<Forms.ToolStripItem> BuildCameraMenu()
    {
        (string Label, CameraPosition Value)[] positions =
        [
            ("左上", CameraPosition.TopLeft), ("右上", CameraPosition.TopRight), ("左下", CameraPosition.BottomLeft),
            ("右下", CameraPosition.BottomRight), ("中央", CameraPosition.Center),
        ];
        yield return Item("カメラON/OFF", () =>
        {
            cameraEnabled = !cameraEnabled;
            ToggleCamera(cameraEnabled);
        }, cameraEnabled);
        yield return new Forms.ToolStripSeparator();
        yield return Item("カメラ設定...", OpenCameraSettings);
        yield return new Forms.ToolStripSeparator();
        yield return Submenu("表示位置", positions.Select(position => Item(position.Label, () =>
        {
            CameraSettings.Position = position.Value;
            overlay.CameraPosition = position.Value;
        }, CameraSettings.Position == position.Value)));
        yield return Submenu("サイズ", CameraSettings.Sizes.Select(size => Item(size.Label, () =>
        {
            CameraSettings.Size = size.Value;
            overlay.CameraScale = size.Scale;
        }, CameraSettings.Size == size.Value)));
    }

    // クリックで動くメニュー項目（メニューが閉じてから動かす）
    private static Forms.ToolStripMenuItem Item(string title, Action action, bool isChecked = false)
    {
        var item = new Forms.ToolStripMenuItem(title) { Checked = isChecked };
        item.Click += (_, _) => Dispatcher.CurrentDispatcher.BeginInvoke(action);
        return item;
    }

    private static Forms.ToolStripMenuItem Submenu(string title, IEnumerable<Forms.ToolStripItem> items)
    {
        var item = new Forms.ToolStripMenuItem(title);
        item.DropDownItems.AddRange(items.ToArray());
        if (item.DropDown is Forms.ToolStripDropDownMenu menu)
        {
            menu.ShowCheckMargin = true;
            menu.ShowImageMargin = false;
        }
        return item;
    }

    private static Forms.ToolStripMenuItem Disabled(string title) => new(title) { Enabled = false };
}

// 画面全体を覆う透明なウィンドウ（マウス操作は下のアプリに通す・最前面・タスクバーや Alt+Tab に出さない）
sealed class OverlayWindow : Window
{
    private IntPtr hwnd;
    private readonly DispatcherTimer topmostTimer = new() { Interval = TimeSpan.FromSeconds(2) };

    public OverlayWindow(OverlayView view)
    {
        Title = "commentable-desktop";
        WindowStyle = WindowStyle.None;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = false;
        ShowActivated = false;
        Topmost = true;
        Focusable = false;
        WindowStartupLocation = WindowStartupLocation.Manual;
        Left = 0;
        Top = 0;
        Width = 1;
        Height = 1;
        Content = view;

        SourceInitialized += (_, _) =>
        {
            hwnd = new WindowInteropHelper(this).Handle;
            Native.AddExStyle(hwnd, Native.WS_EX_TRANSPARENT | Native.WS_EX_LAYERED | Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE);
        };
        // ほかのアプリが最前面に出てきても、コメントが隠れないように最前面に戻す
        topmostTimer.Tick += (_, _) =>
        {
            if (hwnd != IntPtr.Zero && IsVisible)
            {
                Native.SetWindowPos(hwnd, Native.HWND_TOPMOST, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
            }
        };
        topmostTimer.Start();
    }

    // 作業領域（物理ピクセル）に合わせる
    // 倍率の違うディスプレイに移すと、倍率に合わせて大きさが変わるので、もう一度合わせる
    public void MoveTo(System.Drawing.Rectangle area)
    {
        if (hwnd == IntPtr.Zero) return;
        for (var i = 0; i < 2; i++)
        {
            Native.SetWindowPos(hwnd, Native.HWND_TOPMOST, area.X, area.Y, area.Width, area.Height, Native.SWP_NOACTIVATE);
        }
    }
}
