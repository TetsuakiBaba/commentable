var api_key;
var socket;
var flg_sound_mute = true;
var sound;
var sound_chime;

var flg_chime;
var flg_clock;
var flg_noDraw;
var time_start;
var time_start_hour;
var time_start_minute;
var time_end;
var time_end_hour;
var time_end_minute;
var is_streaming = false;

var p5_captures;
var flg_speech;
let peerConnection;
const config = {
    iceServers: [{
        urls: ["stun:stun.l.google.com:19302"]
    }]
};


var color_text;
var color_text_stroke;
var capture;
var capture_screen;
var volume = 0.1;
var flash;

var speech;

function setup() {

    textFont("Noto Sans JP");

    color_text = document.getElementById("color_text").value;
    color_text_stroke = document.getElementById("color_text_stroke").value;

    //socket = io.connect('http://localhost');
    //socket = io.connect('https://commentable.lolipop.io')
    socket = io.connect(window.location.origin);

    // Tell the server your username
    socket.emit('add user', "vuser");

    socket.on('comment', newComment);
    socket.on('disconnect', () => {
        log('you have been disconnected');
    });
    // Whenever the server emits 'user joined', log it in the chat body
    socket.on('user joined', (data) => {
        log(data.username + ' joined');
        document.getElementById('text_number_of_joined').value = str(data.numUsers);
    });
    // Whenever the server emits 'user left', log it in the chat body
    socket.on('user left', (data) => {
        log(data.username + ' left');
        document.getElementById('text_number_of_joined').value = str(data.numUsers);
    });
    socket.on('reconnect', () => {
        log('you have been reconnected');
        socket.emit('add user', "vuser");
    });
    socket.on('login', (data) => {
        document.getElementById('text_number_of_joined').value = str(data.numUsers);
    });

    socket.on("offer", (id, description) => {

        peerConnection = new RTCPeerConnection(config);
        peerConnection
            .setRemoteDescription(description)
            .then(() => peerConnection.createAnswer())
            .then(sdp => peerConnection.setLocalDescription(sdp))
            .then(() => {
                socket.emit("answer", id, peerConnection.localDescription);
            });

        peerConnection.ontrack = event => { };
        peerConnection.onicecandidate = event => {
            if (event.candidate) {
                socket.emit("candidate", id, event.candidate);
            }
        };

    });

    socket.on("candidate", (id, candidate) => {
        peerConnection
            .addIceCandidate(new RTCIceCandidate(candidate))
            .catch(e => console.error(e));
    });

    socket.on("connect", () => {
        socket.emit("watcher", socket.id);

    });

    socket.on("broadcaster", () => {
        socket.emit("watcher", socket.id);
    });

    socket.on("stop streaming", () => {

    });

    socket.on("disconnectPeer", () => {
        peerConnection.close();
    });

    window.onunload = window.onbeforeunload = () => {
        socket.close();
    };


    select("#button_send").mouseClicked(pushedSendButton);
    select("#checkbox_speech").mouseClicked(toggleSpeech);
    select("#color_text").changed(changeTextColor);
    select("#color_text_stroke").changed(changeTextOutlineColor);


    select("#button_emoji_reaction_01").mouseClicked(sendEmojiReaction);
    select("#button_emoji_reaction_02").mouseClicked(sendEmojiReaction);
    select("#button_emoji_reaction_03").mouseClicked(sendEmojiReaction);
    select("#button_emoji_reaction_04").mouseClicked(sendEmojiReaction);


    select("#button_sound_reaction_00").mouseClicked(sendSoundReaction);
    select("#button_sound_reaction_01").mouseClicked(sendSoundReaction);
    select("#button_sound_reaction_02").mouseClicked(sendSoundReaction);
    select("#button_sound_reaction_03").mouseClicked(sendSoundReaction);
    select("#button_sound_reaction_04").mouseClicked(sendSoundReaction);
    select("#button_sound_reaction_05").mouseClicked(sendSoundReaction);
    select("#button_sound_reaction_06").mouseClicked(sendSoundReaction);
    select("#button_sound_reaction_07").mouseClicked(sendSoundReaction);
    select("#button_sound_reaction_08").mouseClicked(sendSoundReaction);
    select("#button_sound_reaction_09").mouseClicked(sendSoundReaction);


    select("#download_all_comments").mouseClicked(downloadAllComments);

    let params = getURLParams();
    if (params.name) {
        document.getElementById("text_my_name").value = decodeURIComponent(params.room);
    }

    noCanvas();
}


var count_comment = 0;

function newComment(data) {
    count_comment++;

    let comment_format = "[" + nf(year(), 4) + ":" + nf(month(), 2) + ":" + nf(day(), 2) + ":" + nf(hour(), 2) + ":" + nf(minute(), 2) + ":" + nf(second(), 2) + "-" + nf(count_comment, 4) + "] ";
    comment_format += data.comment;
    if (data.flg_sound == true) {
        comment_format += " [sound]";
    }

    comment_format += "[" + data.my_name + "]" + "\n";
    //here
    select("#textarea_comment_history").html(comment_format, true);
    var psconsole = $('#textarea_comment_history');
    psconsole.scrollTop(
        psconsole[0].scrollHeight - psconsole.height()
    );
}


function pushedSendButton() {
    sendComment(
        document.getElementById("text_comment").value, false,
        document.getElementById("text_my_name").value,
        false, 0,
        false, 0, -1);
}


// _hidden: 隠しコマンド、-1のときはなし、0以上がコマンドのidとなる。
function sendComment(_str_comment, _flg_emoji, _str_my_name, _flg_img, _id_img, _flg_sound, _id_sound, _hidden) {

    if (_flg_img == false) {
        if (_str_comment.length <= 0) {
            return;
        }
        if (_str_comment.length > 80) {
            alert("一度に遅れる文字数は80文字までです．");
            return;
        }
        var data = {
            key: api_key,
            my_name: _str_my_name,
            comment: _str_comment,
            flg_speech: flg_speech,
            color_text: color_text,
            color_text_stroke: color_text_stroke,
            flg_emoji: _flg_emoji,
            flg_image: false,
            id_image: 0,
            flg_sound: _flg_sound,
            id_sound: _id_sound,
            hidden: _hidden
        }
        if (_str_comment.length > 0) {
            socket.emit("comment", data);
        }

        newComment(data);
        clearTextBox();
    } else {
        var data = {
            room_name: _str_room_name,
            comment: "",
            flg_speech: flg_speech,
            color_text: color_text,
            color_text_stroke: color_text_stroke,
            flg_image: true,
            id_image: 0,
            flg_sound: _flg_sound,
            id_sound: _id_sound
        }
        socket.emit("comment", data);
        newComment(data);
    }

}


var is_control_pressed = false;

function keyReleased() {
    if (keyCode == CONTROL) {
        is_control_pressed = false;
    }
}

function keyPressed() {
    if (keyCode == CONTROL) {
        is_control_pressed = true;
    }
    if (key == "Enter") {
        let hidden = -1;
        if (is_control_pressed) {
            hidden = 0;
        }

        sendComment(
            document.getElementById("text_comment").value,
            false,
            document.getElementById("text_my_name").value,
            false, 0,
            false, 0,
            hidden
        );

    } else {

    }
}

function clearTextBox() {
    document.getElementById("text_comment").value = "";
}



function changeRoomName() {

}

function changeTextColor() {
    color_text = this.value();
}

function changeTextOutlineColor() {
    color_text_stroke = this.value();
}

function windowResized() {

}

function sendEmojiReaction() {
    sendComment(
        this.html(), true,
        document.getElementById("text_my_name").value,
        false, 0,
        false, 0, -1
    );
}

function sendSoundReaction() {
    var id_sound = this.attribute("value");
    sendComment(
        this.html(), false,
        document.getElementById("text_my_name").value,
        false, 0,
        true, id_sound, -1
    );
}


function changeVolume() {
    this.html("test", false);
    volume = this.value();
    if (volume == 0) {
        //console.log(this);
    }
}

function changeStreamVolume() {
    var element = document.getElementById("stream_video");
    element.volume = this.value();
}

function toggleSoundMute() {
    flg_sound_mute = !flg_sound_mute;
    // no sound
    if (flg_sound_mute == true) {
        this.html("&#x1f507;");
    }
    // with sound
    else {
        this.html("&#x1f508;");
    }
}

function toggleStreamMute() {
    print(this.value());
    // no sound
    if (this.value() == "true") this.value("false");
    else this.value("true");

    if (this.value() == "true") {
        this.html("&#x1f507;");
        // turn off broadcasting sound    
        if (is_streaming) {
            var element = document.getElementById("stream_video");
            element.muted = true;
        }
    }
    // with sound
    else {
        this.html("&#x1f508;");
        // turn on broadcasting sound
        if (is_streaming) {
            var element = document.getElementById("stream_video");
            element.muted = false;
        }
    }
}


var flg_camera_is_opened = false;

function toggleCamera() {
    if (flg_camera_is_opened == false) {
        flg_camera_is_opened = true;
        var videoSelect = document.querySelector("select#videoSource");
        console.log(videoSelect.value);
        p5_captures.openCamera(videoSelect.value);
        this.attribute('class', "btn btn-danger btn-sm");
    } else {
        flg_camera_is_opened = false;
        p5_captures.closeCamera();
        this.attribute('class', "btn btn-outline-secondary btn-sm");
    }
    resizeCanvas(windowWidth - 30, (windowWidth - 30) * 9.0 / 16.0);
}

function toggleChime() {
    print(this.checked());
    flg_chime = this.checked();
}

function toggleClock() {
    flg_clock = this.checked();
}

function toggleSpeech() {
    flg_speech = this.checked();
    if (flg_speech == true) {
        // set red button class
        //<div class="input-group-prepend"><button id="button_send" class="btn btn-outline-primary btn-sm"></button>
        document.getElementById('button_send').setAttribute('class', 'btn btn-outline-danger btn-sm');
    } else {
        // set normal(primary) button class
        document.getElementById('button_send').setAttribute('class', 'btn btn-outline-primary btn-sm');
    }
}

function toggleDraw() {
    flg_noDraw = this.checked();
    let canvas_element = document.getElementById("sketch-holder");
    if (flg_noDraw) {
        //noLoop();
        canvas_element.style.display = "none";
    } else {
        //loop();
        canvas_element.style.display = "block";
    }
}


function updateStartTime() {
    time_start = this.value();
    var tmp_time = time_start.split(":");
    time_start_hour = int(tmp_time[0]);
    time_start_minute = int(tmp_time[1]);
}

function updateEndTime() {
    time_end = this.value();
    var tmp = time_end.split(":");
    time_end_hour = int(tmp[0]);
    time_end_minute = int(tmp[1]);

}

function toggleScreenCapture() {
    if (!p5_captures.screen) {
        p5_captures.openScreen();
        this.attribute('class', "btn btn-danger btn-sm");
    }

    if (p5_captures.screen.c.loadedmetadata) {
        p5_captures.closeScreen();
        this.attribute('class', "btn btn-outline-secondary btn-sm");
    }
    resizeCanvas(windowWidth - 30, (windowWidth - 30) * 10.0 / 16.0);
}