using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace Commentable;

// ========== アンケート ==========
// 集計はアプリで保持する（集計ウィンドウを閉じても結果が残る）
sealed class SurveyManager
{
    public sealed class Survey
    {
        public required string Id { get; init; }
        public required string Question { get; init; }
        public required List<string> Choices { get; init; }
        public required bool Multiple { get; init; }
        public required int[] Counts { get; init; }
        public HashSet<string> Voters { get; } = new();
        public bool Active { get; set; } = true;

        public int Respondents => Voters.Count;

        // サーバーに送る形
        public JsonObject Payload => new()
        {
            ["id"] = Id,
            ["question"] = Question,
            ["choices"] = new JsonArray(Choices.Select(choice => (JsonNode?)JsonValue.Create(choice)).ToArray()),
            ["multiple"] = Multiple,
        };
    }

    public Survey? Current { get; private set; }
    public event Action? Changed;

    // サーバーへの中継（配信画面の接続を使う）
    public Action<Survey>? OnStart { get; set; }
    public Action<Survey>? OnEnd { get; set; }

    // 再接続時に配信し直すため
    public Survey? ActiveSurvey => Current is { Active: true } ? Current : null;

    // 質問と選択肢が足りなければエラーの文を返す
    public string? Start(string question, IEnumerable<string> choices, bool multiple)
    {
        question = question.Trim();
        var list = choices.Select(choice => choice.Trim()).Where(choice => choice.Length > 0).ToList();
        if (question.Length == 0 || list.Count < 2) return "質問と2つ以上の選択肢を入力してください。";
        End();
        var survey = new Survey
        {
            Id = Guid.NewGuid().ToString(),
            Question = question,
            Choices = list,
            Multiple = multiple,
            Counts = new int[list.Count],
        };
        Current = survey;
        OnStart?.Invoke(survey);
        Changed?.Invoke();
        return null;
    }

    public void End()
    {
        if (Current is not { Active: true } survey) return;
        survey.Active = false;
        OnEnd?.Invoke(survey);
        Changed?.Invoke();
    }

    // 回答を集計（サーバーでも重複は弾いているが念のためここでも確認）
    public void Record(JsonNode? data)
    {
        if (Current is not { Active: true } survey || data is not JsonObject answer || SocketIOClient.String(answer["id"]) != survey.Id) return;
        var voterID = answer["voterId"] is { } voter ? SocketIOClient.Describe(voter) : Guid.NewGuid().ToString();
        if (!survey.Voters.Add(voterID)) return;
        if (answer["choices"] is JsonArray choices)
        {
            foreach (var choice in choices)
            {
                if (SocketIOClient.Number(choice) is { } number && number == Math.Floor(number) && number >= 0 && number < survey.Counts.Length)
                {
                    survey.Counts[(int)number]++;
                }
            }
        }
        Changed?.Invoke();
    }
}

// アンケート作成・集計ウィンドウ
sealed class SurveyWindow : Window
{
    private const int MaxChoices = 20;

    private readonly SurveyManager manager;
    private bool editing;
    private readonly StackPanel content = new() { Margin = new Thickness(24) };

    // 作成画面の入力（ウィンドウを閉じても残す）
    private readonly TextBox question = new()
    {
        AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, Height = 56, Padding = new Thickness(4),
        VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
    };
    private readonly List<TextBox> choices = new();
    private readonly CheckBox multiple = new() { Content = "複数選択を許可する", Margin = new Thickness(0, 4, 0, 0) };
    private readonly StackPanel choiceRows = new();
    private string? error;

    public SurveyWindow(SurveyManager manager)
    {
        this.manager = manager;
        Title = "アンケート";
        Width = 560;
        Height = 640;
        MinWidth = 480;
        MinHeight = 520;
        Topmost = true;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Icon = AppResources.Image("icon.app.png");
        Content = new ScrollViewer { Content = content, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };

        for (var i = 0; i < 3; i++) choices.Add(MakeChoiceBox(""));
        // 開いたときに実施中・前回のアンケートがあれば結果を表示
        editing = manager.Current == null;
        manager.Changed += () =>
        {
            if (!editing) Render();
        };
        Render();

        // 閉じても作り直さずに隠しておく（集計中の結果・入力中の内容を残す）
        Closing += (_, e) =>
        {
            if (Program.IsShuttingDown) return;
            e.Cancel = true;
            Hide();
        };
    }

    public void Present()
    {
        Show();
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
    }

    private void Render()
    {
        content.Children.Clear();
        if (editing) RenderEdit(); else RenderResult();
    }

    private static TextBlock Heading(string text) => new() { Text = text, FontSize = 22, FontWeight = FontWeights.Bold, Margin = new Thickness(0, 0, 0, 16) };
    private static TextBlock Label(string text) => new() { Text = text, FontWeight = FontWeights.Bold, Margin = new Thickness(0, 8, 0, 6) };

    private static Button MakeButton(string text, Action action)
    {
        var button = new Button { Content = text, Padding = new Thickness(12, 4, 12, 4), MinWidth = 80 };
        button.Click += (_, _) => action();
        return button;
    }

    // ========== 作成画面 ==========
    private void RenderEdit()
    {
        content.Children.Add(Heading("アンケート作成"));
        content.Children.Add(Label("質問"));
        content.Children.Add(question);
        content.Children.Add(new TextBlock { Text = "例：今日の授業の理解度は？", Foreground = Brushes.Gray, FontSize = 11, Margin = new Thickness(0, 4, 0, 8) });

        content.Children.Add(Label("選択肢"));
        content.Children.Add(choiceRows);
        RenderChoiceRows();
        var add = MakeButton("＋ 選択肢を追加", () => AddChoice());
        add.HorizontalAlignment = HorizontalAlignment.Left;
        add.Margin = new Thickness(0, 4, 0, 12);
        add.IsEnabled = choices.Count < MaxChoices;
        content.Children.Add(add);

        content.Children.Add(multiple);

        if (error != null)
        {
            content.Children.Add(new TextBlock { Text = error, Foreground = Brushes.Red, Margin = new Thickness(0, 12, 0, 0) });
        }

        var buttons = new DockPanel { Margin = new Thickness(0, 16, 0, 0), LastChildFill = false };
        if (manager.Current != null)
        {
            var previous = MakeButton("前回の結果を見る", () =>
            {
                editing = false;
                Render();
            });
            DockPanel.SetDock(previous, Dock.Left);
            buttons.Children.Add(previous);
        }
        var start = MakeButton("アンケート開始", StartSurvey);
        start.IsDefault = true;
        DockPanel.SetDock(start, Dock.Right);
        buttons.Children.Add(start);
        content.Children.Add(buttons);
    }

    private void RenderChoiceRows()
    {
        choiceRows.Children.Clear();
        for (var i = 0; i < choices.Count; i++)
        {
            var box = choices[i];
            box.Tag = $"選択肢 {i + 1}";
            box.Background = PlaceholderBrush(box);
            var remove = MakeButton("×", () => RemoveChoice(box));
            remove.MinWidth = 32;
            remove.Padding = new Thickness(8, 2, 8, 2);
            remove.ToolTip = "削除";
            remove.Margin = new Thickness(6, 0, 0, 0);
            var row = new DockPanel { Margin = new Thickness(0, 0, 0, 6) };
            DockPanel.SetDock(remove, Dock.Right);
            row.Children.Add(remove);
            if (box.Parent is Panel parent) parent.Children.Remove(box);
            row.Children.Add(box);
            choiceRows.Children.Add(row);
        }
    }

    private TextBox MakeChoiceBox(string text)
    {
        var box = new TextBox { Text = text, Padding = new Thickness(4, 3, 4, 3) };
        // 入力欄が空のときは「選択肢 1」などを薄く表示する
        box.Background = PlaceholderBrush(box);
        box.TextChanged += (_, _) => box.Background = PlaceholderBrush(box);
        // Enter で次の選択肢へ（最後なら追加）
        box.PreviewKeyDown += (_, e) =>
        {
            if (e.Key != Key.Enter) return;
            e.Handled = true;
            var index = choices.IndexOf(box);
            if (index >= 0 && index + 1 < choices.Count) choices[index + 1].Focus();
            else AddChoice();
        };
        return box;
    }

    private static Brush PlaceholderBrush(TextBox box)
    {
        if (box.Text.Length > 0 || box.Tag is not string placeholder) return Brushes.White;
        return new VisualBrush(new TextBlock { Text = placeholder, Foreground = Brushes.Gray, Margin = new Thickness(5, 0, 0, 0) })
        {
            AlignmentX = AlignmentX.Left, AlignmentY = AlignmentY.Center, Stretch = Stretch.None,
        };
    }

    private void AddChoice()
    {
        if (choices.Count >= MaxChoices) return;
        var box = MakeChoiceBox("");
        choices.Add(box);
        Render();
        box.Focus();
    }

    private void RemoveChoice(TextBox box)
    {
        if (choices.Count > 2)
        {
            choices.Remove(box);
            Render();
        }
        else
        {
            box.Text = "";
        }
    }

    private void StartSurvey()
    {
        error = manager.Start(question.Text, choices.Select(box => box.Text), multiple.IsChecked == true);
        if (error == null) editing = false;
        Render();
    }

    // ========== 結果画面 ==========
    private void RenderResult()
    {
        if (manager.Current is not { } survey) return;
        var header = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 12) };
        var heading = Heading("アンケート結果");
        heading.Margin = new Thickness(0);
        header.Children.Add(heading);
        header.Children.Add(new Border
        {
            Background = survey.Active ? Brushes.SeaGreen : Brushes.Gray,
            CornerRadius = new CornerRadius(4),
            Padding = new Thickness(8, 2, 8, 2),
            Margin = new Thickness(12, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center,
            Child = new TextBlock { Text = survey.Active ? "実施中" : "終了", Foreground = Brushes.White, FontWeight = FontWeights.Bold, FontSize = 11 },
        });
        content.Children.Add(header);
        content.Children.Add(new TextBox
        {
            Text = survey.Question, FontSize = 16, FontWeight = FontWeights.Bold, IsReadOnly = true, BorderThickness = new Thickness(0),
            Background = Brushes.Transparent, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 8),
        });

        var respondents = new TextBlock { Margin = new Thickness(0, 0, 0, 12) };
        respondents.Inlines.Add(new System.Windows.Documents.Run("回答者数：") { Foreground = Brushes.Gray });
        respondents.Inlines.Add(new System.Windows.Documents.Run($"{survey.Respondents}") { FontSize = 16, FontWeight = FontWeights.Bold });
        respondents.Inlines.Add(new System.Windows.Documents.Run(" 人") { Foreground = Brushes.Gray });
        content.Children.Add(respondents);

        for (var i = 0; i < survey.Choices.Count; i++)
        {
            var count = survey.Counts[i];
            var percent = survey.Respondents > 0 ? (int)Math.Round((double)count / survey.Respondents * 100, MidpointRounding.AwayFromZero) : 0;
            var row = new DockPanel { Margin = new Thickness(0, 8, 0, 4) };
            var votes = new TextBlock { Text = $"{count} 票（{percent}%）", FontWeight = FontWeights.Bold };
            DockPanel.SetDock(votes, Dock.Right);
            row.Children.Add(votes);
            row.Children.Add(new TextBlock { Text = survey.Choices[i], TextWrapping = TextWrapping.Wrap });
            content.Children.Add(row);

            var bar = new Grid { Height = 28 };
            bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(percent, 0.0001), GridUnitType.Star) });
            bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(100 - percent, 0.0001), GridUnitType.Star) });
            var track = new Border { Background = new SolidColorBrush(Color.FromArgb(0x26, 0x80, 0x80, 0x80)), CornerRadius = new CornerRadius(6) };
            Grid.SetColumnSpan(track, 2);
            bar.Children.Add(track);
            bar.Children.Add(new Border { Background = SystemColors.HighlightBrush, CornerRadius = new CornerRadius(6) });
            content.Children.Add(bar);
        }

        var buttons = new DockPanel { Margin = new Thickness(0, 24, 0, 0), LastChildFill = false };
        var create = MakeButton("新しいアンケートを作成", NewSurvey);
        DockPanel.SetDock(create, Dock.Left);
        buttons.Children.Add(create);
        if (survey.Active)
        {
            var end = MakeButton("アンケート終了", () =>
            {
                if (Dialogs.Confirm("アンケートを終了しますか？", "参加者の回答画面は閉じられます。", ok: "終了")) manager.End();
            });
            DockPanel.SetDock(end, Dock.Right);
            buttons.Children.Add(end);
        }
        content.Children.Add(buttons);
    }

    private void NewSurvey()
    {
        if (manager.Current is not { } survey) return;
        if (survey.Active)
        {
            if (!Dialogs.Confirm("実施中のアンケートを終了して、新しいアンケートを作成しますか？", ok: "終了して作成")) return;
            manager.End();
        }
        // 前回の内容を下書きにする
        question.Text = survey.Question;
        choices.Clear();
        foreach (var choice in survey.Choices) choices.Add(MakeChoiceBox(choice));
        multiple.IsChecked = survey.Multiple;
        error = null;
        editing = true;
        Render();
    }
}
