using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Commentable;

// ========== 授業ログの保存 ==========
// サーバーの授業ログは保持期間を過ぎると消えるので、配信中に受け取ったものをこの PC にも保存する
// 保存先: ドキュメント\Commentable\logs\<部屋キー>\<授業回ID>.jsonl（サーバーと同じ形式）
sealed partial class LogArchiver
{
    private readonly Dictionary<string, HashSet<string>> archivedEventIDs = new(StringComparer.OrdinalIgnoreCase); // ファイル → 保存済みの event_id

    // .NET の \d は全角などの数字にも、$ は末尾の改行の前にも一致するので、半角の数字と文字列の終わり（\z）で確かめる
    [GeneratedRegex(@"^[0-9]{8}-[0-9]{6}\z")]
    private static partial Regex SessionPattern();

    // サーバーの event-log.js と同じ規則で部屋名からフォルダ名を作る
    public static string RoomKey(string room)
    {
        // JavaScript の正規表現と同じく UTF-16 の単位で置き換える
        var safe = new string(room.Select(c => char.IsAsciiLetterOrDigit(c) || c == '_' || c == '-' ? c : '_').Take(40).ToArray());
        if (safe == room) return safe;
        var hash = Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(room))).ToLowerInvariant();
        return $"{safe}_{hash[..8]}";
    }

    public void Archive(IEnumerable<JsonNode?> events)
    {
        foreach (var node in events)
        {
            if (node is not JsonObject @event
                || SocketIOClient.String(@event["room"]) is not { } room
                || SocketIOClient.String(@event["session_id"]) is not { } sessionID
                || !SessionPattern().IsMatch(sessionID)) continue;
            var dir = Path.Combine(AppConfig.LogArchiveDirectory, RoomKey(room));
            var file = Path.Combine(dir, $"{sessionID}.jsonl");
            var eventID = SocketIOClient.Describe(@event["event_id"]);

            if (!archivedEventIDs.TryGetValue(file, out var ids)) ids = LoadEventIDs(file);
            if (ids.Contains(eventID)) continue;
            try
            {
                Directory.CreateDirectory(dir);
                File.AppendAllText(file, @event.ToJsonString(SocketIOClient.JsonOptions) + "\n", new UTF8Encoding(false));
                ids.Add(eventID);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                Log.Write($"Error archiving log event: {e.Message}");
            }
            archivedEventIDs[file] = ids;
        }
    }

    // 既存のファイルに保存済みのものは書かない（再接続で同じログが届くため）
    private static HashSet<string> LoadEventIDs(string file)
    {
        var ids = new HashSet<string>();
        try
        {
            foreach (var line in File.ReadLines(file))
            {
                try
                {
                    if (JsonNode.Parse(line) is JsonObject json && json["event_id"] is { } id) ids.Add(SocketIOClient.Describe(id));
                }
                catch (JsonException)
                {
                }
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
        }
        return ids;
    }

    public static void OpenFolder()
    {
        try
        {
            Directory.CreateDirectory(AppConfig.LogArchiveDirectory);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
        }
        Shell.Open(AppConfig.LogArchiveDirectory);
    }
}
