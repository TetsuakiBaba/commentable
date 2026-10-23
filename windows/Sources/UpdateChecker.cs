using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json.Nodes;
using System.Threading.Tasks;

namespace Commentable;

// ========== アップデート ==========
// GitHub のリリースから Windows 版の最新バージョンを探し、新しければ裏でダウンロードしておき、
// 「再起動」で exe を入れ替える（Electron 版の自動アップデートと同じ使い勝手）
//   - ダウンロードしたファイルは、GitHub が示すハッシュ（SHA-256）と一致するときだけ受け付ける。
//     今の exe が署名されているときは、同じ発行者の有効な署名があることも確かめる
//   - 「あとで」を選んだときは、アプリを終了するときに入れ替える
//   - 入れ替えられないとき（書き込めない場所・開発用のビルド）はダウンロードページを案内する
//   - 実行中の exe は上書きできないが名前は変えられるので、名前を変えてから新しい exe を置く
sealed class UpdateChecker
{
    private sealed record Asset(string Name, string Url, string? Digest);

    private sealed record Release(string Tag, string HtmlUrl, bool Draft, bool Prerelease, List<Asset> Assets)
    {
        public string Version => Tag.StartsWith(AppConfig.ReleaseTagPrefix) ? Tag[AppConfig.ReleaseTagPrefix.Length..]
            : Tag.StartsWith('v') ? Tag[1..] : Tag;

        // この PC の CPU 向けのもの（ARM 版がなければ x64 版。ARM の Windows でも動く）
        public Asset? Asset => FindAsset(AppConfig.Architecture) ?? FindAsset("x64");

        private Asset? FindAsset(string arch) =>
            Assets.FirstOrDefault(a => a.Name.Contains(AppConfig.ReleaseAssetMarker(arch)) && a.Name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase));
    }

    // ダウンロードして確認済みの新しいバージョン
    public sealed record ReadyUpdate(string Version, string Exe);

    private const string LastCheckKey = "update.lastCheck";
    private static readonly HttpClient Http = CreateClient();
    private bool checking;
    public ReadyUpdate? Ready { get; private set; }
    private bool installOnQuit;

    private static HttpClient CreateClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd($"Commentable-Windows/{AppConfig.Version}"); // GitHub の API に必要
        return client;
    }

    // 起動時に1日1回だけ確認する（新しいバージョンがあるときだけ知らせる）
    public void CheckInBackground()
    {
        var last = Preferences.GetDouble(LastCheckKey);
        if (DateTimeOffset.UtcNow.ToUnixTimeSeconds() - last <= 24 * 60 * 60) return;
        Check(manual: false);
    }

    // manual: メニューから確認したとき（最新でも結果を知らせる）
    // installImmediately: 確認せずに入れ替えて再起動する（--update-now で起動したとき。動作確認用）
    public async void Check(bool manual, bool installImmediately = false)
    {
        if (Ready is { } ready)
        {
            if (installImmediately) Install(ready, relaunch: true); else PromptRestart(ready);
            return;
        }
        if (checking) return;
        checking = true;
        try
        {
            Release? latest;
            try
            {
                latest = await FetchLatestRelease();
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException or InvalidDataException or System.Text.Json.JsonException)
            {
                if (manual) Dialogs.Message("アップデートを確認できませんでした", e.Message, style: DialogStyle.Warning);
                return;
            }
            Preferences.Set(LastCheckKey, DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            if (latest == null || Compare(latest.Version, AppConfig.Version) <= 0)
            {
                if (manual) Dialogs.Message("最新のバージョンです", $"現在のバージョン: {AppConfig.Version}");
                return;
            }
            await Download(latest, installImmediately);
        }
        finally
        {
            checking = false;
        }
    }

    private static async Task<Release?> FetchLatestRelease()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"https://api.github.com/repos/{AppConfig.GithubRepository}/releases?per_page=30");
        request.Headers.Accept.ParseAdd("application/vnd.github+json");
        using var timeout = new System.Threading.CancellationTokenSource(TimeSpan.FromSeconds(15));
        using var response = await Http.SendAsync(request, timeout.Token);
        if (!response.IsSuccessStatusCode) throw new HttpRequestException("GitHub に接続できませんでした。");
        if (JsonNode.Parse(await response.Content.ReadAsStringAsync(timeout.Token)) is not JsonArray json) throw new InvalidDataException("GitHub に接続できませんでした。");
        var releases = json.OfType<JsonObject>().Select(release => new Release(
            SocketIOClient.String(release["tag_name"]) ?? "",
            SocketIOClient.String(release["html_url"]) ?? "",
            SocketIOClient.Bool(release["draft"]),
            SocketIOClient.Bool(release["prerelease"]),
            (release["assets"] as JsonArray ?? []).OfType<JsonObject>().Select(asset => new Asset(
                SocketIOClient.String(asset["name"]) ?? "",
                SocketIOClient.String(asset["browser_download_url"]) ?? "",
                SocketIOClient.String(asset["digest"]))).ToList()));
        // Windows 版の添付ファイルがある公開済みのリリースのうち、いちばん新しいもの
        return releases
            .Where(release => !release.Draft && !release.Prerelease && release.Asset != null)
            .OrderByDescending(release => release.Version, Comparer<string>.Create(Compare))
            .FirstOrDefault();
    }

    // ========== ダウンロードと確認 ==========
    private async Task Download(Release release, bool installImmediately)
    {
        if (release.Asset is not { } asset || !CanReplaceApp)
        {
            ShowDownloadPage(release);
            return;
        }
        try
        {
            var exe = await DownloadAndVerify(asset, release.Version);
            var update = new ReadyUpdate(release.Version, exe);
            Ready = update;
            if (installImmediately) Install(update, relaunch: true); else PromptRestart(update);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or IOException or InvalidDataException or UnauthorizedAccessException)
        {
            Log.Write($"Update: {e.Message}");
            ShowDownloadPage(release, e.Message);
        }
    }

    // zip をダウンロードして展開し、中の exe が想定どおりかを確かめる
    private static async Task<string> DownloadAndVerify(Asset asset, string version)
    {
        var dir = Path.Combine(Path.GetTempPath(), $"CommentableUpdate-{version}-{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        var zip = Path.Combine(dir, "update.zip");
        using (var response = await Http.GetAsync(asset.Url, HttpCompletionOption.ResponseHeadersRead))
        {
            if (!response.IsSuccessStatusCode) throw new HttpRequestException("ダウンロードできませんでした。");
            await using var file = File.Create(zip);
            await response.Content.CopyToAsync(file);
        }

        // GitHub が示すハッシュと比べる（途中で壊れたり差し替えられたりしていないか）
        if (asset.Digest is { } digest && digest.StartsWith("sha256:", StringComparison.OrdinalIgnoreCase))
        {
            await using var file = File.OpenRead(zip);
            var hash = Convert.ToHexString(await SHA256.HashDataAsync(file));
            if (!hash.Equals(digest["sha256:".Length..], StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("ダウンロードしたファイルが壊れています。");
        }
        else if (!IsSigned(Environment.ProcessPath))
        {
            // 署名もハッシュもなければ確かめようがない
            throw new InvalidDataException("ダウンロードしたファイルを確認できませんでした。");
        }

        var extracted = Path.Combine(dir, "extracted");
        try
        {
            ZipFile.ExtractToDirectory(zip, extracted);
        }
        catch (InvalidDataException)
        {
            throw new InvalidDataException("ダウンロードしたファイルを展開できませんでした。");
        }
        var exe = Directory.EnumerateFiles(extracted, "Commentable.exe", SearchOption.AllDirectories).FirstOrDefault()
            ?? throw new InvalidDataException("ダウンロードしたファイルを展開できませんでした。");

        var info = FileVersionInfo.GetVersionInfo(exe);
        if (info.ProductName != "Commentable" || info.ProductVersion != version)
        {
            throw new InvalidDataException("ダウンロードしたアプリの内容が想定と違います。");
        }
        if (!SatisfiesOwnSignature(exe))
        {
            throw new InvalidDataException("ダウンロードしたアプリの署名を確認できませんでした。");
        }
        return exe;
    }

    // 今の exe が署名されていれば、新しい exe にも同じ発行者の有効な署名があるか
    private static bool SatisfiesOwnSignature(string exe)
    {
        var own = SignerSubject(Environment.ProcessPath);
        if (own == null) return true; // 署名していないビルドは、GitHub の HTTPS とハッシュで確かめる
        return Authenticode.IsTrusted(exe) && SignerSubject(exe) == own;
    }

    private static bool IsSigned(string? path) => SignerSubject(path) != null;

    private static string? SignerSubject(string? path)
    {
        if (path == null) return null;
        try
        {
#pragma warning disable SYSLIB0057
            return X509Certificate.CreateFromSignedFile(path).Subject;
#pragma warning restore SYSLIB0057
        }
        catch (CryptographicException)
        {
            return null;
        }
    }

    // exe を置いている場所に書き込めるか（Program Files などは管理者でないと書き込めない）
    private static bool CanReplaceApp
    {
        get
        {
            if (!AppConfig.IsDistribution || Environment.ProcessPath is not { } exe) return false;
            var test = Path.Combine(Path.GetDirectoryName(exe)!, $".commentable-write-test-{Guid.NewGuid():N}");
            try
            {
                File.WriteAllText(test, "");
                File.Delete(test);
                return true;
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                return false;
            }
        }
    }

    // ========== 入れ替え ==========
    private void PromptRestart(ReadyUpdate update)
    {
        var response = Dialogs.Message("新しいバージョンがあります",
            $"Commentable {update.Version} をダウンロードしました（現在のバージョン: {AppConfig.Version}）。\n\n再起動すると新しいバージョンに更新されます。「あとで」を選んだときは、Commentable を終了するときに更新されます。",
            ["再起動", "あとで"]);
        if (response == 0) Install(update, relaunch: true);
        else installOnQuit = true;
    }

    // アプリの終了時に呼ぶ（「あとで」を選んでいたら入れ替える）
    public void ApplicationWillTerminate()
    {
        if (installOnQuit && Ready is { } ready) Replace(ready);
    }

    private void Install(ReadyUpdate update, bool relaunch)
    {
        installOnQuit = false;
        if (!Replace(update))
        {
            Dialogs.Message("アップデートできませんでした", "GitHub のリリースページから新しいバージョンをダウンロードしてください。", style: DialogStyle.Warning);
            Shell.Open($"https://github.com/{AppConfig.GithubRepository}/releases");
            return;
        }
        Ready = null;
        if (relaunch && Environment.ProcessPath is { } exe)
        {
            // 新しいアプリは、このアプリが終了するのを待ってから始める（ショートカットキーの登録が重ならないように）
            try
            {
                Process.Start(new ProcessStartInfo(exe) { ArgumentList = { "--wait-pid", Environment.ProcessId.ToString() }, UseShellExecute = false });
            }
            catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException)
            {
                Log.Write($"Update: cannot relaunch: {e.Message}");
            }
        }
        Program.Quit();
    }

    // 実行中の exe の名前を変えて（上書きはできないが名前は変えられる）、新しい exe を置く
    // 置き場所と名前はそのまま
    private static bool Replace(ReadyUpdate update)
    {
        if (Environment.ProcessPath is not { } exe || !File.Exists(update.Exe)) return false;
        var old = exe + ".old";
        try
        {
            if (File.Exists(old)) File.Delete(old);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            old = $"{exe}.old-{Guid.NewGuid():N}";
        }
        try
        {
            File.Move(exe, old);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Log.Write($"Update: cannot move current app: {e.Message}");
            return false;
        }
        try
        {
            File.Move(update.Exe, exe);
            return true;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Log.Write($"Update: cannot install new app: {e.Message}");
            try
            {
                File.Move(old, exe);
            }
            catch (Exception restore) when (restore is IOException or UnauthorizedAccessException)
            {
                Log.Write($"Update: cannot restore app: {restore.Message}");
            }
            return false;
        }
    }

    // 起動時に呼ぶ: 入れ替える前の exe（Commentable.exe.old）が残っていれば消す
    public static void CleanUpAfterUpdate()
    {
        if (Environment.ProcessPath is not { } exe || Path.GetDirectoryName(exe) is not { } dir) return;
        try
        {
            foreach (var old in Directory.EnumerateFiles(dir, Path.GetFileName(exe) + ".old*"))
            {
                try
                {
                    File.Delete(old);
                }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException)
                {
                }
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
        }
    }

    // 自動で入れ替えられないときは、これまでどおりダウンロードページを案内する
    private static void ShowDownloadPage(Release release, string? reason = null)
    {
        var detail = $"Commentable {release.Version} が公開されています（現在のバージョン: {AppConfig.Version}）。\n\nダウンロードした zip を展開して、今お使いの {Path.GetFileName(Environment.ProcessPath ?? "Commentable.exe")} と入れ替えてください。";
        if (reason != null) detail += $"\n\n（自動で更新できませんでした: {reason}）";
        var response = Dialogs.Message("新しいバージョンがあります", detail, ["ダウンロードページを開く", "あとで"]);
        if (response == 0 && release.HtmlUrl.Length > 0) Shell.Open(release.HtmlUrl);
    }

    // "1.10.0" と "1.9.2" のような数字の並びを比べる
    public static int Compare(string? a, string? b)
    {
        static int[] Parts(string? text) => (text ?? "").Split('.').Select(part => int.TryParse(part, out var n) ? n : 0).ToArray();
        var x = Parts(a);
        var y = Parts(b);
        for (var i = 0; i < Math.Max(x.Length, y.Length); i++)
        {
            var l = i < x.Length ? x[i] : 0;
            var r = i < y.Length ? y[i] : 0;
            if (l != r) return l < r ? -1 : 1;
        }
        return 0;
    }
}

// Authenticode の署名が有効か（WinVerifyTrust）
static class Authenticode
{
    private static readonly Guid GenericVerifyV2 = new("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WINTRUST_FILE_INFO
    {
        public uint cbStruct;
        public string pcwszFilePath;
        public IntPtr hFile;
        public IntPtr pgKnownSubject;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WINTRUST_DATA
    {
        public uint cbStruct;
        public IntPtr pPolicyCallbackData;
        public IntPtr pSIPClientData;
        public uint dwUIChoice;
        public uint fdwRevocationChecks;
        public uint dwUnionChoice;
        public IntPtr pFile;
        public uint dwStateAction;
        public IntPtr hWVTStateData;
        public IntPtr pwszURLReference;
        public uint dwProvFlags;
        public uint dwUIContext;
        public IntPtr pSignatureSettings;
    }

    [DllImport("wintrust.dll", ExactSpelling = true)]
    private static extern int WinVerifyTrust(IntPtr hwnd, in Guid action, ref WINTRUST_DATA data);

    private const uint WTD_UI_NONE = 2;
    private const uint WTD_REVOKE_NONE = 0;
    private const uint WTD_CHOICE_FILE = 1;
    private const uint WTD_STATEACTION_VERIFY = 1;
    private const uint WTD_STATEACTION_CLOSE = 2;

    public static bool IsTrusted(string path)
    {
        var fileInfo = new WINTRUST_FILE_INFO { cbStruct = (uint)Marshal.SizeOf<WINTRUST_FILE_INFO>(), pcwszFilePath = path };
        var filePointer = Marshal.AllocHGlobal(Marshal.SizeOf<WINTRUST_FILE_INFO>());
        try
        {
            Marshal.StructureToPtr(fileInfo, filePointer, false);
            var data = new WINTRUST_DATA
            {
                cbStruct = (uint)Marshal.SizeOf<WINTRUST_DATA>(),
                dwUIChoice = WTD_UI_NONE,
                fdwRevocationChecks = WTD_REVOKE_NONE,
                dwUnionChoice = WTD_CHOICE_FILE,
                pFile = filePointer,
                dwStateAction = WTD_STATEACTION_VERIFY,
            };
            var result = WinVerifyTrust(new IntPtr(-1), GenericVerifyV2, ref data);
            data.dwStateAction = WTD_STATEACTION_CLOSE;
            WinVerifyTrust(new IntPtr(-1), GenericVerifyV2, ref data);
            return result == 0;
        }
        finally
        {
            Marshal.DestroyStructure<WINTRUST_FILE_INFO>(filePointer);
            Marshal.FreeHGlobal(filePointer);
        }
    }
}
