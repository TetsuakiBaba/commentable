# commentable-desktop（ネイティブ版 / Windows）

macOS の Swift 版（`../macos`）と同じ配信者用アプリを、Windows 向けに C#（.NET 8 / WPF）で書いたものです。
外部のライブラリは QR コードの生成（[QRCoder](https://github.com/codebude/QRCoder)、MIT ライセンス）だけを使っています。

## 動作環境
  * Windows 10 バージョン 2004 以降 / Windows 11（x64・ARM）
  * 使う人は .NET をインストールしなくてよい（ランタイムを exe に同梱しています）
  * ビルドには .NET 8 SDK が必要

## ビルド

```
cd windows
./build.ps1                # build/x64/Commentable.exe（開発用）
./build.ps1 -Arch arm64    # ARM 版の Windows 向け
build/x64/Commentable.exe
```

開発中は `dotnet run` でも起動できます（`dotnet run -- --room 部屋名`）。

NuGet の取得先は [nuget.config](nuget.config) で nuget.org に固定しています（手元の NuGet の設定は変更しなくてよい）。

## バージョン
バージョンは [VERSION](VERSION) ファイルで管理しています（macOS 版の `macos/VERSION`、Electron 版の `electron/package.json` とは別です）。
ビルド時に exe に書き込まれ、リリースのタグは `windows-v<VERSION>` になります（macOS 版のタグ `v<VERSION>` と重ならないようにしています）。著作権表示の年はビルドした年です。

## リリース（GitHub）
ビルド・署名は GitHub Actions（[.github/workflows/windows.yml](../.github/workflows/windows.yml)）で行います。
手元の PC で行う場合は、後述の「手元の PC でのリリース」を参照してください。

### GitHub Actions でのリリース
1. `windows/VERSION` を上げてコミットし、push します
2. GitHub の Actions タブ →「Windows app」→「Run workflow」を開き、「release」にチェックを入れて実行します
   - チェックを外すと、zip を Artifacts に置くだけになります（リリース前の確認用）
3. 実行が終わったら、リリースページで下書き（`windows-v<VERSION>`）を確認して公開します
   - **公開するときは「Set as the latest release」のチェックを外してください。** 公式ページの macOS 版のダウンロードボタンは `releases/latest` を開くので、Windows 版を「最新のリリース」にすると macOS の人が Windows 版のページに案内されてしまいます

`windows/` を変更して push したときやプルリクエストでは、ビルドできるかだけを確認します（署名はしません）。

#### コード署名（任意）
署名しなくても配布できますが、ダウンロードした exe を初めて起動するときに「Windows によって PC が保護されました」（SmartScreen）と表示されます（「詳細情報」→「実行」で起動できます）。
コード署名の証明書（.pfx）があれば、次のシークレットを **release 環境**に登録すると署名します（今は登録しておらず、署名せずに配布しています）。

リリースのジョブは release 環境（実行のたびに承認が必要・master だけ）で動きます。
リポジトリ全体のシークレットは承認なしでどのワークフローからも読めるので、署名のシークレットは必ず `--env release` を付けて release 環境に登録してください（リポジトリ全体に登録したものがあれば削除します）。

```
[Convert]::ToBase64String([IO.File]::ReadAllBytes("CodeSigning.pfx")) | gh secret set WINDOWS_CERTIFICATE_PFX --env release
gh secret set WINDOWS_CERTIFICATE_PASSWORD --env release     # .pfx のパスワードを入力
gh secret list                                               # リポジトリ全体に WINDOWS_ のシークレットが残っていないこと
```

2023 年 6 月以降に発行されるコード署名の証明書は、秘密鍵を USB トークンやクラウドの HSM に置く決まりになったため、.pfx として取り出せないことがほとんどです。
その場合は、使う署名サービス（Azure Trusted Signing など）に合わせて `package.ps1` と `windows.yml` を変える必要があります。

一度署名したバージョンを配ったあとは、自動アップデートは同じ発行者の署名がある exe しか受け付けなくなります（後述）。

### 手元の PC でのリリース
1. [GitHub CLI](https://cli.github.com/)（`gh`）をインストールして `gh auth login` しておきます
2. `VERSION` を上げてコミットし、GitHub に push します
3. `./release.ps1` を実行し、リリースページで下書きを確認して公開します（「Set as the latest release」は外します）

`./package.ps1` だけを実行すると、リリースせずに `build/Commentable-win32-x64-<VERSION>.zip` と `build/Commentable-win32-arm64-<VERSION>.zip` を作ります。
署名するときは、環境変数 `WINDOWS_CERTIFICATE_PFX`（.pfx のパス）と `WINDOWS_CERTIFICATE_PASSWORD`、または `WINDOWS_CERTIFICATE_THUMBPRINT`（証明書ストアの証明書の拇印）を設定します。

### インストール
zip を展開して、`Commentable.exe` を好きな場所（例: `%LOCALAPPDATA%\Programs\Commentable`）に置いて起動します。
`C:\Program Files` のような管理者でないと書き込めない場所に置くと、自動アップデートで入れ替えられません（ダウンロードページを案内します）。

### Electron 版からの移行
Windows の Electron 版（v1.6.3 まで）は、自動アップデートでは入れ替わりません。このバージョンを手動でインストールしてください（Electron 版はアプリと機能の設定からアンインストールできます）。
配信者の鍵は Electron 版と同じ場所・同じ形式で保存するので、同じ部屋でそのまま配信できます。

### アップデート
起動時（1日1回）とメニューの「アップデートを確認...」で GitHub の最新リリースを確認し、新しいバージョンがあれば裏でダウンロードして「再起動」で入れ替えます（macOS 版と同じ使い勝手）。

  * GitHub のリリースのうち、`Commentable-win32-<CPU>-<バージョン>.zip` が付いているものだけを見ます（ARM の PC で ARM 版がなければ x64 版）。
  * ダウンロードしたファイルは、次のように確かめます。
    - GitHub がハッシュ（SHA-256）を示しているときは、一致するときだけ受け付けます。
    - 今の exe が署名されているときは、新しい exe にも同じ発行者（証明書の名前と公開鍵）の有効な署名があることを確かめます。失効した証明書の署名や、失効を確かめられないとき（オフラインなど）は受け付けません。
    - 今の exe が署名されていないときはハッシュが必須です。署名されているときは、ハッシュがなくても署名だけで受け付けます。
  * zip はメモリ上で確かめてから exe だけを取り出し、入れ替える直前にもう一度、ハッシュ・バージョン・署名を確かめます（確かめている間はほかのプログラムが書き換えられないように開いたままにし、確かめた中身をそのまま書き込みます）。入れ替えたあとは一時フォルダを消します。
  * 実行中の exe は上書きできませんが名前は変えられるので、`Commentable.exe.old` に名前を変えてから新しい exe を置きます（古い exe は次の起動時に消します）。置き場所と名前はそのままです。
  * 「あとで」を選んだときは、Commentable を終了するときに入れ替えます。メニューにも「再起動して <バージョン> に更新」が出ます。
  * 入れ替えられないとき（exe の場所に書き込めない、`build.ps1` で作った開発用のビルド）は、ダウンロードページを案内します。
  * `--update-now` を付けて起動すると、新しいバージョンがあれば確認なしで入れ替えて再起動します（動作確認用）。

## 接続先サーバー
既定は本番環境（https://commentable.onrender.com）です。ローカルのサーバーで試すときは環境変数か設定ファイルで切り替えます。

```
$env:COMMENTABLE_SERVER_URL = "http://localhost:3000"; build/x64/Commentable.exe
```

または `%APPDATA%\commentable-desktop\windows-settings.json` に `"serverURL": "http://localhost:3000"` を書きます（消すと本番に戻ります）。

`--room 部屋名` を付けて起動すると、入室のダイアログを出さずにその部屋に入ります。
`--share アプリ名`（例: `--share "Microsoft PowerPoint"` または `--share POWERPNT`）を付けると、そのアプリのウィンドウの共有用ウィンドウを開きます（開発・確認用）。

動作の記録（macOS 版の NSLog に相当）は `%LOCALAPPDATA%\Commentable\commentable.log` に残します。

## 共有用ウィンドウ（アプリのウィンドウだけを共有するとき）
Zoom などでアプリのウィンドウだけを共有すると、共有されるのはそのウィンドウの中身だけなので、画面全体に重ねたコメントは映りません。
メニューの「共有用ウィンドウ（アプリの共有）」→「ウィンドウを選んで開く...」で対象のウィンドウ（例: PowerPoint）を選ぶと、そのウィンドウの映像にコメントを重ねた「Commentable 共有用 – <アプリ名>: <タイトル>」というウィンドウが、対象のウィンドウの真後ろに用意されます。
Zoom ではこの共有用ウィンドウを、アプリのウィンドウとして共有してください。

  * 共有用ウィンドウは対象のウィンドウと同じ位置・同じ大きさで、そのすぐ後ろに隠れているので、配信者には見えません。配信者はデスクトップ上に流れるコメントを見ながら、対象のウィンドウをそのまま操作します。
  * 対象のウィンドウを動かしたり大きさを変えたりすると、共有用ウィンドウも後ろでついていきます（0.1 秒ごとに確認）。
  * 対象のウィンドウは Windows.Graphics.Capture で取り込みます（隠れていても取り込めます）。Windows 11 では取り込み中の黄色い枠を出さないようにしています。
  * 対象のウィンドウが見えないとき（最小化・別の仮想デスクトップ）は、共有用ウィンドウを最背面に下げます（Zoom の共有の一覧から消えないように、閉じはしません）。
  * 共有の一覧に出るように、共有用ウィンドウは普通のウィンドウとしてタスクバーにも表示します。
  * コメント・エフェクト・QR コード・時計・管理者メッセージ・カメラ映像は、画面全体のオーバーレイと共有用ウィンドウの両方に表示されます（位置はそれぞれで決まるので一致しません）。

## macOS 版との違い・共通点
  * **配信者の鍵は Electron 版・macOS 版と同じ形式**です（`%APPDATA%\commentable-desktop` の `app-settings.json` と鍵ファイル。Electron 版の Windows と同じ場所）。
    保存場所に Dropbox や OneDrive のフォルダを選べば、Mac と PC で同じ部屋を配信できます。
  * 授業ログの保存先は `ドキュメント\Commentable\logs\<部屋キー>\<授業回ID>.jsonl`（macOS 版と同じ形式）です。
  * Windows 版だけの設定（接続先・カメラのデバイス・表示位置・サイズ・アップデートの確認日時）は `%APPDATA%\commentable-desktop\windows-settings.json` に保存します（macOS 版の UserDefaults に相当）。
  * メニューは画面右下のタスクトレイ（通知領域）のアイコンから開きます（左クリック・右クリックのどちらでも開きます）。
  * 2つ目を起動しようとすると、すでに起動していることを知らせて終了します（コメントが二重に表示されないように。macOS ではシステムが同じことをします）。
  * クリップボードの内容を配布資料欄に送るショートカットは **Ctrl+Alt+V** です（Electron 版と同じ。macOS 版は ⌘⌥V）。
  * 描画は、コメントやエフェクトを1つずつ WPF の要素にしてアニメーションで動かします（コメントが流れていない間は描き直しません）。
  * WPF はカラー絵文字を描かないので、絵文字は絵文字のフォント（Segoe UI Emoji）が持つカラーレイヤー（OpenType の COLR v0 / CPAL）を読んで、レイヤーごとに色を付けて描きます（`TextImage.cs`）。
    Windows 11 のブラウザはグラデーション付きのレイヤー（COLR v1）で描くので、陰影の付き方が少し違います。国旗は Windows のブラウザと同じく文字（JP など）になります。
  * カメラは Windows の MediaCapture で取り込みます。初回は「設定 > プライバシーとセキュリティ > カメラ」で、デスクトップ アプリのカメラへのアクセスを許可する必要があります。
    画質（1280×720）を選ぶためにカメラを専有して開き、ほかのアプリが使っているときは共有で開きます。
  * **人物切り抜きは使えません**（Windows に macOS の Vision に相当する API がないため。Electron 版の Windows と同じ）。
  * 読み上げは Windows の音声合成（日本語の音声）を使います。
  * Socket.IO は WebSocket だけで接続する最小限のクライアントを同梱しています（`SocketIOClient.cs`）。
  * カメラ映像と QR コードは、マウスを重ねると消えます（クリックは下のアプリにそのまま届きます）。
  * 効果音・画像は `Resources/` に置き、exe に埋め込んでいます（macOS 版の `Resources/` と同じもの）。

## ファイル構成
| ファイル | 内容 |
| --- | --- |
| `Program.cs` | 起動（main.swift 相当） |
| `AppController.cs` | アプリ本体（AppDelegate.swift 相当）。オーバーレイのウィンドウ、タスクトレイのメニュー、入室 |
| `RoomSession.cs` | サーバーとの通信とコメントの処理 |
| `OverlayView.cs` | コメント・時計・QR コード・カメラ映像・エフェクトの表示 |
| `OverlayGroup.cs` | 画面全体のオーバーレイと共有用ウィンドウの両方にコメントを表示 |
| `SocketIOClient.cs` | Socket.IO v4 クライアント |
| `HostKeyStore.cs` | 配信者の鍵とダッシュボードのトークン |
| `LogArchiver.cs` | 授業ログの保存 |
| `CameraController.cs` | カメラの取り込み |
| `Survey.cs` | アンケートの集計と作成・結果ウィンドウ |
| `SettingsWindows.cs` | カメラ設定・About ウィンドウ |
| `QRCodeRenderer.cs` / `TextImage.cs` | QR コードと縁取り文字 |
| `SoundPlayer.cs` | 効果音と読み上げ |
| `GlobalHotKey.cs` | Ctrl+Alt+V（クリップボードの内容を配布資料欄に送信） |
| `UpdateChecker.cs` | GitHub のリリースで新しいバージョンを確認して入れ替え |
| `ShareWindow.cs` | 共有用ウィンドウ（ウィンドウの選択画面と、対象のウィンドウへの追従） |
| `WindowCapture.cs` | Windows.Graphics.Capture でのウィンドウの取り込み |
| `Dialogs.cs` | ダイアログと入室の画面 |
| `Preferences.cs` / `AppConfig.cs` | 設定 |
| `Native.cs` / `Log.cs` / `Resources.cs` | Win32 API・動作の記録・埋め込んだ効果音と画像 |
