#!/bin/bash
# 配布用の Commentable-darwin-universal-<バージョン>.zip を作る（ローカルでも GitHub Actions でも使う）
#   1. Apple Silicon / Intel 両対応版をビルドし、Developer ID で署名
#   2. Apple の公証（notarization）を受けて、結果をアプリに添付（staple）
#   3. build/Commentable-darwin-universal-<バージョン>.zip を作る
#
# 環境変数:
#   CODESIGN_IDENTITY  署名に使う証明書（既定: キーチェーンの最初の Developer ID Application）
#   公証の資格情報（どれか1つ）:
#     NOTARY_PROFILE                         notarytool store-credentials で保存した名前（既定: commentable-notary）
#     NOTARY_KEY / NOTARY_KEY_ID / NOTARY_ISSUER  App Store Connect API キー（.p8 のパス・キーID・Issuer ID）
#     APPLE_ID / APPLE_TEAM_ID / APPLE_APP_PASSWORD  Apple ID と App 用パスワード
#   SKIP_NOTARIZE=1    公証しない（署名の確認用。配布はできない）
set -euo pipefail

cd "$(dirname "$0")"
VERSION=$(tr -d '[:space:]' < VERSION)
APP="build/Commentable.app"
ZIP="build/Commentable-darwin-universal-$VERSION.zip"

fail() { echo "エラー: $*" >&2; exit 1; }

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "VERSION の形式が正しくありません: $VERSION"

if [ -z "${CODESIGN_IDENTITY:-}" ]; then
    CODESIGN_IDENTITY=$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: .*\)"/\1/p' | head -1)
fi
[ -n "$CODESIGN_IDENTITY" ] || fail "Developer ID Application の証明書が見つかりません"

# 公証に使う資格情報（notarytool に渡す引数）
if [ -n "${NOTARY_KEY:-}" ]; then
    NOTARY_ARGS=(--key "$NOTARY_KEY" --key-id "${NOTARY_KEY_ID:?NOTARY_KEY_ID がありません}" --issuer "${NOTARY_ISSUER:?NOTARY_ISSUER がありません}")
elif [ -n "${APPLE_ID:-}" ]; then
    NOTARY_ARGS=(--apple-id "$APPLE_ID" --team-id "${APPLE_TEAM_ID:?APPLE_TEAM_ID がありません}" --password "${APPLE_APP_PASSWORD:?APPLE_APP_PASSWORD がありません}")
else
    NOTARY_ARGS=(--keychain-profile "${NOTARY_PROFILE:-commentable-notary}")
fi
if [ -z "${SKIP_NOTARIZE:-}" ]; then
    xcrun notarytool history "${NOTARY_ARGS[@]}" > /dev/null 2>&1 \
        || fail "公証の資格情報を確認できませんでした（macos/README.md の「リリース」を参照）"
fi

echo "==> Commentable $VERSION を作ります（${CODESIGN_IDENTITY}）"

# ========== ビルドと署名 ==========
CODESIGN_IDENTITY="$CODESIGN_IDENTITY" ./build.sh universal
codesign --verify --strict --verbose=2 "$APP"
lipo -archs "$APP/Contents/MacOS/Commentable"

# ========== 公証 ==========
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"
if [ -n "${SKIP_NOTARIZE:-}" ]; then
    echo "==> 公証は省略しました（このアプリは配布できません）: $ZIP"
    exit 0
fi
echo "==> 公証を申請しています（数分かかります）"
xcrun notarytool submit "$ZIP" "${NOTARY_ARGS[@]}" --wait
xcrun stapler staple "$APP"
# staple のあとの確認は Apple のサーバーに問い合わせるので、通信が一時的に切れることがある（数回試す）
for attempt in 1 2 3; do
    xcrun stapler validate "$APP" && break
    [ "$attempt" = 3 ] && fail "公証の結果を確認できませんでした"
    echo "==> 公証の結果の確認に失敗したので、もう一度試します（$attempt 回目）"
    sleep 10
done
spctl --assess --type execute --verbose=2 "$APP"

# 公証の結果を添付したアプリで zip を作り直す
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"
echo "==> できました: $ZIP"
