using System;
using System.Linq;
using System.Media;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Forms = System.Windows.Forms;

namespace Commentable;

enum DialogStyle { Informational, Warning, Critical }

// ダイアログ（macOS 版の NSAlert に相当。ボタンの名前を自由に付けられる TaskDialog を使う）
static class Dialogs
{
    // 押されたボタンの番号（0 始まり）
    public static int Message(string title, string detail = "", string[]? buttons = null, DialogStyle style = DialogStyle.Informational)
    {
        buttons ??= ["OK"];
        var page = new Forms.TaskDialogPage
        {
            Caption = "Commentable",
            Heading = title,
            Text = detail,
            Icon = style switch
            {
                DialogStyle.Warning => Forms.TaskDialogIcon.Warning,
                DialogStyle.Critical => Forms.TaskDialogIcon.Error,
                _ => Forms.TaskDialogIcon.Information,
            },
            AllowCancel = false,
            SizeToContent = true,
        };
        var dialogButtons = buttons.Select(label => new Forms.TaskDialogButton(label)).ToList();
        foreach (var button in dialogButtons) page.Buttons.Add(button);
        // アプリが前面にないときにも見えるように、最前面に出す
        page.Created += (_, _) =>
        {
            if (page.BoundDialog is { } dialog) Native.BringToFront(dialog.Handle);
        };
        var result = Forms.TaskDialog.ShowDialog(page, Forms.TaskDialogStartupLocation.CenterScreen);
        return Math.Max(0, dialogButtons.IndexOf(result));
    }

    public static bool Confirm(string title, string detail = "", string ok = "OK") =>
        Message(title, detail, [ok, "キャンセル"], DialogStyle.Warning) == 0;

    // 部屋名を入力してもらう（キャンセルなら null）
    public static string? AskRoomName()
    {
        var window = new RoomNameWindow(GenerateRoomName());
        return window.ShowDialog() == true ? window.Room : null;
    }

    // 配信者の重複入室を防ぐので、他の人と重なりにくいように番号を付ける
    public static string GenerateRoomName()
    {
        string[] name1 = ["computer", "design", "art", "human", "410", "interface", "tmu"];
        string[] name2 = ["room", "class", "conference", "event", "area", "place"];
        static string Capitalized(string text) => char.ToUpperInvariant(text[0]) + text[1..];
        return $"{Capitalized(name1[Random.Shared.Next(name1.Length)])}_{Capitalized(name2[Random.Shared.Next(name2.Length)])}_{Random.Shared.Next(100, 1000)}";
    }
}

// 入室のダイアログ
sealed class RoomNameWindow : Window
{
    private readonly TextBox field;
    public string Room { get; private set; } = "";

    public RoomNameWindow(string initial)
    {
        Title = "Commentable";
        SizeToContent = SizeToContent.WidthAndHeight;
        ResizeMode = ResizeMode.NoResize;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Topmost = true;
        Icon = AppResources.Image("icon.app.png");

        field = new TextBox { Text = initial, Width = 300, Padding = new Thickness(4, 3, 4, 3), FontSize = 14 };
        var enter = new Button { Content = "入室", IsDefault = true, MinWidth = 88, Padding = new Thickness(12, 4, 12, 4) };
        var cancel = new Button { Content = "やめる", IsCancel = true, MinWidth = 88, Padding = new Thickness(12, 4, 12, 4), Margin = new Thickness(8, 0, 0, 0) };
        enter.Click += (_, _) =>
        {
            var room = field.Text.Trim();
            if (room.Length == 0)
            {
                SystemSounds.Beep.Play();
                return;
            }
            Room = room;
            DialogResult = true;
        };

        var text = new StackPanel { Margin = new Thickness(16, 0, 0, 0) };
        text.Children.Add(new TextBlock { Text = "Commentable", FontSize = 16, FontWeight = FontWeights.Bold });
        text.Children.Add(new TextBlock { Text = "部屋名を入力して入室してください", Margin = new Thickness(0, 4, 0, 10) });
        text.Children.Add(field);
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 16, 0, 0) };
        buttons.Children.Add(enter);
        buttons.Children.Add(cancel);
        text.Children.Add(buttons);

        var root = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(20) };
        root.Children.Add(new Image { Source = AppResources.Image("icon.app.png"), Width = 64, Height = 64, VerticalAlignment = VerticalAlignment.Top });
        root.Children.Add(text);
        Content = root;

        Loaded += (_, _) =>
        {
            Native.BringToFront(new System.Windows.Interop.WindowInteropHelper(this).Handle);
            Activate();
            field.Focus();
            field.SelectAll();
            Keyboard.Focus(field);
        };
    }
}
