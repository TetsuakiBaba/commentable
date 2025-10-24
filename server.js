const fs = require('fs');
const path = require('path');

// コメントログファイルのパス
const LOG_DIR = path.join(__dirname, 'public', 'chatlogs');

// ログディレクトリが存在しない場合は作成
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    console.log('Created log directory:', LOG_DIR);
}

// ファイル名として安全な文字列に変換する関数
function sanitizeFilename(str) {
    // 英数字、ハイフン、アンダースコア以外を置換
    return str.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// コメントをログファイルに追記する関数
function saveCommentLog(data, room) {
    try {
        if (!room) {
            console.warn('Room name is empty, skipping log save');
            return;
        }

        // room名をファイル名として安全な形式に変換
        const safeRoomName = sanitizeFilename(room);
        const logFile = path.join(LOG_DIR, `${safeRoomName}.log`);

        const timestamp = new Date().toISOString();
        const logEntry = JSON.stringify({
            timestamp,
            room,
            username: data.my_name || 'Anonymous',
            comment: data.comment,
            emoji: data.flg_emoji || false,
            sound: data.flg_sound || false,
            socketid: data.socketid
        });

        // ログファイルに追記（1行ずつ）
        fs.appendFileSync(logFile, logEntry + '\n', 'utf8');
    } catch (error) {
        console.error('Error saving comment log:', error);
    }
}

// ローカル開発環境では3000番ポート、本番環境では80番ポート
var port = process.env.PORT || (process.env.NODE_ENV === 'production' ? 80 : 3000);
var express = require('express');
var app = express();

// CORS設定
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

var server = app.listen(port, () => console.log('listening on', port));

app.use(express.static('./public'));

let broadcaster;
var socket = require('socket.io');
const options = {
    serveClient: true,
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: false
    },
    pingInterval: 15000, // サーバからのping間隔（ミリ秒）
    pingTimeout: 10000   // pongが返らなければ切断（ミリ秒）
    //pingTimeout: 25000,
    //pingInterval: 5000,
    //transports: ['polling']
    //transports: ['websockets']
}
var io = socket(server, options);

// ルームごとの状態を保持するためのメタデータ格納オブジェクト
// roomState[roomName] = { deactivate_comment_control: boolean }
const roomState = {};

function getRoomUserCount(roomName) {
    const roomRef = io.sockets.adapter.rooms.get(roomName);
    return roomRef ? roomRef.size : 0;
}


io.on('connection', (socket) => {
    console.log('connection', socket.id);
    var room = "";
    var room_master = "-master";
    // ルームの制御フラグは roomState に集約（ソケット毎に保持しない）

    // 接続者に対してコネクションを作ったことを知らせるメッセージ
    socket.emit('you_are_connected');

    socket.on("join", (room_to_join) => {
        if (room_to_join == "") room_to_join = "undefined-room"
        socket.join(room_to_join);
        console.log(socket.id, " joined to ", room_to_join);
        room = room_to_join;

        // ルーム状態初期化
        if (!roomState[room]) {
            roomState[room] = { deactivate_comment_control: false };
        }

        const number_of_users = getRoomUserCount(room);
        console.log('user count (join):', number_of_users);

        // we store the username in the socket session for this client
        socket.username = socket.id; //username;
        socket.emit('login', {
            numUsers: number_of_users,
            deactivate_comment_control: roomState[room].deactivate_comment_control
        });
        // echo globally (all clients) that a person has connected
        socket.to(room).emit('user joined', {
            username: socket.username,
            numUsers: number_of_users
        });

    });
    socket.on("join-as-master", (room_to_join) => {
        if (room_to_join == "") room_to_join = "undefined-room"
        socket.join(room_to_join);
        //console.log(socket.id, "joined master to ", room_to_join);
        room_master = room_to_join;
    });

    // when the client emits 'new message', this listens and executes
    socket.on('new message', (data) => {
        // we tell the client to execute 'new message'
        socket.to(room).emit('new message', {
            username: socket.username,
            message: data
        });
    });




    // when the client emits 'new message', this listens and executes
    socket.on('comment', (data) => {
        // we tell the client to execute 'new message'
        data.socketid = socket.id;

        // コメントをログファイルに保存
        saveCommentLog(data, room);

        // 全員に送信
        socket.to(room).emit('comment', data);
    });

    socket.on('delete comment', (data) => {
        socket.to(room).emit('delete comment', data);
    });

    socket.on('letter', (data) => {
        socket.to(room_master).emit('letter', data);
    });


    socket.on('deactivate_comment_control', (data) => {
        if (room === "") {
            return; // join 前は無視
        }
        if (!roomState[room]) {
            roomState[room] = { deactivate_comment_control: false };
        }
        roomState[room].deactivate_comment_control = data.control;
        socket.to(room).emit('deactivate_comment_control', data);
    });

    // when the user disconnects.. perform this
    socket.on('disconnect', () => {
        // disconnect イベント時点ではアダプタから既に除去されているので再計算
        const number_of_users = getRoomUserCount(room);
        socket.to(room).emit('user left', {
            username: socket.username,
            numUsers: number_of_users
        });
        socket.to(broadcaster).emit("disconnectPeer", socket.id, number_of_users);
        // 明示的 leave は不要（Socket.IO が処理）
    });
});