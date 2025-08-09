const fs = require('fs');

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

var server = app.listen(port);
app.use(express.static('./public'));
let broadcaster;
var socket = require('socket.io');
const options = {
    serveClient: true,
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: false
    }
    //pingTimeout: 25000,
    //pingInterval: 5000,
    //transports: ['polling']
    //transports: ['websockets']
}
var io = socket(server, options);

function isExistFile(file) {
    try {
        fs.statSync(file);
        return true
    } catch (err) {
        if (err.code === 'ENOENT') return false
    }
}

function escapeForCSV(input) {
    if (/[",\n\t]/.test(input)) { // タブもエスケープの対象に追加
        input = '"' + input.replace(/"/g, '""') + '"';
    }
    return input;
}


io.on('connection', (socket) => {
    console.log('connection', socket.id);
    var room = "";
    var room_master = "-master";
    var flg_deactivate_comment_control = false;
    var number_of_users = 0;

    // 接続者に対してコネクションを作ったことを知らせるメッセージ
    socket.emit('you_are_connected');

    socket.on("join", (room_to_join) => {
        if (room_to_join == "") room_to_join = "undefined-room"
        socket.join(room_to_join);
        console.log(socket.id, " joined to ", room_to_join);
        room = room_to_join;

        const filepath = "public/chatlogs/" + room + ".csv";
        let timestamp;
        let today = new Date();
        if (isExistFile(filepath)) {
            const stats = fs.statSync(filepath);

            let d = new Date(stats.mtime);
            let past_h = ((today - d) / (1000 * 60 * 60));
            let past_s = ((today - d) / 1000);
            // 最終更新から24時間経過してればファイル内容は削除
            console.log("file timestamp: ", past_h);
            if (past_h > 24) {
                fs.unlinkSync(filepath);
                console.log("24 h over: deleted ", filepath);
            }
            //            console.log(past_h, past_s);
        }
        // no exit, let's create
        else {
            // const fs = require('fs');
            // fs.writeFileSync(filepath, '');
            // console.log('create: ', filepath);
        }
        // number_of_users = io.sockets.adapter.rooms[room].length;
        number_of_users = io.sockets.adapter.rooms.get(room).size;
        console.log(number_of_users)

        // we store the username in the socket session for this client
        socket.username = socket.id; //username;
        socket.emit('login', {
            numUsers: number_of_users,
            deactivate_comment_control: io.sockets.adapter.rooms.get(room).flg_deactivate_comment_control
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
        // 全員に送信
        socket.to(room).emit('comment', data);

        // ログを書き込む 現在は textableも使わないので、コメントアウトしちゃう
        // const filepath = "public/chatlogs/" + room + ".csv";
        // let timestamp;
        // let today = new Date();
        // timestamp = today;
        // fs.appendFileSync(filepath, `${timestamp},${escapeForCSV(data.my_name)},${escapeForCSV(data.name_to)},${escapeForCSV(data.comment)},${data.id_comment},${data.flg_emoji},${data.flg_sound},${data.flg_speech},${socket.id}\n`);
        // console.log(data.comment);
    });

    socket.on('delete comment', (data) => {
        socket.to(room).emit('delete comment', data);
        //console.log(data);
        // data.id の当たるCSVの行を削除する
        const filepath = "public/chatlogs/" + room + ".csv";
        let records = [];
        if (isExistFile(filepath)) {
            const csvs = fs.readFileSync(filepath, 'utf-8');
            let rows = csvs.split('\n');
            for (row of rows) {
                let cols = row.split(',');
                if (cols.length == 5) {
                    if (cols[4] == data.id) {

                    }
                    else {
                        records.push(row);
                    }
                }
            }
            fs.unlinkSync(filepath);
            for (record of records) {
                fs.appendFileSync(filepath, `${record}\n`);
            }
        }
        else {
            console.log("Error: no such file, ", filepath);
        }
    });

    socket.on('stop streaming', () => {
        socket.to(room_master).emit('stop streaming');
    });

    socket.on('telop', (data) => {
        socket.to(room_master).emit('telop', data);
    });

    socket.on('letter', (data) => {
        socket.to(room_master).emit('letter', data);
    });

    socket.on('display_clock', (data) => {
        socket.to(room_master).emit('display_clock', data);
    });

    socket.on('glitch_effect', (data) => {
        socket.to(room_master).emit('glitch_effect', data);
    });
    socket.on('toggleQR', (data) => {
        socket.to(room_master).emit('toggleQR', data);
    });


    socket.on('deactivate_comment_control', (data) => {
        if (room == "") {
            // 部屋名が初期値のままの場合(join接続されていない）は無視

        }
        else {
            flg_deactivate_comment_control = data.control;
            socket.to(room).emit('deactivate_comment_control', data);
            io.sockets.adapter.rooms.get(room).flg_deactivate_comment_control = flg_deactivate_comment_control;
        }

    });


    socket.on("broadcaster", () => {
        broadcaster = socket.id;
        socket.broadcast.emit("broadcaster");
    });

    socket.on("watcher", () => {
        socket.to(broadcaster).emit("watcher", socket.id, number_of_users);
    });
    socket.on("offer", (id, message) => {
        socket.to(id).emit("offer", socket.id, message);
    });
    socket.on("answer", (id, message) => {
        socket.to(id).emit("answer", socket.id, message);
    });
    socket.on("candidate", (id, message) => {
        socket.to(id).emit("candidate", socket.id, message);
    });

    // when the user disconnects.. perform this
    socket.on('disconnect', () => {

        number_of_users--;

        // echo globally that this client has left
        socket.to(room).emit('user left', {
            username: socket.username,
            numUsers: number_of_users
        });
        socket.to(broadcaster).emit("disconnectPeer", socket.id, number_of_users);
        socket.leave(room);
        //console.log(socket.id, " has been leaved from ", room);
    });
});