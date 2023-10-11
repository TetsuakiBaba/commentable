var socket;
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

function testFunc() {
    alert("testFunc()")
}

function toggleQR(checked, position, room) {

    let qr_width;
    let qr_height;
    let qr_font_size;
    console.log(windowWidth, windowHeight);

    if (position == "none") {
        document.getElementById("QR_center").innerHTML = "";
        document.getElementById("QR_top_right").innerHTML = "";
        document.getElementById("QR_center").hidden = true;
        document.getElementById("QR_top_right").hidden = true;
        return;
    }
    else if (position == "center") {
        qr_width = qr_height = windowWidth / 3;
        qr_font_size = windowWidth / 150;
    }
    else if (position == "top_right") {
        qr_width = qr_height = windowWidth / 10;
        qr_font_size = windowWidth / 150;
    }
    const qrCode = new QRCodeStyling({
        "width": qr_width,
        "height": qr_height,
        "data": "https://commentable.fun/?room=" + encodeURI(room),
        "margin": qr_width / 15,
        "qrOptions": { "typeNumber": "0", "mode": "Byte", "errorCorrectionLevel": "Q" },
        "imageOptions": { "hideBackgroundDots": true, "imageSize": 0.4, "margin": 0 },
        "dotsOptions": { "type": "dots", "color": "#333333" },
        "backgroundOptions": { "color": "#ffffff" },
        "image": './images/commentable_logo_text.png',
        "dotsOptionsHelper": {
            "colorType": { "single": true, "gradient": false },
            "gradient": { "linear": true, "radial": false, "color1": "#6a1a4c", "color2": "#6a1a4c", "rotation": "0" }
        },
        "cornersSquareOptions": { "type": "dot", "color": "#333333" },
        "cornersSquareOptionsHelper": {
            "colorType": { "single": true, "gradient": false },
            "gradient": { "linear": true, "radial": false, "color1": "#333333", "color2": "#333333", "rotation": "0" }
        },
        "cornersDotOptions": { "type": "dot", "color": "#333333" },
        "cornersDotOptionsHelper": {
            "colorType": { "single": true, "gradient": false },
            "gradient": { "linear": true, "radial": false, "color1": "#333333", "color2": "#333333", "rotation": "0" }
        },
        "backgroundOptionsHelper": {
            "colorType": { "single": true, "gradient": false },
            "gradient": { "linear": true, "radial": false, "color1": "#ffffff", "color2": "#ffffff", "rotation": "0" }
        }
    });



    if (checked && position == "center") {
        document.getElementById("QR_center").innerHTML = "";
        document.getElementById("QR_top_right").innerHTML = "";
        qrCode.append(document.getElementById("QR_center"));
        document.getElementById("QR_center").hidden = false;
        document.getElementById("QR_top_right").hidden = true;
    }
    else if (checked && position == "top_right") {
        document.getElementById("QR_center").innerHTML = "";
        document.getElementById("QR_top_right").innerHTML = "";

        qrCode.append(document.getElementById("QR_top_right"));
        document.getElementById("QR_top_right").hidden = false;
        document.getElementById("QR_center").hidden = true;
    }
    else if (!checked && position == "center") {
        document.getElementById("QR_center").innerHTML = "";
        document.getElementById("QR_top_right").innerHTML = "";

        document.getElementById("QR_center").innerHTML = "";
        document.getElementById("QR_center").hidden = true;
        document.getElementById("QR_top_right").hidden = false;
    }
    else if (!checked && position == "top_right") {
        document.getElementById("QR_center").innerHTML = "";
        document.getElementById("QR_top_right").innerHTML = "";

        document.getElementById("QR_top_right").hidden = true;
        document.getElementById("QR_center").hidden = false;

    }
    //    document.querySelector('#QR').hidden = !document.querySelector('#QR').hidden;
}


class ProtofessionalEffect {
    constructor() {
        this.is_activating = false;
        this.effect_duration = 7000;
        this.sound = loadSound('./sounds/protofessional.mp3');
        this.volume = 0.5;
    }
    activate() {
        this.is_activating = true;
        this.timestamp = millis();
        if (flg_sound_mute == false) {
            this.sound.setVolume(this.volume);
            this.sound.play();
        }
    }
    setVolume(_volume) {
        this.volume = _volume;
    }
    setText(_interview_message) {
        this.interview_message = _interview_message;
    }
    draw() {

        if (this.is_activating == true &&
            (millis() - this.timestamp) < this.effect_duration) {
            let alpha = 255 * cos(radians(90 * (millis() - this.timestamp) / this.effect_duration));
            background(0, 0, 0, alpha);
            noStroke();
            fill(255, 255, 255, alpha);
            textSize(height / 20);
            textAlign(CENTER, CENTER);
            text(this.interview_message, width / 2, height / 2);

        } else {
            this.is_activating = false;
        }
    }
}

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
            // console.log(number);
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
function whileLoading(total) {
    //console.log('loaded: ', + total);
}



function preload() {


    let count_loaded = 0;
    for (var i = 0; i < max_number_of_comment; i++) {
        comments[i] = new Comment();
        comments[i].setLife(0);
    }
    // Load sound files
    sound_chime = loadSound('./sounds/chime.mp3', readyLoading(++count_loaded), null, whileLoading);
    sound = [
        [loadSound('./sounds/camera1.mp3', readyLoading(++count_loaded)),
        loadSound('./sounds/camera2.mp3', readyLoading(++count_loaded)),
        loadSound('./sounds/camera3.mp3', readyLoading(++count_loaded))],
        [loadSound('./sounds/clap1.mp3', readyLoading(++count_loaded)),
        loadSound('./sounds/clap2.mp3', readyLoading(++count_loaded)),
        loadSound('./sounds/clap3.mp3', readyLoading(++count_loaded)),
        loadSound('./sounds/clap4.mp3', readyLoading(++count_loaded)),
        loadSound('./sounds/clap5.mp3', readyLoading(++count_loaded)),
        loadSound('./sounds/clap6.mp3', readyLoading(++count_loaded)),
        loadSound('./sounds/clap7.mp3', readyLoading(++count_loaded)),
        loadSound('./sounds/clap8.mp3', readyLoading(++count_loaded))],
        loadSound('./sounds/cracker.mp3', readyLoading(++count_loaded)),
        loadSound('./sounds/kansei.mp3', readyLoading(++count_loaded)),
        loadSound('./sounds/he.wav', readyLoading(++count_loaded)),
        loadSound('./sounds/chottomatte.wav', readyLoading(++count_loaded)),
        loadSound('./sounds/OK.wav', readyLoading(++count_loaded)),
        loadSound('./sounds/punch.mp3', readyLoading(++count_loaded)),
        loadSound('./sounds/laugh3.mp3', readyLoading(++count_loaded)),
        [loadSound('./sounds/kusa00.mp3', readyLoading(++count_loaded)),
        loadSound('./sounds/kusa01.mp3', readyLoading(++count_loaded)),
        loadSound('./sounds/kusa02.mp3', readyLoading(++count_loaded)),
        loadSound('./sounds/kusa03.mp3', readyLoading(++count_loaded)),
        loadSound('./sounds/kusa04.mp3', readyLoading(++count_loaded)),
        loadSound('./sounds/kusa05.mp3', readyLoading(++count_loaded))]
    ]
    sound_dodon = loadSound('./sounds/dodon.mp3', readyLoading(++count_loaded));
    sound_drumroll = loadSound('./sounds/drumroll.mp3', readyLoading(++count_loaded));
    sound_dora = loadSound('./sounds/dora.mp3', readyLoading(++count_loaded));
    sound_deden = loadSound('./sounds/quiz.mp3', readyLoading(++count_loaded));
    sound_pingpong = loadSound('./sounds/seikai.mp3', readyLoading(++count_loaded));
    sound_chin = loadSound('./sounds/chin.mp3', readyLoading(++count_loaded));
    sound_kansei = loadSound('./sounds/kansei.mp3', readyLoading(++count_loaded));
    sound_applause = loadSound('./sounds/applause.mp3', readyLoading(++count_loaded));
    protofessional_effect = new ProtofessionalEffect();
}


function startSocketConnection(room) {

    //socket = io.connect('http://localhost');
    //socket = io.connect('https://commentable.lolipop.io')
    //socket = io.connect(window.location.origin);
    socket = io.connect('https://bbcommentable.herokuapp.com/');


    socket.on('you_are_connected', function () {
        // 部屋名を指定してジョインする．
        socket.emit('join', room);
    });

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
        socket.emit('join', room);
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


}
function setup() {

    textFont("Noto Sans JP");
    mycanvas = createCanvas(windowWidth, windowHeight);
    //console.log(windowWidth, windowHeight);
    document.getElementById("canvas_placeholder").append(mycanvas.elt);

    frameRate(30);
    flg_deactivate_comment_control = false;


    let params = getURLParams();
    if (params.name) {
    }

    timestamp_last_send = millis();
    //console.log(timestamp_last_send);
    textAlign(CENTER, CENTER);
    flash = new Flash();
    flg_sound_mute = false;

    // Execute loadVoices.
    speech = new p5.Speech();
    speech.setVolume(volume);

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

    protofessional_effect.draw();
    flash.draw();

}

function parseFunctionString(str) {
    // 関数呼び出しの正規表現パターン
    const pattern = /(\w+)\(([^)]*)\)/;
    const match = str.match(pattern);

    if (!match) return null; // 関数の形式でなければnullを返す

    const functionName = match[1];
    const argsString = match[2].trim();

    // 引数をコンマで分割し、余白を取り除く
    const args = argsString.split(',').map(arg => arg.trim());

    return {
        functionName: functionName,
        args: args
    };
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
        // protofessional
        if (data.hidden == 0) {
            let comment_format = "[" + nf(year(), 4) + ":" + nf(month(), 2) + ":" + nf(day(), 2) + ":" + nf(hour(), 2) + ":" + nf(minute(), 2) + ":" + nf(second(), 2) + "-" + nf(count_comment, 4) + "] ";
            comment_format += data.comment;
            comment_format += " [hidden]";
            comment_format += "[" + data.my_name + "]" + "\n";
            //here
            select("#textarea_comment_history").html(comment_format, true);
            protofessional_effect.setText(data.comment);
            protofessional_effect.setVolume(volume);
            protofessional_effect.activate();
        }

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
        // パーティクルに空きがあれば
        if (id >= 0) {
            comments[id].setLife(255);
            comments[id].setText(data.comment);
            textSize(abs((height / 20) * sin(0.5 * PI)));
            let text_width = textWidth(data.comment);
            // console.log(textWidth(data.comment));
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
    resizeCanvas(windowWidth, windowHeight);
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

function readyLoading(count_loaded) {
    //console.log(count_loaded);
    document.getElementById('p5_loading').innerHTML = str(count_loaded) + ' files loaded.';
}

function toggleCommentControl(checked) {
    var data = {
        key: 'dummy',
        control: checked
    }
    socket.emit('deactivate_comment_control', data);
}