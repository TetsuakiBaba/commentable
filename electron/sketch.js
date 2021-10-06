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

var timestamp_last_send

var flg_speech;
var flg_deactivate_comment_control;
let peerConnection;

var color_text;
var color_text_stroke;
var volume = 0.1;
var flash;

var speech;
var mycanvas;
var max_number_of_comment = 50;

class Comment {
    constructor() {
        this.x = random(100);
        this.y = random(100);
        this.text = "test";
        this.alpha = random(100);
        this.life = 1; // 0 - 255
        this.size = 72.0;
        this.flg_img = false;
        this.volume = 0.1;

    }
    setColor(_color_text, _color_text_stroke) {
        this.color_text = _color_text;
        this.color_text_stroke = _color_text_stroke;
    }
    setLife(_life) {
        this.life = _life;
    }
    getLife() {
        return this.life;
    }
    setText(_text) {
        this.text = _text;
        return;
    }
    setX(_x) {
        this.x = _x;
    }
    setY(_y) {
        this.y = _y;
    }
    useImage(_id) {
        this.flg_img = true;
    }
    setVolume(_volume) {
        this.volume = _volume;
    }
    playSound() {

        if (sound[this.id_sound].length > 1) {
            let number = int(random(sound[this.id_sound].length));
            sound[this.id_sound][number].setVolume(this.volume);
            sound[this.id_sound][number].play();
        } else {
            sound[this.id_sound].setVolume(this.volume);
            sound[this.id_sound].play();
        }
    }
    update() {
        if (this.life > 0) {
            this.alpha = this.life;
            this.size = abs((height / 20) * sin(0.5 * PI * this.life / 255.0));
            this.life = this.life - 1;
            if (this.life == 0) {
                this.flg_img = false;
            }
        }
        return;
    }
    draw() {

        if (this.flg_img == false) {
            textSize(this.size);
            strokeWeight(5.0 * this.alpha / 255.0);
            stroke(this.color_text_stroke + str(hex(this.alpha, 2)));
            fill(this.color_text + str(hex(this.alpha, 2)));
            text(this.text, this.x, this.y);
        } else {
            //imageMode(CENTER);
            //image(this.img[0],this.x, this.y, this.img[0].width*this.alpha/255, this.img[0].height*this.alpha/255);
        }
        return;
    }
}
var comments = []; //new Array(50);
function preload() {
    for (var i = 0; i < max_number_of_comment; i++) {
        comments[i] = new Comment();
        comments[i].setLife(0);
    }
}
function setup() {

    textFont("Noto Sans JP");
    mycanvas = createCanvas(windowWidth, windowHeight - 200);
    console.log(windowWidth, windowHeight);
    document.getElementById("canvas_placeholder").append(mycanvas.elt);

    frameRate(30);
    flg_deactivate_comment_control = false;

    //socket = io.connect('http://localhost');
    //socket = io.connect('https://commentable.lolipop.io')
    //socket = io.connect(window.location.origin);
    socket = io.connect('https://bbcommentable.herokuapp.com');

    // Tell the server your username
    socket.emit('add user', "vuser");

    socket.on('comment', newComment);
    socket.on('disconnect', () => {
        log('you have been disconnected');
    });
    // Whenever the server emits 'user joined', log it in the chat body
    socket.on('user joined', (data) => {
        log(data.username + ' joined');
    });
    // Whenever the server emits 'user left', log it in the chat body
    socket.on('user left', (data) => {
        log(data.username + ' left');
    });
    socket.on('reconnect', () => {
        log('you have been reconnected');
        socket.emit('add user', "vuser");
    });
    socket.on('login', (data) => {
    });
    socket.on('deactivate_comment_control', (data) => {
    });

    socket.on("disconnectPeer", () => {
        peerConnection.close();
    });

    window.onunload = window.onbeforeunload = () => {
        socket.close();
    };


    let params = getURLParams();
    if (params.name) {
    }

    timestamp_last_send = millis();
    console.log(timestamp_last_send);
    textAlign(CENTER, CENTER);
}

function draw() {
    clear();
    background(0, 0, 0, 0);


    for (var i = 0; i < max_number_of_comment; i++) {
        if (comments[i].getLife() > 0) {
            comments[i].update();
            comments[i].draw();
        }
    }
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

    // 隠しコマンド
    if (data.hidden >= 0) {
        let comment_format = "[" + nf(year(), 4) + ":" + nf(month(), 2) + ":" + nf(day(), 2) + ":" + nf(hour(), 2) + ":" + nf(minute(), 2) + ":" + nf(second(), 2) + "-" + nf(count_comment, 4) + "] ";
        comment_format += data.comment;
        comment_format += " [hidden]";
        comment_format += "[" + data.my_name + "]" + "\n";
        //here
        select("#textarea_comment_history").html(comment_format, true);
        var psconsole = $('#textarea_comment_history');
        psconsole.scrollTop(
            psconsole[0].scrollHeight - psconsole.height()
        );
        protofessional_effect.setText(data.comment);
        protofessional_effect.setVolume(volume);
        protofessional_effect.activate();
    } else if (data.flg_image == false) {
        let id = -1;
        if (data.comment.length <= 0) {
            return;
        }
        for (var i = 0; i < max_number_of_comment; i++) {
            if (comments[i].getLife() == 0) {
                id = i;
                i = max_number_of_comment;
            }
        }
        if (id >= 0) {
            comments[id].setLife(255);
            comments[id].setText(data.comment);
            textSize(abs((height / 20) * sin(0.5 * PI)));
            let text_width = textWidth(data.comment);
            console.log(textWidth(data.comment));
            if (text_width < width) {
                comments[id].setX(random(text_width / 2, width - text_width / 2));
            }
            else {
                comments[id].setX(text_width / 2);
            }
            comments[id].setY(random(100, height - 100));
            comments[id].setColor(data.color_text, data.color_text_stroke);
            comments[id].flg_image = data.flg_img;
            comments[id].id_image = data.id_img;
            comments[id].flg_sound = data.flg_sound;
            comments[id].id_sound = data.id_sound;

            if (data.flg_sound == true && data.id_sound == 0) { // camera
                flash.do();
            }
            if (data.flg_sound == true && flg_sound_mute == false) {
                comments[id].setVolume(volume);
                comments[id].playSound();
            }
            if (data.flg_speech == true && data.flg_sound == false && data.flg_emoji == false && flg_sound_mute == false) {
                speech.speak(data.comment, volume);
            }
        }

        let comment_format = "[" + nf(year(), 4) + ":" + nf(month(), 2) + ":" + nf(day(), 2) + ":" + nf(hour(), 2) + ":" + nf(minute(), 2) + ":" + nf(second(), 2) + "-" + nf(count_comment, 4) + "] ";
        comment_format += data.comment;
        if (data.flg_sound == true) {
            comment_format += " [sound]";
        }

        comment_format += "[" + data.my_name + "]" + "\n";
    } else { // image reaction
        for (var i = 0; i < max_number_of_comment; i++) {
            if (comments[i].getLife() == 0) {
                id = i;
                i = max_number_of_comment;
            }
        }
        if (id >= 0) {
            comments[id].setLife(255);
            comments[id].setX(random(100, width - 100));
            comments[id].setY(random(100, height - 100));
            comments[id].useImage(0);
        }

    }


}

function windowResized() {

}

function changeVolume() {
    this.html("test", false);
    volume = this.value();
    if (volume == 0) {
        //console.log(this);
    }
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


function toggleSpeech() {
    flg_speech = this.checked();
    if (flg_speech == true) {
        // set red button class
        //<div class="input-group-prepend"><button id="button_send" class="btn btn-outline-primary btn-sm"></button>
        //document.getElementById('button_send').setAttribute('class', 'btn btn-outline-danger btn-sm');
    } else {
        // set normal(primary) button class
        //document.getElementById('button_send').setAttribute('class', 'btn btn-outline-primary btn-sm');
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

