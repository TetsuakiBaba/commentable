using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;

namespace Commentable;

// アプリ全体の設定値
static class AppConfig
{
    public const string ProductionServer = "https://commentable.onrender.com";
    public const string LocalServer = "http://localhost:3000";

    // Electron 版と同じデータフォルダ（%APPDATA%\commentable-desktop）
    // 配信者の鍵を共有するので、Electron 版と Windows 版を切り替えても同じ部屋に入れる
    // （ServerURL を求めるときに Preferences が使うので、先に初期化する）
    public static readonly string SharedDataDirectory =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "commentable-desktop");

    // 授業ログの保存先: ドキュメント\Commentable\logs
    public static readonly string LogArchiveDirectory =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Commentable", "logs");

    // 接続先サーバー
    // 既定は本番環境。ローカルで試すときは環境変数か設定ファイル（Preferences）で切り替える
    //   set COMMENTABLE_SERVER_URL=http://localhost:3000
    public static readonly string ServerURL = ResolveServerURL();

    private static string ResolveServerURL()
    {
        var env = Environment.GetEnvironmentVariable("COMMENTABLE_SERVER_URL");
        if (!string.IsNullOrWhiteSpace(env)) return env.Trim().TrimEnd('/');
        var saved = Preferences.GetString("serverURL");
        if (!string.IsNullOrWhiteSpace(saved)) return saved.Trim().TrimEnd('/');
        return ProductionServer;
    }

    // バージョンは windows/VERSION で管理し、ビルド時に exe に書き込む（Commentable.csproj）
    public static readonly string Version =
        Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0";

    public static readonly string CopyrightYear = Metadata("CopyrightYear") ?? DateTime.Now.Year.ToString();

    // package.ps1 で作った配布用のビルドか（自動アップデートで自分を入れ替えるのはこのときだけ）
    public static readonly bool IsDistribution = Metadata("Distribution") == "true";

    private static string? Metadata(string key) =>
        Assembly.GetExecutingAssembly().GetCustomAttributes<AssemblyMetadataAttribute>().FirstOrDefault(a => a.Key == key)?.Value;

    public const string Homepage = "https://tetsuakibaba.github.io/commentable/";

    // リリースを置いている GitHub のリポジトリ
    public const string GithubRepository = "TetsuakiBaba/commentable";
    // Windows 版のリリースのタグ（macOS 版の v<バージョン> と重ならないようにする）
    public const string ReleaseTagPrefix = "windows-v";
    // Windows 版のリリースの添付ファイル名（Commentable-win32-<CPU>-<バージョン>.zip）
    public static string ReleaseAssetMarker(string arch) => $"-win32-{arch}-";
    public static string Architecture => RuntimeInformation.ProcessArchitecture == System.Runtime.InteropServices.Architecture.Arm64 ? "arm64" : "x64";
}

// JavaScript の encodeURI / encodeURIComponent と同じ文字を残す（QR コードと投稿ページの URL に使う）
static class UriEncoding
{
    public static string EncodeURI(string text) => Encode(text, ";,/?:@&=+$-_.!~*'()#");
    public static string EncodeURIComponent(string text) => Encode(text, "-_.!~*'()");

    private static string Encode(string text, string allowed)
    {
        var builder = new StringBuilder();
        foreach (var b in Encoding.UTF8.GetBytes(text))
        {
            var c = (char)b;
            if (b < 128 && (char.IsAsciiLetterOrDigit(c) || allowed.Contains(c)))
                builder.Append(c);
            else
                builder.Append('%').Append(b.ToString("X2"));
        }
        return builder.ToString();
    }
}
