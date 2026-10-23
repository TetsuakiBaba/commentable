# Windows 版を GitHub に下書きリリースする（GitHub Actions の windows.yml からも使う）
#   package.ps1 で zip を作り、windows-v<VERSION> の下書きリリースとしてアップロードする
# 下書きは GitHub のリリースページで内容を確認してから公開する
#
# 署名の環境変数は package.ps1 を参照
#   ALLOW_DIRTY=1  コミットしていない変更があってもリリースする（ローカルのみ）
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$version = (Get-Content VERSION -Raw).Trim()
$tag = "windows-v$version"

# ========== 確認 ==========
$commit = (git rev-parse HEAD).Trim()
if (-not $env:GITHUB_ACTIONS) {
    # GitHub Actions では push 済みのコミットを取り出しているので確認しない
    if (-not $env:ALLOW_DIRTY -and (git status --porcelain -- .)) {
        throw 'windows/ にコミットしていない変更があります（ALLOW_DIRTY=1 で無視）'
    }
    if (-not (git branch -r --contains $commit 2>$null)) { throw '現在のコミットを GitHub に push してください' }
}

gh release view $tag *> $null
if ($LASTEXITCODE -eq 0) { throw "リリース $tag はすでにあります。VERSION を上げてください" }

# ========== ビルド・署名 ==========
& (Join-Path $PSScriptRoot 'package.ps1')

# ========== リリース ==========
$notes = @"
## Commentable $version（Windows）

Windows 10（バージョン 2004 以降）/ Windows 11

### インストール
1. お使いの PC に合わせて zip をダウンロードして展開します（ほとんどの PC は ``Commentable-win32-x64-$version.zip``、ARM の PC は ``Commentable-win32-arm64-$version.zip``）
2. ``Commentable.exe`` を好きな場所（例: ``ドキュメント`` や ``%LOCALAPPDATA%\Programs\Commentable``）に置いて起動します（すでにある場合は入れ替えます）
3. 「Windows によって PC が保護されました」と表示されたときは、「詳細情報」→「実行」を選びます

以降の新しいバージョンは、アプリの自動アップデートで入れ替わります。配信者の鍵は Electron 版と同じ場所・同じ形式で保存するので、同じ部屋でそのまま配信できます。
"@
# このバージョンの変更点（windows/release-notes/<VERSION>.md）があれば加える
$releaseNotes = Join-Path $PSScriptRoot "release-notes\$version.md"
if (Test-Path $releaseNotes) {
    $notes += "`n`n" + (Get-Content $releaseNotes -Raw -Encoding UTF8)
}

# macOS 版のダウンロードのリンク（releases/latest）が変わらないように、「最新のリリース」にはしない
gh release create $tag `
    "build/Commentable-win32-x64-$version.zip" `
    "build/Commentable-win32-arm64-$version.zip" `
    --draft `
    --latest=false `
    --target $commit `
    --title "Commentable $version（Windows）" `
    --notes $notes
if ($LASTEXITCODE -ne 0) { throw 'リリースを作成できませんでした' }

Write-Host "==> 下書きリリース $tag を作成しました。GitHub のリリースページで確認して公開してください（「Set as the latest release」は外したままにします）"
