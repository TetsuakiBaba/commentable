# Commentable.exe をビルドする
#   ./build.ps1               → build/x64/Commentable.exe（開発用。自動アップデートでの入れ替えはしない）
#   ./build.ps1 -Arch arm64   → ARM 版の Windows 向け
#   ./build.ps1 -Distribution → 配布用（package.ps1 が使う。自動アップデートで自分を入れ替える）
#
# .NET のランタイムも同梱した 1 つの exe になる（使う人は .NET をインストールしなくてよい）
# ビルドには .NET 8 SDK が必要
param(
    [ValidateSet('x64', 'arm64')]
    [string]$Arch = 'x64',
    [switch]$Distribution
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# バージョンは VERSION ファイルで管理する（リリースのタグは windows-v<VERSION>）
$version = (Get-Content VERSION -Raw).Trim()
$out = Join-Path $PSScriptRoot "build\$Arch"
$distributionFlag = if ($Distribution) { 'true' } else { 'false' }

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
dotnet publish Commentable.csproj --nologo -c Release -r "win-$Arch" -o $out "-p:CommentableDistribution=$distributionFlag"
if ($LASTEXITCODE -ne 0) { throw 'ビルドに失敗しました' }

# 配布するのは exe だけ（デバッグ情報は exe に埋め込んでいる）
Get-ChildItem $out -Exclude 'Commentable.exe' | Remove-Item -Recurse -Force

Write-Host "Built $out\Commentable.exe (version $version, $Arch)"
