using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Commentable;

// ========== 配信者の鍵 ==========
// 部屋ごとに秘密の鍵を作って保存する。最初に入室したアプリの鍵がサーバーに登録され、
// 同じ部屋名で別のアプリ（なりすまし）が配信画面として入室することを防ぐ。
// ダッシュボードには鍵から作ったトークンを渡す（サーバーの room-auth.js と同じ式）
//
// 鍵のファイルは保存場所を変えられる。Dropbox や OneDrive の同じフォルダを選べば、
// 別の Mac / PC でも同じ鍵を使って同じ部屋で配信できる
// ファイルの形式と既定の場所は Electron 版と同じ
static class HostKeyStore
{
    public sealed class DirectoryMissingException(string path) : Exception(path)
    {
        public string Path { get; } = path;
    }

    private static readonly string AppSettingsFile = Path.Combine(AppConfig.SharedDataDirectory, "app-settings.json");
    private static readonly string DefaultKeysFile = Path.Combine(AppConfig.SharedDataDirectory, "host-keys.json");
    private const string SharedKeysFilename = "commentable-host-keys.json";

    // ========== アプリの設定（Electron 版と共有） ==========
    private static JsonObject LoadAppSettings()
    {
        try
        {
            return JsonNode.Parse(File.ReadAllText(AppSettingsFile)) as JsonObject ?? new JsonObject();
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
        {
            return new JsonObject();
        }
    }

    private static void SaveAppSettings(string key, string? value)
    {
        var settings = LoadAppSettings();
        settings[key] = value is null ? null : JsonValue.Create(value);
        try
        {
            Directory.CreateDirectory(AppConfig.SharedDataDirectory);
            File.WriteAllText(AppSettingsFile, settings.ToJsonString(new JsonSerializerOptions(SocketIOClient.JsonOptions) { WriteIndented = true }));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Log.Write($"Error saving app settings: {e.Message}");
        }
    }

    // 鍵の保存フォルダ（null なら既定の場所）
    public static string? KeysDirectory => SocketIOClient.String(LoadAppSettings()["hostKeysDir"]);

    public static string KeysFile(string? dir) => dir != null ? Path.Combine(dir, SharedKeysFilename) : DefaultKeysFile;
    public static string KeysFile() => KeysFile(KeysDirectory);

    private static Dictionary<string, string> ReadKeys(string file)
    {
        var keys = new Dictionary<string, string>();
        try
        {
            if (JsonNode.Parse(File.ReadAllText(file)) is JsonObject json)
            {
                foreach (var (room, key) in json)
                {
                    if (SocketIOClient.String(key) is { } text) keys[room] = text;
                }
            }
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
        {
        }
        return keys;
    }

    private static void WriteKeys(string file, Dictionary<string, string> keys)
    {
        var json = new JsonObject();
        foreach (var (room, key) in keys.OrderBy(pair => pair.Key, StringComparer.Ordinal)) json[room] = key;
        // 書きかけのファイルを読まれないように、別のファイルに書いてから置き換える
        var temp = file + ".tmp";
        File.WriteAllText(temp, json.ToJsonString(new JsonSerializerOptions(SocketIOClient.JsonOptions) { WriteIndented = true }));
        File.Move(temp, file, overwrite: true);
    }

    // 部屋の鍵を返す（なければ作る）。保存先のフォルダが見つからないときは例外を投げる
    // （同期前の共有フォルダで新しい鍵を作ると、自分の部屋に入れなくなるため）
    public static string Key(string room)
    {
        var dir = KeysDirectory;
        if (dir != null && !Directory.Exists(dir)) throw new DirectoryMissingException(dir);
        var file = KeysFile(dir);
        if (ReadKeys(file).TryGetValue(room, out var existing)) return existing;

        // 他の Mac / PC が同じファイルに書いている可能性があるので、書く直前に読み直して追記する
        var latest = ReadKeys(file);
        if (latest.TryGetValue(room, out existing)) return existing;
        var key = RandomKey();
        latest[room] = key;
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        WriteKeys(file, latest);
        return key;
    }

    // Node の crypto.randomBytes(32).toString('base64url') と同じ形式
    private static string RandomKey() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).Replace('+', '-').Replace('/', '_').TrimEnd('=');

    public static string DashboardToken(string hostKey) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"commentable-dashboard:{hostKey}"))).ToLowerInvariant();

    // 鍵を新しい保存場所に移す。両方に同じ部屋の鍵があるときは、移動先（共有フォルダ）の鍵を使う
    // 移した後の鍵の一覧を返す（失敗したら null）
    public static Dictionary<string, string>? Move(string? newDir)
    {
        var fromFile = KeysFile();
        var toFile = KeysFile(newDir);
        if (string.Equals(Path.GetFullPath(fromFile), Path.GetFullPath(toFile), StringComparison.OrdinalIgnoreCase)) return ReadKeys(toFile);
        var current = Directory.Exists(Path.GetDirectoryName(fromFile)) ? ReadKeys(fromFile) : new Dictionary<string, string>();
        var destination = ReadKeys(toFile);
        var conflicts = current.Keys
            .Where(room => destination.TryGetValue(room, out var dest) && dest != current[room])
            .OrderBy(room => room, StringComparer.Ordinal).ToList();
        var merged = new Dictionary<string, string>(current);
        foreach (var (room, key) in destination) merged[room] = key;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(toFile)!);
            WriteKeys(toFile, merged);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Dialogs.Message("鍵を保存できませんでした", e.Message, style: DialogStyle.Critical);
            return null;
        }
        SaveAppSettings("hostKeysDir", newDir);

        var detail = $"保存場所: {toFile}\n部屋の鍵: {merged.Count} 件";
        if (newDir != null)
        {
            detail += "\n\n別の Mac / PC でも同じフォルダを選ぶと、同じ部屋で配信できます。";
        }
        if (conflicts.Count > 0)
        {
            detail += "\n\n次の部屋は、移動先にあった鍵を使います（この PC で使っていた鍵とは別のものです）:\n" + string.Join("\n", conflicts);
        }
        Dialogs.Message("配信者の鍵の保存場所を変更しました", detail);
        return merged;
    }

    // フォルダを選んでもらって鍵を移す
    public static Dictionary<string, string>? ChooseDirectory()
    {
        var dialog = new Microsoft.Win32.OpenFolderDialog
        {
            Title = "配信者の鍵の保存場所を選択（Dropbox や OneDrive のフォルダを選ぶと、別の Mac / PC と鍵を共有できます）",
            Multiselect = false,
        };
        if (dialog.ShowDialog() != true || string.IsNullOrEmpty(dialog.FolderName)) return null;
        return Move(dialog.FolderName);
    }

    public static void RevealKeysFile()
    {
        var file = KeysFile();
        if (File.Exists(file))
        {
            Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{file}\"") { UseShellExecute = true });
        }
        else if (Path.GetDirectoryName(file) is { } dir && Directory.Exists(dir))
        {
            Shell.Open(dir);
        }
    }
}
