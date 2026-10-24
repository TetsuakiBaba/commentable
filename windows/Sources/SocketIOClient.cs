using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.WebSockets;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Threading;

namespace Commentable;

// Socket.IO v4（Engine.IO v4）の最小限のクライアント
// WebSocket だけで接続し、イベントの送受信・ping への応答・自動再接続を行う
// （ack とバイナリのイベントは配信画面では使わないので扱わない）
// イベントはすべて UI スレッドで呼ばれる
sealed class SocketIOClient
{
    public static readonly JsonSerializerOptions JsonOptions = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    private readonly Uri endpoint;
    private readonly Dictionary<string, List<Action<JsonNode?>>> handlers = new();
    private ClientWebSocket? socket;
    private readonly SemaphoreSlim sendLock = new(1, 1);

    private bool shouldReconnect = true;
    private int reconnectAttempts;
    private readonly DispatcherTimer reconnectTimer = new();
    private readonly DispatcherTimer heartbeatTimer = new();
    private TimeSpan pingInterval = TimeSpan.FromSeconds(25);
    private TimeSpan pingTimeout = TimeSpan.FromSeconds(20);

    public bool IsConnected { get; private set; }

    public SocketIOClient(string serverURL)
    {
        if (!Uri.TryCreate(serverURL, UriKind.Absolute, out var server)) server = new Uri(AppConfig.ProductionServer);
        var builder = new UriBuilder(server)
        {
            Scheme = server.Scheme == "http" ? "ws" : "wss",
            Path = (server.AbsolutePath.EndsWith('/') ? server.AbsolutePath : server.AbsolutePath + "/") + "socket.io/",
            Query = "EIO=4&transport=websocket",
        };
        endpoint = builder.Uri;

        reconnectTimer.Tick += (_, _) =>
        {
            reconnectTimer.Stop();
            Open();
        };
        heartbeatTimer.Tick += (_, _) =>
        {
            heartbeatTimer.Stop();
            HandleClose(socket, "ping timeout");
        };
    }

    // ========== イベント ==========
    // 受け取るイベントの引数は1つだけ（配信画面で使うイベントはすべてそう）
    public void On(string name, Action<JsonNode?> handler)
    {
        if (!handlers.TryGetValue(name, out var list)) handlers[name] = list = new List<Action<JsonNode?>>();
        list.Add(handler);
    }

    public void Emit(string name, params JsonNode?[] items)
    {
        if (!IsConnected) return;
        var payload = new JsonArray { JsonValue.Create(name) };
        foreach (var item in items) payload.Add(item?.DeepClone());
        Send("42" + payload.ToJsonString(JsonOptions));
    }

    private void Fire(string name, JsonNode? argument = null)
    {
        if (!handlers.TryGetValue(name, out var list)) return;
        foreach (var handler in list.ToList())
        {
            // 1つのイベントの処理に失敗しても受信は止めない
            try
            {
                handler(argument);
            }
            catch (Exception e)
            {
                Log.Write($"[socket] error in '{name}' handler: {e}");
            }
        }
    }

    // ========== 接続 ==========
    public void Connect()
    {
        shouldReconnect = true;
        Open();
    }

    // 再接続もしない
    public void Disconnect()
    {
        shouldReconnect = false;
        reconnectTimer.Stop();
        heartbeatTimer.Stop();
        var current = socket;
        socket = null;
        if (current != null) _ = CloseAsync(current, IsConnected);
        if (IsConnected)
        {
            IsConnected = false;
            Fire("disconnect", "io client disconnect");
        }
    }

    // 切断を知らせてから閉じる
    private async Task CloseAsync(ClientWebSocket current, bool sayGoodbye)
    {
        try
        {
            if (sayGoodbye) await SendAsync(current, "41");
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            await current.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, null, timeout.Token);
        }
        catch (Exception e) when (e is WebSocketException or OperationCanceledException or ObjectDisposedException or InvalidOperationException)
        {
        }
        finally
        {
            current.Dispose();
        }
    }

    private void Open()
    {
        reconnectTimer.Stop();
        socket?.Abort();
        socket?.Dispose();
        var current = new ClientWebSocket();
        current.Options.KeepAliveInterval = TimeSpan.Zero; // 生存確認は Engine.IO の ping で行う
        socket = current;
        // ハンドシェイクが来なければ切って再接続
        ResetHeartbeat(TimeSpan.FromSeconds(20));
        _ = RunAsync(current);
    }

    private async Task RunAsync(ClientWebSocket current)
    {
        string reason;
        try
        {
            await current.ConnectAsync(endpoint, CancellationToken.None);
            reason = await ReceiveLoopAsync(current);
        }
        catch (Exception e) when (e is WebSocketException or IOException or OperationCanceledException or ObjectDisposedException or InvalidOperationException)
        {
            reason = e.Message;
        }
        catch (Exception e)
        {
            // 想定外の例外でも、受信が黙って止まらないように必ず切断して再接続する
            Log.Write($"[socket] unexpected error: {e}");
            reason = e.Message;
        }
        HandleClose(current, reason);
    }

    // 1つのメッセージの大きさの上限（授業ログのスナップショットは大きくなることがあるので macOS 版と同じ 64 MB）
    private const int MaxMessageSize = 64 * 1024 * 1024;

    private async Task<string> ReceiveLoopAsync(ClientWebSocket current)
    {
        var buffer = new byte[64 * 1024];
        using var message = new MemoryStream();
        while (current.State == WebSocketState.Open)
        {
            var result = await current.ReceiveAsync(buffer, CancellationToken.None);
            if (result.MessageType == WebSocketMessageType.Close) return "transport close";
            if (message.Length + result.Count > MaxMessageSize) return "message too large";
            message.Write(buffer, 0, result.Count);
            if (!result.EndOfMessage) continue;
            var isText = result.MessageType == WebSocketMessageType.Text;
            var text = isText ? Encoding.UTF8.GetString(message.GetBuffer(), 0, (int)message.Length) : null;
            message.SetLength(0);
            if (current != socket) return "replaced";
            if (text != null) HandleEnginePacket(text); // バイナリは使わない
        }
        return "transport close";
    }

    private void Send(string text)
    {
        if (socket is { } current) _ = SendAsync(current, text);
    }

    private async Task SendAsync(ClientWebSocket current, string text)
    {
        await sendLock.WaitAsync();
        try
        {
            await current.SendAsync(Encoding.UTF8.GetBytes(text), WebSocketMessageType.Text, true, CancellationToken.None);
        }
        catch (Exception e) when (e is WebSocketException or ObjectDisposedException or InvalidOperationException or OperationCanceledException)
        {
            Log.Write($"[socket] send error: {e.Message}");
        }
        finally
        {
            sendLock.Release();
        }
    }

    private void HandleClose(ClientWebSocket? closed, string reason)
    {
        if (closed == null || closed != socket) return; // 古い接続
        heartbeatTimer.Stop();
        socket = null;
        closed.Abort();
        closed.Dispose();
        var wasConnected = IsConnected;
        IsConnected = false;
        Fire(wasConnected ? "disconnect" : "connect_error", reason);
        ScheduleReconnect();
    }

    // socket.io クライアントと同じく 1 秒から 5 秒まで間隔を延ばしながら再接続する
    private void ScheduleReconnect()
    {
        if (!shouldReconnect) return;
        var baseDelay = Math.Min(Math.Pow(2, reconnectAttempts), 5.0);
        var delay = baseDelay * (0.5 + Random.Shared.NextDouble());
        reconnectAttempts++;
        reconnectTimer.Interval = TimeSpan.FromSeconds(delay);
        reconnectTimer.Start();
    }

    // サーバーの ping が途絶えたら切断とみなす
    private void ResetHeartbeat(TimeSpan? timeout = null)
    {
        heartbeatTimer.Stop();
        heartbeatTimer.Interval = timeout ?? pingInterval + pingTimeout;
        heartbeatTimer.Start();
    }

    // ========== パケット ==========
    private void HandleEnginePacket(string text)
    {
        if (text.Length == 0) return;
        var body = text[1..];
        switch (text[0])
        {
            case '0': // open
                if (ParseJSON(body) is JsonObject info)
                {
                    if (Number(info["pingInterval"]) is { } interval) pingInterval = TimeSpan.FromMilliseconds(interval);
                    if (Number(info["pingTimeout"]) is { } timeout) pingTimeout = TimeSpan.FromMilliseconds(timeout);
                }
                ResetHeartbeat();
                Send("40"); // 既定の名前空間に接続
                break;
            case '1': // close
                HandleClose(socket, "transport close");
                break;
            case '2': // ping
                Send("3");
                ResetHeartbeat();
                break;
            case '4': // message
                HandleSocketPacket(body);
                break;
        }
    }

    private void HandleSocketPacket(string text)
    {
        if (text.Length == 0) return;
        var body = text[1..];
        // 名前空間（"/nsp,"）は使わないが、付いていれば飛ばす
        if (body.StartsWith('/') && body.IndexOf(',') is var comma and >= 0) body = body[(comma + 1)..];
        switch (text[0])
        {
            case '0': // CONNECT
                IsConnected = true;
                reconnectAttempts = 0;
                Fire("connect");
                break;
            case '1': // DISCONNECT（サーバーから切られたときは再接続しない）
                shouldReconnect = false;
                HandleClose(socket, "io server disconnect");
                break;
            case '2': // EVENT
                // ack の ID（数字）が付いていれば飛ばす
                var json = body.TrimStart("0123456789".ToCharArray());
                if (ParseJSON(json) is JsonArray array && array.Count > 0 && array[0] is JsonValue name && name.TryGetValue(out string? eventName))
                {
                    var argument = array.Count > 1 ? array[1] : null;
                    array.Clear(); // 引数を配列から切り離して渡す
                    Fire(eventName, argument);
                }
                break;
            case '4': // CONNECT_ERROR
                Log.Write($"[socket] connect error: {body}");
                break;
        }
    }

    private static JsonNode? ParseJSON(string text)
    {
        try
        {
            return JsonNode.Parse(text);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    // ========== JSON の値を JavaScript の比較と同じように読む ==========
    // 有限でない値（NaN・Infinity・1e999 など）は null
    public static double? Number(JsonNode? node)
    {
        if (node is not JsonValue value) return null;
        double? number = value.GetValueKind() switch
        {
            JsonValueKind.Number => value.TryGetValue(out double parsed) ? parsed : null,
            JsonValueKind.True => 1,
            JsonValueKind.False => 0,
            JsonValueKind.String => double.TryParse(value.GetValue<string>(), System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out var parsed) ? parsed : null,
            _ => null,
        };
        return number is { } n && double.IsFinite(n) ? n : null;
    }

    public static bool Bool(JsonNode? node)
    {
        if (node is not JsonValue value) return false;
        return value.GetValueKind() switch
        {
            JsonValueKind.Number => !value.TryGetValue(out double number) || number != 0, // 読めないほど大きい数も 0 ではない
            JsonValueKind.True => true,
            JsonValueKind.String => value.GetValue<string>().Length > 0,
            _ => false,
        };
    }

    public static string? String(JsonNode? node) =>
        node is JsonValue value && value.GetValueKind() == JsonValueKind.String ? value.GetValue<string>() : null;

    // Swift の "\(value)" と同じく、文字列はそのまま、それ以外は JSON の表記にする
    public static string Describe(JsonNode? node) => String(node) ?? node?.ToJsonString(JsonOptions) ?? "";
}
