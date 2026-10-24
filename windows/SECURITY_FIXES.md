# Windows 版のセキュリティ修正の依頼

macOS 側でセキュリティの点検をしたときに、Windows 版（`windows/`）のコードも読んで、直したほうがよい点が見つかりました。
macOS 版（`macos/Sources/Commentable/`）では同じ種類の問題をすでに直して v2.0.3 として公開しています。Windows 版も同じ考え方で直してください。

## 最初に: リポジトリの履歴が書き換わっています
2026-10-24 に、学生の個人情報を含むファイルを消すため、GitHub の履歴を書き換えました（すべてのコミットの ID が変わっています）。
この Windows 端末のリポジトリは古い履歴のままなので、作業の前に新しい履歴に合わせてください。

```
git fetch --force --prune --prune-tags origin
git status                     # コミットしていない変更があれば、先に退避する（git stash など）
git reset --hard origin/master # 手元の master を新しい履歴に合わせる
```

古い履歴のブランチを push しないでください（消したファイルが戻ってしまいます。master は強制 push が禁止されているので push は失敗します）。

## 前提: サーバー側の変更
参加者は誰でも任意の内容のコメントをサーバーに送れます。サーバー（`server.js` の `sanitizeComment`）は今は次のように中身を確かめてから中継しますが、
アプリ側でも、想定外の内容で止まったり重くなったりしないようにしてください。

- 文字列は 300 文字まで（`hidden == 100` の配布資料は 20000 文字まで）
- `color_text` / `color_text_stroke` は `#rrggbb`、`text_direction` / `font_size` は決まった値だけ
- `id_sound` は 0〜99 の整数、`hidden` は -1〜100 の整数、`flg_*` は真偽値
- 1つの接続から短時間に大量に送られたイベントは捨てる（10 件/秒、まとめて 30 件まで）

**コメントの本文（`=text(...)` の引数など）の中身は、サーバーでは確かめていません。**

## 直してほしいこと

### 1.（中）`=text(...)` に Infinity や巨大な値が来ると、コメントが約 45 秒届かなくなる
- 場所: `Sources/RoomSession.cs:198-203`、`Sources/OverlayView.cs:155-159`（`Place`）と `:267-275`（`AddTextCommand`）、`Sources/SocketIOClient.cs:145`
- 何が起きるか: `double.TryParse` は `NaN` / `Infinity` / `1e999`（→ Infinity）を受け付ける。`x * W` もあふれることがある。
  WPF の `Canvas.SetLeft(element, Infinity)` は `ArgumentException` を投げる。
  - `commandsLayer.Children.Add(element)` のあとに `Place` しているので、文字が左上に残ったまま消えない
  - 例外が受信ループまで上がり、受信ループが止まる（`IsConnected` は true のまま）。ping のタイムアウト（約 45 秒）まで再接続しない。
    参加者が `=text(X, 1e999, 0.5)` を送り続けると、配信画面にコメントが表示されない状態が続く
- 直し方（macOS 版の `RoomSession.swift` の `executeCommentCommand` と同じ）:
  - `double.IsFinite(x) && double.IsFinite(y)` でなければ表示しない（コマンドとしては処理済みにする）
  - `x = Math.Clamp(x, 0, 1)`、`y = Math.Clamp(y, 0, 1)`
  - `AddTextCommand` では `Place` してから `Children.Add` する

### 2.（中）コメントコマンドの数と長さに制限がない
- 場所: `Sources/RoomSession.cs:135-144`（長さの制限がなく、`hidden` を確かめる前にコマンドを実行している）、`Sources/OverlayView.cs:267-275`（`commandsLayer` の数の上限がない）
- 何が起きるか: `hidden == 100`（最大 20000 文字）の `=text(<とても長い文字列>, 0.5, 0.5)` を、折り返しなしの `OutlinedText` として描くので、
  とても横長のジオメトリができて UI スレッドが固まる。コマンドは 10 秒残り、数の上限もない
- 直し方（macOS 版の `RoomSession.swift` / `OverlayView.swift` と同じ）:
  - `NewComment` の最初でコメントを 300 文字に切り詰める（`=text` の引数も 300 文字まで）
  - `AddTextCommand` で `commandsLayer.Children.Count >= 20` なら表示しない
  - （任意）`hidden == 100` のときはコメントコマンドとして扱わない

### 3.（中〜低）受信の処理で例外が起きると、受信ループが黙って止まる
- 場所: `Sources/SocketIOClient.cs:77-81, 137-150, 152-169`
- 何が起きるか: イベントのハンドラで、`RunAsync` が捕まえる 5 種類の例外（WebSocket / IO / OperationCanceled / ObjectDisposed / InvalidOperation）以外が起きると、
  `HandleClose` が呼ばれずに受信ループが終わる
- 直し方:
  - `Fire` で、各ハンドラの呼び出しを `try { } catch (Exception e) { ログに書く }` で囲む（1つのイベントの失敗で受信を止めない）
  - `RunAsync` の最後に `catch (Exception)` を足し、必ず `HandleClose` が呼ばれるようにする
  - `Number()` は `TryGetValue<double>` を使い、有限でない値は null として扱う
  - 1つのメッセージの大きさに上限を付ける（例: 8 MB を超えたら切断する）

### 4.（低〜中）読み上げの待ち行列に上限がなく、ミュートしても止まらない
- 場所: `Sources/SoundPlayer.cs:91-95, 97-120`
- 何が起きるか: 読み上げ付きのコメントがすべて `speechQueue` に積まれる（1 件あたり最大 1 分）。
  `IsMuted` は積むときにしか見ていないので、大量に送られると、ミュートしても長時間しゃべり続ける
- 直し方:
  - 待っている読み上げが 3 件ほどを超えたら、新しいものは捨てる
  - `SpeakAsync` の中でも `IsMuted` を確かめる
  - ミュートにしたら、`CancellationTokenSource` で待ち行列を取り消し、再生中の読み上げも止める

### 5.（低）自動アップデートで、入れ替える直前にファイルを確かめ直していない
- 場所: `Sources/UpdateChecker.cs:148-195`（確かめるのはダウンロード時だけ）、`:253-256` と `:285-324`（`Replace` は `File.Exists` しか見ていない）
- 何が起きるか: 確かめた exe は、「あとで」を選ぶと終了時まで `%TEMP%\CommentableUpdate-<ver>-<guid>\extracted\` に置かれたままになる。
  その間に同じユーザーで動く別のプログラムがすり替えると、確かめていない exe が入る
- 直し方（macOS 版の `UpdateChecker.swift` の `startInstaller` と同じ考え方）:
  - 入れ替える直前に、署名（`SatisfiesOwnSignature`）・バージョン・ハッシュをもう一度確かめる。
    確かめるときは `FileShare.Read`（書き込み・削除を許さない）で開いたまま行う
  - 入れ替えたあと、一時フォルダ（zip と展開したファイル）を削除する

### 6.（低）Authenticode の確認を強める
- 場所: `Sources/UpdateChecker.cs:198-203, 409, 426`
- `WTD_REVOKE_NONE` だと、失効した（盗まれた）署名用の証明書でも受け付けてしまう。`WTD_REVOKE_WHOLECHAIN` にする（オフラインで確認できないときの扱いも決める）
- 発行者を `Subject` の文字列だけで比べているので、証明書の公開鍵（またはサムプリント）でも確かめる
- 今の exe が署名済みで、GitHub のハッシュ（digest）がない場合は署名だけで受け付けている。
  これでよいが、`README.md` の 72 行目付近の「ハッシュが必ず一致すること」という説明と合わせる

### 7.（低）署名用のシークレットを release 環境に登録する手順にする
- 場所: `windows/README.md:43-47`（`gh secret set WINDOWS_CERTIFICATE_PFX` などが `--env` なし）
- GitHub Actions は、リリースのジョブを「release」環境（承認が必要・master のみ）で動かすように変えてあります。
  リポジトリ全体のシークレットは承認なしでどのワークフローからでも読めるので、README の手順を `--env release` 付きに直してください
  ```
  gh secret set WINDOWS_CERTIFICATE_PFX --env release < certificate.pfx.base64
  gh secret set WINDOWS_CERTIFICATE_PASSWORD --env release
  ```
  （macOS 版の `macos/README.md` の手順も参考に。リポジトリ全体に登録したものがあれば削除する）

### 8.（低）授業ログの保存で、授業回 ID の確認が .NET では甘い
- 場所: `Sources/LogArchiver.cs:20-21`
- .NET の `\d` は全角などの数字にも一致し、`$` は末尾の改行の前にも一致する。`^[0-9]{8}-[0-9]{6}\z` にする
  （部屋名はハッシュ付きの英数字に変換しているので、パスの細工はできない）

### 9.（低）リリースページを開くときに URL を確かめていない
- 場所: `Sources/UpdateChecker.cs:354`
- GitHub の API から受け取った URL をそのまま `Shell.Open` している。`https://github.com/` で始まるときだけ開き、そうでなければ決まったリリースページを開く

### 10.（参考）キャプチャのスレッドでの例外でアプリが終了する
- 場所: `Sources/WindowCapture.cs`（`FrameArrived`、`sender.Recreate`）、`Sources/CameraController.cs:245`（`SoftwareBitmap.Convert`）
- 参加者からは起こせないが、これらの処理を `try / catch` で囲んでおく

## 問題がなかったところ（直さなくてよい）
- 効果音の番号: `(int)double` は例外にならず、`IsValidSoundID` で範囲を確かめている
- 配信者の鍵: `%APPDATA%\commentable-desktop\host-keys.json` に一時ファイルから置き換えて書いており、他のユーザーからは読めない。鍵とトークンはログに出していない
- 自動アップデート: 決まったリポジトリから HTTPS で取得、下書き・プレリリースは除外、古い版には戻さない、zip の展開はパスの細工を防いでいる、入れ替えにスクリプトを使っていない
- コメントの色・向き・大きさの確認、通常のコメントの同時表示の上限（50 件）、`hidden >= 1` を表示しないこと
- ワークフロー（`.github/workflows/windows.yml`）: SHA で固定したアクション、既定の権限は読み取りだけ、リリースのジョブは release 環境

## 確認のしかた
1. ローカルのサーバー（`PORT=3000 node server.js`）に接続して入室し、参加者として次のコメントを送る（ブラウザの投稿ページか、socket.io のクライアントから）
   - `=text(a, 1e999, 0.5)`、`=text(b, Infinity, -Infinity)`、`=text(c, NaN, 0.5)`
   - `=text(cmd0, 0.5, 0.5)` 〜 `=text(cmd24, 0.5, 0.5)` を続けて 25 件
   - `hidden: 100` で `=text(` + 長い文字列（数千文字）+ `, 0.5, 0.5)`
   - 読み上げをオンにしたコメントを大量に送り、途中でミュートにする
2. アプリが止まらず、そのあとに送った普通のコメントがすぐ表示され続けること、コマンドが同時に 20 件までしか出ないこと、ミュートで読み上げが止まることを確かめる
3. 確認に使った部屋のデータ（`logs/rooms.json` の登録、`logs/events/<部屋>`、`public/chatlogs/<部屋>.log`、`%APPDATA%\commentable-desktop\host-keys.json` の鍵）は削除する
4. 直したら `windows/VERSION` を上げてリリースする（release 環境での承認が必要）
