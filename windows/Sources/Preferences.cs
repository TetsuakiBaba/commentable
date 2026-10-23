using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Commentable;

// Windows 版だけで使う設定（macOS 版の UserDefaults に相当）
// %APPDATA%\commentable-desktop\windows-settings.json に保存する
// （Electron 版と共有する app-settings.json・鍵のファイルとは別）
static class Preferences
{
    // AppConfig の初期化中にも呼ばれるので、場所はその都度求める
    private static string File => Path.Combine(AppConfig.SharedDataDirectory, "windows-settings.json");
    private static JsonObject? values;

    private static JsonObject Values
    {
        get
        {
            if (values != null) return values;
            try
            {
                values = JsonNode.Parse(System.IO.File.ReadAllText(File)) as JsonObject;
            }
            catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
            {
            }
            return values ??= new JsonObject();
        }
    }

    public static string? GetString(string key) =>
        Values[key] is JsonValue value && value.TryGetValue(out string? text) ? text : null;

    public static bool GetBool(string key) =>
        Values[key] is JsonValue value && value.TryGetValue(out bool flag) && flag;

    public static double GetDouble(string key) =>
        Values[key] is JsonValue value && value.TryGetValue(out double number) ? number : 0;

    public static void Set(string key, string? value) => Save(key, value is null ? null : JsonValue.Create(value));
    public static void Set(string key, bool value) => Save(key, JsonValue.Create(value));
    public static void Set(string key, double value) => Save(key, JsonValue.Create(value));

    private static void Save(string key, JsonNode? value)
    {
        if (value is null) Values.Remove(key); else Values[key] = value;
        try
        {
            Directory.CreateDirectory(AppConfig.SharedDataDirectory);
            System.IO.File.WriteAllText(File, Values.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Log.Write($"Error saving preferences: {e.Message}");
        }
    }
}
