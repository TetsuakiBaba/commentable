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

// Chatroom
var numUsers = 0;

var flg_deactivate_comment_control = false;

io.on('connection', (socket) => {
    console.log(socket.id);
    var addedUser = false;
    var addedMaster = false;

    // when the client emits 'new message', this listens and executes
    socket.on('new message', (data) => {
        // we tell the client to execute 'new message'
        socket.broadcast.emit('new message', {
            username: socket.username,
            message: data
        });
    });

    // when the client emits 'new message', this listens and executes
    socket.on('comment', (data) => {
        // we tell the cli"ent to execute 'new message'
        socket.broadcast.emit('comment', data);
    });

    socket.on('stop streaming', () => {
        socket.broadcast.emit('stop streaming');
    });

    socket.on('telop', (data) => {
        socket.broadcast.to('master').emit('telop', data);
    });

    socket.on('letter', (data) => {
        socket.broadcast.to('master').emit('letter', data);
    });

    socket.on('display_clock', (data) => {
        socket.broadcast.to('master').emit('display_clock', data);
    });

    socket.on('glitch_effect', (data) => {
        socket.broadcast.to('master').emit('glitch_effect', data);
    });

    socket.on('deactivate_comment_control', (data) => {
        flg_deactivate_comment_control = data.control;
        socket.broadcast.emit('deactivate_comment_control', data);
    });

    // when the client emits 'add user', this listens and executes
    socket.on('add user', (username) => {
        if (addedUser) return;

        // we store the username in the socket session for this client
        socket.username = socket.id; //username;

        ++numUsers;
        addedUser = true;
        socket.emit('login', {
            numUsers: numUsers,
            deactivate_comment_control: flg_deactivate_comment_control
        });
        // echo globally (all clients) that a person has connected
        socket.broadcast.emit('user joined', {
            username: socket.username,
            numUsers: numUsers
        });
    });

    // when a master emits 'add master'
    socket.on('add master', (username) => {
        socket.join('master');
    });

    // when the client emits 'typing', we broadcast it to others
    socket.on('typing', () => {
        socket.broadcast.emit('typing', {
            username: socket.username
        });
    });

    // when the client emits 'stop typing', we broadcast it to others
    socket.on('stop typing', () => {
        socket.broadcast.emit('stop typing', {
            username: socket.username
        });
    });


    socket.on("broadcaster", () => {
        broadcaster = socket.id;
        socket.broadcast.emit("broadcaster");
    });

    socket.on("watcher", () => {
        socket.to(broadcaster).emit("watcher", socket.id, numUsers);
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

        if (addedUser) {
            --numUsers;

            // echo globally that this client has left
            socket.broadcast.emit('user left', {
                username: socket.username,
                numUsers: numUsers
            });
            socket.to(broadcaster).emit("disconnectPeer", socket.id, numUsers);
        }
    });
});