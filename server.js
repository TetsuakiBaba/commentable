var use_require_json = require('./api_key.json');
var key = use_require_json.key;
var port = process.env.PORT || 80;
var express = require('express');
var app = express();
var server = app.listen(port);
app.use(express.static('./public'));
let broadcaster;
var socket = require('socket.io');
const options = {
    serveClient: true
    //pingTimeout: 25000,
    //pingInterval: 5000,
    //transports: ['polling']
    //transports: ['websockets']
}
var io = socket(server, options);


io.on('connection', (socket) => {
    console.log('connection', socket);
    var addedUser = false;
    var addedMaster = false;
    var room = "";
    var room_master = "-master";
    var flg_deactivate_comment_control = false;
    var number_of_users = 0;

    socket.on("join", (room_to_join) => {
        if (room_to_join == "") room_to_join = "undefined-room"
        socket.join(room_to_join);
        console.log(socket.id, " joined to ", room_to_join);
        room = room_to_join;

        //var room_sockets = io.in(room)
        number_of_users = io.sockets.adapter.rooms[room].length;
        console.log("current Room: ", io.sockets.adapter.rooms);
        //var room_object = io.sockets.adapter.rooms[room];

        // we store the username in the socket session for this client
        socket.username = socket.id; //username;
        addedUser = true;
        socket.emit('login', {
            numUsers: number_of_users,
            deactivate_comment_control: io.sockets.adapter.rooms[room].flg_deactivate_comment_control
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
        console.log(socket.id, "joined master to ", room_to_join);
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
        // we tell the cli"ent to execute 'new message'
        socket.to(room).emit('comment', data);
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
            io.sockets.adapter.rooms[room].flg_deactivate_comment_control = flg_deactivate_comment_control;
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
        console.log(socket.id, " has been leaved from ", room);
    });
});