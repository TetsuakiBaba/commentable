# 配布用の Commentable-win32-<CPU>-<バージョン>.zip を作る（ローカルでも GitHub Actions でも使う）
#   1. x64 版と ARM 版をビルド
#   2. コード署名の証明書があれば署名（なくても作れるが、初回の起動時に SmartScreen の警告が出る）
#   3. build/Commentable-win32-x64-<バージョン>.zip と build/Commentable-win32-arm64-<バージョン>.zip を作る
#
# 環境変数（署名するとき。どちらか一方）:
#   WINDOWS_CERTIFICATE_PFX / WINDOWS_CERTIFICATE_PASSWORD  証明書（.pfx）のパスとパスワード
#   WINDOWS_CERTIFICATE_THUMBPRINT                          証明書ストアにある証明書の拇印
#   WINDOWS_TIMESTAMP_URL                                   タイムスタンプのサーバー（既定: http://timestamp.digicert.com）
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$version = (Get-Content VERSION -Raw).Trim()
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "VERSION の形式が正しくありません: $version" }

# ========== 署名の準備 ==========
$signArgs = $null
if ($env:WINDOWS_CERTIFICATE_PFX) {
    $signArgs = @('/f', $env:WINDOWS_CERTIFICATE_PFX, '/p', $env:WINDOWS_CERTIFICATE_PASSWORD)
} elseif ($env:WINDOWS_CERTIFICATE_THUMBPRINT) {
    $signArgs = @('/sha1', $env:WINDOWS_CERTIFICATE_THUMBPRINT)
}
$signtool = $null
if ($signArgs) {
    # Windows SDK の signtool.exe（いちばん新しいもの）
    $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    $signtool = Get-ChildItem $kits -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1
    if (-not $signtool) { throw 'signtool.exe が見つかりません（Windows SDK をインストールしてください）' }
}
$timestamp = if ($env:WINDOWS_TIMESTAMP_URL) { $env:WINDOWS_TIMESTAMP_URL } else { 'http://timestamp.digicert.com' }

Write-Host "==> Commentable $version を作ります（署名: $(if ($signArgs) { 'あり' } else { 'なし' })）"

foreach ($arch in 'x64', 'arm64') {
    # ========== ビルドと署名 ==========
    & (Join-Path $PSScriptRoot 'build.ps1') -Arch $arch -Distribution
    $exe = Join-Path $PSScriptRoot "build\$arch\Commentable.exe"
    if ($signArgs) {
        & $signtool.FullName sign @signArgs /fd SHA256 /tr $timestamp /td SHA256 /d Commentable $exe
        if ($LASTEXITCODE -ne 0) { throw '署名に失敗しました' }
        & $signtool.FullName verify /pa $exe
        if ($LASTEXITCODE -ne 0) { throw '署名を確認できませんでした' }
    }

    # ========== zip ==========
    $zip = Join-Path $PSScriptRoot "build\Commentable-win32-$arch-$version.zip"
    if (Test-Path $zip) { Remove-Item $zip -Force }
    Compress-Archive -Path $exe -DestinationPath $zip
    Write-Host "==> できました: $zip"
}
