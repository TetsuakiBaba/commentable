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
//     今の exe が署名されているときは、同じ発行者（名前と公開鍵）の有効な署名があることも確かめる
//   - 入れ替える直前に、確かめた exe が変わっていないかをもう一度確かめる
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
    // Exe は一時フォルダ（Directory）に置いた exe、Sha256 は確かめたときの exe のハッシュ
    public sealed record ReadyUpdate(string Version, string Exe, string Directory, byte[] Sha256);

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
            var update = await DownloadAndVerify(asset, release.Version);
            Ready = update;
            if (installImmediately) Install(update, relaunch: true); else PromptRestart(update);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or IOException or InvalidDataException or UnauthorizedAccessException)
        {
            Log.Write($"Update: {e.Message}");
            ShowDownloadPage(release, e.Message);
        }
    }

    // zip をダウンロードし、中の exe を取り出して想定どおりかを確かめる
    // （zip はメモリ上で扱い、ハッシュを確かめたものから直接 exe を取り出す。途中でファイルをすり替えられないように）
    private static async Task<ReadyUpdate> DownloadAndVerify(Asset asset, string version)
    {
        byte[] zip;
        using (var response = await Http.GetAsync(asset.Url, HttpCompletionOption.ResponseHeadersRead))
        {
            if (!response.IsSuccessStatusCode) throw new HttpRequestException("ダウンロードできませんでした。");
            if (response.Content.Headers.ContentLength > MaxDownloadSize) throw new InvalidDataException("ダウンロードしたファイルが大きすぎます。");
            zip = await response.Content.ReadAsByteArrayAsync();
        }
        if (zip.Length > MaxDownloadSize) throw new InvalidDataException("ダウンロードしたファイルが大きすぎます。");

        // GitHub が示すハッシュと比べる（途中で壊れたり差し替えられたりしていないか）
        if (asset.Digest is { } digest && digest.StartsWith("sha256:", StringComparison.OrdinalIgnoreCase))
        {
            var hash = Convert.ToHexString(SHA256.HashData(zip));
            if (!hash.Equals(digest["sha256:".Length..], StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("ダウンロードしたファイルが壊れています。");
        }
        else if (Signer(Environment.ProcessPath) == null)
        {
            // 署名もハッシュもなければ確かめようがない
            throw new InvalidDataException("ダウンロードしたファイルを確認できませんでした。");
        }

        var exeBytes = ExtractExe(zip) ?? throw new InvalidDataException("ダウンロードしたファイルを展開できませんでした。");

        // 署名とバージョンはファイルでないと確かめられないので、自分だけの一時フォルダに置く
        var dir = Path.Combine(Path.GetTempPath(), $"CommentableUpdate-{version}-{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        var exe = Path.Combine(dir, "Commentable.exe");
        await File.WriteAllBytesAsync(exe, exeBytes);
        var update = new ReadyUpdate(version, exe, dir, SHA256.HashData(exeBytes));
        if (ReadVerified(update) == null)
        {
            DeleteDirectory(dir);
            throw new InvalidDataException("ダウンロードしたアプリの内容か署名を確認できませんでした。");
        }
        return update;
    }

    private const long MaxDownloadSize = 512L * 1024 * 1024;

    // zip の中の Commentable.exe の中身（なければ・壊れていれば null）
    private static byte[]? ExtractExe(byte[] zip)
    {
        try
        {
            using var archive = new ZipArchive(new MemoryStream(zip), ZipArchiveMode.Read);
            var entry = archive.Entries.FirstOrDefault(e => e.Name.Equals("Commentable.exe", StringComparison.OrdinalIgnoreCase));
            if (entry == null || entry.Length > MaxDownloadSize) return null;
            using var source = entry.Open();
            using var memory = new MemoryStream((int)entry.Length);
            source.CopyTo(memory);
            return memory.ToArray();
        }
        catch (InvalidDataException)
        {
            return null;
        }
    }

    // 確かめた exe の中身を返す（想定と違えば null）
    // 確かめている間は、ほかのプログラムが書き換えたり消したりできないように開いたままにする
    private static byte[]? ReadVerified(ReadyUpdate update)
    {
        try
        {
            using var file = new FileStream(update.Exe, FileMode.Open, FileAccess.Read, FileShare.Read);
            var bytes = new byte[file.Length];
            file.ReadExactly(bytes);
            if (!SHA256.HashData(bytes).AsSpan().SequenceEqual(update.Sha256))
            {
                Log.Write("Update: the downloaded app has been changed");
                return null;
            }
            var info = FileVersionInfo.GetVersionInfo(update.Exe);
            if (info.ProductName != "Commentable" || info.ProductVersion != update.Version)
            {
                Log.Write("Update: the downloaded app is not the expected version");
                return null;
            }
            if (!SatisfiesOwnSignature(update.Exe))
            {
                Log.Write("Update: the downloaded app does not satisfy the signature requirement");
                return null;
            }
            return bytes;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Log.Write($"Update: cannot verify the downloaded app: {e.Message}");
            return null;
        }
    }

    // 今の exe が署名されていれば、新しい exe にも同じ発行者（名前と公開鍵）の有効な署名があるか
    private static bool SatisfiesOwnSignature(string exe)
    {
        var own = Signer(Environment.ProcessPath);
        if (own == null) return true; // 署名していないビルドは、GitHub の HTTPS とハッシュで確かめる
        return Authenticode.IsTrusted(exe) && Signer(exe) is { } signer
            && signer.Subject == own.Value.Subject && signer.PublicKey.AsSpan().SequenceEqual(own.Value.PublicKey);
    }

    // 署名した証明書の名前と公開鍵（署名されていなければ null）
    private static (string Subject, byte[] PublicKey)? Signer(string? path)
    {
        if (path == null) return null;
        try
        {
#pragma warning disable SYSLIB0057
            using var certificate = new X509Certificate2(X509Certificate.CreateFromSignedFile(path));
#pragma warning restore SYSLIB0057
            return (certificate.Subject, certificate.GetPublicKey());
        }
        catch (CryptographicException)
        {
            return null;
        }
    }

    private static void DeleteDirectory(string dir)
    {
        try
        {
            if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Log.Write($"Update: cannot delete {dir}: {e.Message}");
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
    // ダウンロードしてから時間がたっていることがあるので、入れ替える直前にもう一度確かめ、確かめた中身をそのまま書き込む
    private static bool Replace(ReadyUpdate update)
    {
        if (Environment.ProcessPath is not { } exe) return false;
        var bytes = ReadVerified(update);
        DeleteDirectory(update.Directory); // 一時フォルダはもう使わない
        if (bytes == null) return false;

        var staged = exe + ".new";
        try
        {
            File.WriteAllBytes(staged, bytes);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Log.Write($"Update: cannot write new app: {e.Message}");
            return false;
        }

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
            TryDelete(staged);
            return false;
        }
        try
        {
            File.Move(staged, exe);
            return true;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Log.Write($"Update: cannot install new app: {e.Message}");
            TryDelete(staged);
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

    private static void TryDelete(string file)
    {
        try
        {
            File.Delete(file);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
        }
    }

    // 起動時に呼ぶ: 入れ替える前の exe（Commentable.exe.old）が残っていれば消す
    // （入れ替えの途中で止まったときの Commentable.exe.new と、使わなかったダウンロードの一時フォルダも消す）
    public static void CleanUpAfterUpdate()
    {
        if (Environment.ProcessPath is not { } exe || Path.GetDirectoryName(exe) is not { } dir) return;
        try
        {
            foreach (var pattern in new[] { ".old*", ".new" })
            {
                foreach (var file in Directory.EnumerateFiles(dir, Path.GetFileName(exe) + pattern)) TryDelete(file);
            }
            foreach (var download in Directory.EnumerateDirectories(Path.GetTempPath(), "CommentableUpdate-*")) DeleteDirectory(download);
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
        if (response == 0) Shell.Open(ReleasePageURL(release.HtmlUrl));
    }

    // GitHub の API から受け取った URL は、このリポジトリのページのときだけ開く（それ以外はリリースの一覧）
    private static string ReleasePageURL(string url)
    {
        var releases = $"https://github.com/{AppConfig.GithubRepository}/releases";
        return Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps && uri.Host == "github.com"
            && uri.AbsolutePath.StartsWith($"/{AppConfig.GithubRepository}/releases", StringComparison.OrdinalIgnoreCase)
            ? uri.AbsoluteUri : releases;
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
    private const uint WTD_REVOKE_WHOLECHAIN = 1;
    private const uint WTD_REVOCATION_CHECK_CHAIN = 0x40;
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
                // 失効した（盗まれた）証明書の署名は受け付けない。失効を確かめられないとき（オフラインなど）も受け付けない
                // （そのときは自動では入れ替えず、ダウンロードページを案内する）
                fdwRevocationChecks = WTD_REVOKE_WHOLECHAIN,
                dwProvFlags = WTD_REVOCATION_CHECK_CHAIN,
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
