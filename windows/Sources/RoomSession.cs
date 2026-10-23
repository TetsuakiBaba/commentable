using System;
using System.Globalization;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Windows.Media;

namespace Commentable;

// 部屋への接続（Electron 版の sketch.js の通信部分に相当）
// サーバーから届いたコメントをオーバーレイに表示し、アンケート・授業ログを中継する
sealed partial class RoomSession
{
    public string Room { get; }
    private readonly string hostKey;
    private readonly SocketIOClient socket;
    private readonly OverlayGroup overlay; // 画面全体のオーバーレイと共有用ウィンドウ
    private readonly SoundPlayer sounds;
    private readonly SurveyManager surveys;
    private readonly LogArchiver archiver;

    // 同じ部屋名を別の配信者のアプリが使用している（なりすまし防止）
    public Action<string?>? OnJoinRejected { get; set; }

    public RoomSession(string room, string hostKey, OverlayGroup overlay, SoundPlayer sounds, SurveyManager surveys, LogArchiver archiver)
    {
        Room = room;
        this.hostKey = hostKey;
        this.overlay = overlay;
        this.sounds = sounds;
        this.surveys = surveys;
        this.archiver = archiver;
        socket = new SocketIOClient(AppConfig.ServerURL);
        SetupListeners();
    }

    public void Start()
    {
        Log.Write($"Connecting to socket server: {AppConfig.ServerURL}");
        socket.Connect();
    }

    public void Stop() => socket.Disconnect();

    private void SetupListeners()
    {
        socket.On("connect", _ => Log.Write("Successfully connected to server"));
        socket.On("connect_error", error => Log.Write($"Connection error: {SocketIOClient.Describe(error)}"));
        socket.On("disconnect", reason => Log.Write($"Disconnected from server: {SocketIOClient.Describe(reason)}"));

        socket.On("you_are_connected", _ =>
        {
            // 部屋名を指定してジョインする
            socket.Emit("join", Room, new JsonObject { ["role"] = "overlay", ["hostKey"] = hostKey });
            // 実施中のアンケートがあれば再接続後に配信し直す（回答者のブラウザ側で重複表示はされない）
            if (surveys.ActiveSurvey is { } survey) socket.Emit("survey start", survey.Payload);
        });

        socket.On("join rejected", data =>
        {
            Log.Write($"Join rejected: {SocketIOClient.Describe(data)}");
            socket.Disconnect(); // 再接続のたびに断られ続けないように止める
            OnJoinRejected?.Invoke(SocketIOClient.String(data?["reason"]));
        });

        socket.On("login", _ =>
        {
            Log.Write($"you have been connected to {Room}");
            // 授業ログを購読して、この PC にも保存する（サーバーのログが消えても残るように）
            socket.Emit("log watch");
        });

        socket.On("log snapshot", events =>
        {
            if (events is JsonArray { Count: > 0 } array) archiver.Archive(array.ToList());
        });

        socket.On("log event", @event =>
        {
            if (@event != null) archiver.Archive([@event]);
        });

        socket.On("comment", data =>
        {
            if (data is JsonObject comment) NewComment(comment);
        });

        // 管理者メッセージ（ダッシュボードの「メッセージ表示」カードから）
        socket.On("admin message", data =>
        {
            var message = data as JsonObject;
            var show = message?["show"] is JsonValue value && value.TryGetValue(out bool flag) && flag;
            var text = message?["text"] is { } node ? SocketIOClient.Describe(node) : "";
            overlay.SetAdminMessage(show, text);
        });

        // アンケートの回答を集計へ
        socket.On("survey answer", data => surveys.Record(data));
    }

    // ========== 配信者からの操作 ==========
    public void SurveyStarted(SurveyManager.Survey survey) => socket.Emit("survey start", survey.Payload);

    public void SurveyEnded(SurveyManager.Survey survey) => socket.Emit("survey end", new JsonObject { ["id"] = survey.Id });

    public void SetCommentControl(bool unrestricted) =>
        socket.Emit("deactivate_comment_control", new JsonObject { ["key"] = "dummy", ["control"] = unrestricted });

    // クリップボードの内容を参加者の配布資料欄に送る
    public void SendCodeSnippet(string text)
    {
        var data = new JsonObject
        {
            ["room_name"] = Room,
            ["my_name"] = "管理人",
            ["comment"] = text,
            ["flg_speech"] = false,
            ["color_text"] = "#000000",
            ["color_text_stroke"] = "#ffffff",
            ["flg_image"] = false,
            ["id_image"] = 0,
            ["flg_sound"] = false,
            ["id_sound"] = false,
            ["hidden"] = 100,
            ["origin"] = "host",
        };
        socket.Emit("comment", data);
        NewComment(data);
        overlay.ShowNotification("資料スペースにクリップボードの内容を送信しました。");
    }

    // ========== コメント ==========
    private void NewComment(JsonObject data)
    {
        var comment = SocketIOClient.String(data["comment"]) ?? "";
        var fill = TextImage.ParseHex(SocketIOClient.String(data["color_text"])) ?? Colors.White;
        var stroke = TextImage.ParseHex(SocketIOClient.String(data["color_text_stroke"])) ?? Colors.Black;

        // コメントコマンド（= で始まる場合）
        if (comment.StartsWith('=') && ExecuteCommentCommand(comment, fill, stroke))
        {
            Log.Write($"Comment command processed: {comment}");
            return;
        }

        var hidden = SocketIOClient.Number(data["hidden"]);
        if (hidden == 0)
        {
            // 隠しコマンド
            sounds.Play("protofessional.mp3", sounds.Volume);
            overlay.ShowProtofessional(comment);
            return;
        }

        // 通常のコメント
        if (comment.Length == 0) return;
        if (hidden >= 1) return; // 隠しコマンド（1以上）は表示しない

        // 表示に空きがあれば
        if (!overlay.AddComment(comment, SocketIOClient.String(data["text_direction"]), SocketIOClient.String(data["font_size"]), fill, stroke)) return;

        var flgSound = SocketIOClient.Bool(data["flg_sound"]);
        var soundID = SocketIOClient.Number(data["id_sound"]) is { } id ? (int?)(int)id : null;
        if (flgSound && soundID == 0) // camera
        {
            overlay.Flash();
        }
        if (flgSound && soundID is { } sound && !sounds.IsMuted)
        {
            sounds.PlayComment(sound);
        }
        if (SocketIOClient.Bool(data["flg_speech"]) && !flgSound && !SocketIOClient.Bool(data["flg_emoji"]) && !sounds.IsMuted)
        {
            sounds.Speak(comment);
        }
    }

    [GeneratedRegex(@"([A-Za-z0-9_]+)\(([^)]*)\)")]
    private static partial Regex CommandPattern();

    // =text("文字", 0.5, 0.5) の形式。許可された関数だけ実行する
    private bool ExecuteCommentCommand(string command, Color fill, Color stroke)
    {
        var match = CommandPattern().Match(command[1..]);
        if (!match.Success)
        {
            Log.Write($"Invalid comment command format: {command}");
            return false;
        }
        var name = match.Groups[1].Value;
        var args = match.Groups[2].Value.Trim().Split(',').Select(arg => arg.Trim()).ToArray();

        if (name != "text")
        {
            Log.Write($"Command not allowed: {name}");
            return false;
        }
        if (args.Length >= 3
            && double.TryParse(args[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var x)
            && double.TryParse(args[2], NumberStyles.Float, CultureInfo.InvariantCulture, out var y))
        {
            var text = args[0].Replace("\"", "").Replace("'", "");
            overlay.AddTextCommand(text, x, y, fill, stroke);
        }
        return true;
    }
}
