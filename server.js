var express = require('express');
var app = express();
var server = app.listen(3000);
app.use(express.static('../public'));
console.log("My socket server is runnning");
var socket = require('socket.io');
var io = socket(server);
io.sockets.on('connection', newConnection);

function newConnection(socket){
    console.log('new connection: ' + socket.id + '('+ socket.handshake.address + ')');
    socket.on('comment', commentMsg);
    function commentMsg(data){
        socket.broadcast.emit('comment', data);
        console.log(data);
    }
}