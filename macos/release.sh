#!/bin/bash
# macOS 版を GitHub に下書きリリースする（GitHub Actions の macos.yml からも使う）
#   package.sh で署名・公証した zip を作り、v<VERSION> の下書きリリースとしてアップロードする
# 下書きは GitHub のリリースページで内容を確認してから公開する
#
# 公証の資格情報などの環境変数は package.sh を参照
#   ALLOW_DIRTY=1  コミットしていない変更があってもリリースする（ローカルのみ）
set -euo pipefail

cd "$(dirname "$0")"
VERSION=$(tr -d '[:space:]' < VERSION)
TAG="v$VERSION"
ZIP="build/Commentable-darwin-universal-$VERSION.zip"

fail() { echo "エラー: $*" >&2; exit 1; }

# ========== 確認 ==========
COMMIT=$(git rev-parse HEAD)
if [ -z "${GITHUB_ACTIONS:-}" ]; then
    # GitHub Actions では push 済みのコミットを取り出しているので確認しない
    if [ -z "${ALLOW_DIRTY:-}" ] && [ -n "$(git status --porcelain -- .)" ]; then
        fail "macos/ にコミットしていない変更があります（ALLOW_DIRTY=1 で無視）"
    fi
    [ -n "$(git branch -r --contains "$COMMIT" 2>/dev/null)" ] || fail "現在のコミットを GitHub に push してください"
fi

if gh release view "$TAG" > /dev/null 2>&1; then
    fail "リリース $TAG はすでにあります。VERSION を上げてください"
fi

# ========== ビルド・署名・公証 ==========
./package.sh

# ========== リリース ==========
NOTES="## Commentable ${VERSION}（macOS）

macOS 12 Monterey 以降（Apple Silicon / Intel）

### インストール
1. \`Commentable-darwin-universal-$VERSION.zip\` をダウンロードして展開します
2. \`Commentable.app\` をアプリケーションフォルダに移動して起動します（すでにある場合は入れ替えます）

Electron 版（commentable-desktop）を使っている場合は、自動アップデートでこのバージョンに入れ替わります。配信者の鍵は Electron 版と共有しているので、同じ部屋でそのまま配信できます。"
# このバージョンの変更点（macos/release-notes/<VERSION>.md）があれば加える
if [ -f "release-notes/$VERSION.md" ]; then
    NOTES="$NOTES

$(cat "release-notes/$VERSION.md")"
fi

gh release create "$TAG" "$ZIP" \
    --draft \
    --target "$COMMIT" \
    --title "Commentable ${VERSION}（macOS）" \
    --notes "$NOTES" \
    --generate-notes

echo "==> 下書きリリース $TAG を作成しました。GitHub のリリースページで確認して公開してください"
