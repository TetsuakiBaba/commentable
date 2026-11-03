#!/bin/bash
# ローカルのサーバーと macOS アプリをまとめて起動する（Ctrl+C でまとめて終了する）
#
#   ./dev.sh                 localhost のサーバーにアプリをつなぐ（部屋は test）
#   ./dev.sh --lan           LAN の IP アドレスでつなぐ（スマホや別の PC から QR コードで参加できる）
#   ./dev.sh --room 部屋名    部屋名を変える
#   ./dev.sh --no-app        アプリを起動せず、サーバーと投稿ページだけにする
#   ./dev.sh --fake          偽の参加者がコメントを流す（tools/fake-comments.js、細かい設定はそちらを直接使う）
#
# サーバーは node --watch で起動するので、server.js などを保存すると自動で再起動する
# （public/ のファイルはブラウザを再読み込みすれば反映される）
# アプリの接続先は環境変数 COMMENTABLE_SERVER_URL で渡すだけなので、本番用のアプリの設定は変わらない
set -eo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-3000}"
ROOM=test
LAN=0
APP=1
FAKE=0
while [ $# -gt 0 ]; do
    case "$1" in
        --lan) LAN=1 ;;
        --room) ROOM="${2:?部屋名を指定してください}"; shift ;;
        --no-app) APP=0 ;;
        --fake) FAKE=1 ;;
        -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "不明なオプション: $1（--help で使い方を表示）" >&2; exit 1 ;;
    esac
    shift
done

HOST=localhost
if [ $LAN = 1 ]; then
    HOST=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
    if [ -z "$HOST" ]; then
        echo "LAN の IP アドレスが見つかりません（Wi-Fi か有線 LAN につないでください）" >&2
        exit 1
    fi
fi
SERVER="http://$HOST:$PORT"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN > /dev/null 2>&1; then
    echo "ポート $PORT はすでに使われています（別のサーバーが動いていれば止めるか、PORT=3001 ./dev.sh のように変えてください）" >&2
    exit 1
fi
[ -d node_modules ] || npm install

# サーバーより先にビルドする（ビルドに失敗したらサーバーは起動しない）
if [ $APP = 1 ]; then
    (cd macos && ./build.sh)
fi

PIDS=""
cleanup() {
    trap - INT TERM EXIT
    [ -n "$PIDS" ] && kill $PIDS 2> /dev/null
    wait 2> /dev/null
    echo "終了しました"
}
trap cleanup INT TERM EXIT

PORT=$PORT node --watch server.js &
PIDS="$PIDS $!"
for _ in $(seq 50); do
    curl -s -o /dev/null "http://localhost:$PORT/" && break
    sleep 0.2
done

ROOM_QUERY=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$ROOM")
if [ $APP = 1 ]; then
    COMMENTABLE_SERVER_URL="$SERVER" macos/build/Commentable.app/Contents/MacOS/Commentable --room "$ROOM" &
    PIDS="$PIDS $!"
fi
open "$SERVER/?room=$ROOM_QUERY"
if [ $FAKE = 1 ]; then
    node tools/fake-comments.js --server "$SERVER" --room "$ROOM" &
    PIDS="$PIDS $!"
fi

echo
echo "サーバー:     $SERVER"
echo "投稿ページ:   $SERVER/?room=$ROOM_QUERY"
if [ $APP = 1 ]; then
    echo "ダッシュボード: アプリのメニュー「ダッシュボード」から開く"
fi
echo "Ctrl+C でまとめて終了します"
echo
wait
