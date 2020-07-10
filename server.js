var use_require_json = require('./api_key.json');
var key = use_require_json.key;

var express = require('express');
var app = express();
var server = app.listen(80);
app.use(express.static('./public'));
//console.log("My socket server is runnning");
var socket = require('socket.io');
const options = {
    serveClient: true,
    pingTimeout: 30000,
    pingInterval: 5000
    // transports: ['polling']
}
var io = socket(server, options);
//io.sockets.on('connection', newConnection);

/*
function newConnection(socket) {
    //console.log('new connection: ' + socket.id + '('+ socket.handshake.address + ')');
    socket.on('comment', commentMsg);
    function commentMsg(data) {
        if (data.key == key) {
            socket.broadcast.emit('comment', data);
        }
    }
}
*/

// Chatroom
var numUsers = 0;

io.on('connection', (socket) => {
    var addedUser = false;
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
        // we tell the client to execute 'new message'
        socket.broadcast.emit('comment', data);
    });

    // when the client emits 'add user', this listens and executes
    socket.on('add user', (username) => {
        if (addedUser) return;

        // we store the username in the socket session for this client
        socket.username = socket.id;//username;
        ++numUsers;
        addedUser = true;
        socket.emit('login', {
            numUsers: numUsers
        });
        // echo globally (all clients) that a person has connected
        socket.broadcast.emit('user joined', {
            username: socket.username,
            numUsers: numUsers
        });
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

    // when the user disconnects.. perform this
    socket.on('disconnect', () => {

        if (addedUser) {
            --numUsers;

            // echo globally that this client has left
            socket.broadcast.emit('user left', {
                username: socket.username,
                numUsers: numUsers
            });
        }
    });
});

