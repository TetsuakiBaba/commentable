#!/bin/bash
# Commentable.app をビルドする
#   ./build.sh            → build/Commentable.app（このMacのCPU向け）
#   ./build.sh universal  → Apple Silicon / Intel 両対応
#
# 署名は既定でアドホック署名。配布する場合は Developer ID を指定する（release.sh が指定する）:
#   CODESIGN_IDENTITY="Developer ID Application: ..." ./build.sh universal
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"
APP="$ROOT/build/Commentable.app"

# バージョンは VERSION ファイルで管理する（リリースのタグも v<VERSION> になる）
VERSION=$(tr -d '[:space:]' < VERSION)
YEAR=$(date +%Y)

if [ "${1:-}" = "universal" ]; then
    swift build -c release --arch arm64 --arch x86_64
    BIN="$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)/Commentable"
else
    swift build -c release
    BIN="$(swift build -c release --show-bin-path)/Commentable"
fi

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Commentable"
sed -e "s/__VERSION__/$VERSION/g" -e "s/__YEAR__/$YEAR/g" Info.plist > "$APP/Contents/Info.plist"

# 効果音・画像・アイコン
cp -R Resources/sounds Resources/images Resources/icon.icns "$APP/Contents/Resources/"

# Dropbox などが付ける拡張属性があると署名できない
xattr -cr "$APP"

if [ -n "${CODESIGN_IDENTITY:-}" ]; then
    codesign --force --sign "$CODESIGN_IDENTITY" --options runtime --timestamp --entitlements Commentable.entitlements "$APP"
else
    codesign --force --sign - --options runtime --entitlements Commentable.entitlements "$APP"
fi

echo "Built $APP (version $VERSION)"
