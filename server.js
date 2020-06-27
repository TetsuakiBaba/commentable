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
io.sockets.on('connection', newConnection);

function newConnection(socket){
    //console.log('new connection: ' + socket.id + '('+ socket.handshake.address + ')');
    socket.on('comment', commentMsg);
    function commentMsg(data){
        socket.broadcast.emit('comment', data);
        //console.log(data);
    }
} 