# commentable-desktop（Swift ネイティブ版 / macOS）

Electron 版（`../electron`）の配信者用アプリを Swift（AppKit + SwiftUI）で書き直したものです。
外部ライブラリには依存せず、Xcode のコマンドラインツールだけでビルドできます。

## 動作環境
  * macOS 12 Monterey 以降（共有用ウィンドウは macOS 12.3 以降）
  * ビルドには Xcode（または Command Line Tools）の Swift 5.9 以降

## ビルド

```
cd macos
./build.sh              # build/Commentable.app（このMacのCPU向け、アドホック署名）
./build.sh universal    # Apple Silicon / Intel 両対応
open build/Commentable.app
```

開発中は `swift run` でも起動できます。

## バージョン
バージョンは [VERSION](VERSION) ファイルで管理しています（Electron 版の `electron/package.json` とは別です）。
ビルド時に Info.plist に書き込まれ、リリースのタグは `v<VERSION>` になります。著作権表示の年はビルドした年です。

## リリース（GitHub）
署名・ビルド・公証は GitHub Actions（[.github/workflows/macos.yml](../.github/workflows/macos.yml)）で行います。
手元の Mac で行う場合は、後述の「手元の Mac でのリリース」を参照してください。

### GitHub Actions でのリリース
1. `macos/VERSION` を上げてコミットし、push します
2. GitHub の Actions タブ →「macOS app」→「Run workflow」を開き、「release」にチェックを入れて実行します
   - チェックを外すと、署名・公証した zip を Artifacts に置くだけになります（リリース前の確認用）
3. 実行が終わったら、リリースページで下書き（`v<VERSION>`）を確認して公開します

`macos/` を変更して push したときやプルリクエストでは、ビルドできるかだけを確認します（署名・公証はしません）。

#### 初回の設定（リポジトリのシークレット）
Settings → Secrets and variables → Actions に、次のシークレットを登録します。以下のコマンドは `gh` で登録する例です。

**1. 署名用の証明書（Developer ID Application）**

キーチェーンアクセスの「自分の証明書」で「Developer ID Application: TETSUAKI BABA (ZE8M4T49DP)」を右クリック →「書き出す」で、パスワードを付けて `.p12` に書き出します（秘密鍵も一緒に書き出されます）。

```
base64 -i DeveloperID.p12 | gh secret set MACOS_CERTIFICATE_P12
gh secret set MACOS_CERTIFICATE_PASSWORD     # 書き出したときのパスワードを入力
rm DeveloperID.p12                           # 登録したら手元のファイルは消す
```

**2. 公証の資格情報（どちらか一方）**

App Store Connect API キー（推奨。個人の Apple ID のパスワードを使わずに済みます）:
App Store Connect →「ユーザとアクセス」→「統合」→「App Store Connect API」→「チームキー」で、アクセス権「デベロッパ」のキーを作り、`AuthKey_<キーID>.p8` をダウンロードします（ダウンロードは1回しかできません）。

```
gh secret set NOTARY_API_KEY_P8 < AuthKey_XXXXXXXXXX.p8
gh secret set NOTARY_API_KEY_ID              # キーID（例: XXXXXXXXXX）
gh secret set NOTARY_API_ISSUER_ID           # 同じ画面の Issuer ID
```

または Apple ID と App 用パスワード（appleid.apple.com で発行）:

```
gh secret set APPLE_ID                       # Apple ID のメールアドレス
gh secret set APPLE_TEAM_ID --body ZE8M4T49DP
gh secret set APPLE_APP_PASSWORD             # App 用パスワード
```

シークレットはフォークからのプルリクエストには渡されず、署名・公証は「Run workflow」（書き込み権限のある人だけが実行できる）のときだけ行います。

### 手元の Mac でのリリース
1. 初回だけ、公証に使う資格情報をキーチェーンに保存します
   ```
   xcrun notarytool store-credentials commentable-notary \
       --apple-id <Apple ID> --team-id ZE8M4T49DP --password <App用パスワード>
   ```
2. `VERSION` を上げてコミットし、GitHub に push します
3. `./release.sh` を実行し、リリースページで下書きを確認して公開します

`./package.sh` だけを実行すると、リリースせずに署名・公証した `build/Commentable-darwin-universal-<VERSION>.zip` を作ります（`SKIP_NOTARIZE=1` で公証を省略）。

### Electron 版からの自動移行
macOS の Electron 版（commentable-desktop）を使っている人は、Swift 版のリリースを公開すると、Electron 版の自動アップデートで Swift 版に入れ替わります。

  * 添付ファイルの名前を `Commentable-darwin-universal-<バージョン>.zip` にしています。
    Electron 版の自動アップデート（update.electronjs.org）は「-darwin-universal」を含む zip を、Apple Silicon・Intel どちらの Mac にも更新として配ります。
  * Electron 版が入れ替えを受け付けるのは、バンドル ID が同じで、同じチーム（ZE8M4T49DP）の Developer ID で署名されたアプリだけです。
    そのため Swift 版のバンドル ID は Electron 版と同じ `com.electron.commentable-desktop` にしています（変えると移行できなくなります）。
  * 入れ替わった後も、アプリの名前（アプリケーションフォルダの表示）は `commentable-desktop.app` のままです。カメラの許可も引き継がれます。
  * Electron 版が動く macOS 12 でも動くように、Swift 版も macOS 12 以降に対応させています。
  * 下書きやプレリリースは配られないので、リリースを公開したときに移行が始まります。

### アップデートの確認
Swift 版は、メニューの「アップデートを確認...」と、起動時（1日1回）に GitHub の最新リリースを確認し、新しいバージョンがあればダウンロードページを案内します。
自動でのダウンロード・入れ替えはしません。

## 接続先サーバー
既定は本番環境（https://commentable.onrender.com）です。ローカルのサーバーで試すときは環境変数か defaults で切り替えます。

```
COMMENTABLE_SERVER_URL=http://localhost:3000 build/Commentable.app/Contents/MacOS/Commentable
# または
defaults write com.electron.commentable-desktop serverURL http://localhost:3000
defaults delete com.electron.commentable-desktop serverURL   # 本番に戻す
```

`--room 部屋名` を付けて起動すると、入室のダイアログを出さずにその部屋に入ります。
`--share アプリ名`（例: `--share "Microsoft PowerPoint"`）を付けると、そのアプリのウィンドウの共有用ウィンドウを開きます（開発・確認用）。

## 共有用ウィンドウ（アプリのウィンドウだけを共有するとき）
Zoom などでアプリのウィンドウだけを共有すると、共有されるのはそのウィンドウの中身だけなので、画面全体に重ねたコメントは映りません。
メニューの「共有用ウィンドウ（アプリの共有）」→「ウィンドウを選んで開く...」で対象のウィンドウ（例: PowerPoint）を選ぶと、そのウィンドウの映像にコメントを重ねた「Commentable 共有用 – <アプリ名>: <タイトル>」というウィンドウが、対象のウィンドウの真後ろに用意されます。
Zoom ではこの共有用ウィンドウを、アプリのウィンドウとして共有してください。

  * 共有用ウィンドウは対象のウィンドウと同じ位置・同じ大きさで、そのすぐ後ろに隠れているので、配信者には見えません。配信者はデスクトップ上に流れるコメントを見ながら、対象のウィンドウをそのまま操作します。
  * 対象のウィンドウを動かしたり大きさを変えたりすると、共有用ウィンドウも後ろでついていきます（0.1 秒ごとに確認）。
  * 隠れていても ScreenCaptureKit では中身を取り込めます。画面の外に置いたり透明にしたりすると取り込めないので、この方式にしています。
  * 対象のウィンドウが見えないとき（最小化・別の操作スペース）は、共有用ウィンドウを最背面に下げます（Zoom の共有の一覧から消えないように、閉じはしません）。
  * 取り込みは対象のウィンドウがあるディスプレイの倍率で行います（倍率の違うディスプレイでも正しい大きさで取り込みます）。
  * 対象のウィンドウは ScreenCaptureKit で取り込みます。初回は「画面収録」の許可が必要です（システム設定 > プライバシーとセキュリティ > 画面収録）。
  * コメント・エフェクト・QR コード・時計・管理者メッセージ・カメラ映像は、画面全体のオーバーレイと共有用ウィンドウの両方に表示されます（位置はそれぞれで決まるので一致しません）。

## Electron 版との違い・共通点
  * **配信者の鍵は Electron 版と共有**します（`~/Library/Application Support/commentable-desktop` の `app-settings.json` と鍵ファイル）。
    Electron 版と Swift 版を切り替えても同じ部屋で配信できます。
  * 授業ログの保存先も同じ（`書類/Commentable/logs/<部屋キー>/<授業回ID>.jsonl`）です。
  * カメラの設定（デバイス・表示位置・サイズ・人物切り抜き）は、デバイス ID の形式が違うので Swift 版だけで保存します（UserDefaults）。
  * 描画は p5.js のキャンバスではなく、コメントやエフェクトをレイヤーにして Core Animation で動かします。
    コメントが流れていない間は CPU をほとんど使いません。
  * 人物切り抜きは Vision（`VNGeneratePersonSegmentationRequest`）を直接使うので、ネイティブアドオンのビルドは不要です。
  * Socket.IO は WebSocket だけで接続する最小限のクライアントを同梱しています（`SocketIOClient.swift`）。
  * カメラ映像と QR コードは、マウスを重ねると消えます（クリックは下のアプリにそのまま届きます）。
  * 効果音・画像は `Resources/` に置いています（Electron 版から使っているものだけを複製）。
  * 自動アップデートはせず、新しいバージョンがあるとダウンロードページを案内します。

## ファイル構成
| ファイル | 内容 |
| --- | --- |
| `AppDelegate.swift` | アプリ本体（main.js 相当）。オーバーレイのウィンドウ、メニューバーのメニュー、入室 |
| `RoomSession.swift` | サーバーとの通信とコメントの処理（sketch.js の通信部分に相当） |
| `OverlayView.swift` | コメント・時計・QR コード・カメラ映像・エフェクトの表示 |
| `SocketIOClient.swift` | Socket.IO v4 クライアント |
| `HostKeyStore.swift` | 配信者の鍵とダッシュボードのトークン |
| `LogArchiver.swift` | 授業ログの保存 |
| `CameraController.swift` | カメラの取り込みと人物切り抜き |
| `Survey.swift` | アンケートの集計と作成・結果ウィンドウ |
| `SettingsWindows.swift` | カメラ設定・About ウィンドウ |
| `QRCodeRenderer.swift` / `TextImage.swift` | QR コードと縁取り文字の画像化 |
| `SoundPlayer.swift` | 効果音と読み上げ |
| `GlobalHotKey.swift` | ⌘⌥V（クリップボードの内容を配布資料欄に送信） |
| `UpdateChecker.swift` | GitHub のリリースで新しいバージョンを確認 |
| `ShareWindow.swift` | 共有用ウィンドウ（ScreenCaptureKit でのウィンドウの取り込みと選択画面） |
| `OverlayGroup.swift` | 画面全体のオーバーレイと共有用ウィンドウの両方にコメントを表示 |
