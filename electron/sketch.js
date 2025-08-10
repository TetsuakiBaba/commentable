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
let max_life = 255;
var timestamp_last_send

var flg_speech;
var flg_deactivate_comment_control;
let peerConnection;

var g_room_name;

var color_text;
var color_text_stroke;
var volume = 0.1;

function setVolume(value) {
    volume = parseFloat(value);
}
var flash;

var speech;
var mycanvas;
var max_number_of_comment = 50;

let version = "undefined";

function testFunc() {
    alert("testFunc()")
}

function setVersion(v) {
    version = v;
}

var admin_message = {
    show: false,
    text: ""
}
function toggleMessage(checked, text_message) {
    admin_message.show = checked;
    admin_message.text = text_message;
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
        "data": `https://commentable.onrender.com/?room=${encodeURI(room)}&v=${version}`,
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
            let alpha = max_life * cos(radians(90 * (millis() - this.timestamp) / this.effect_duration));
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
        this.text_direction = 'still';

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
        this.size = abs((height / 20) * sin(0.5 * PI));

        if (this.text_direction == 'still') {
            if (this.life > 0) {
                textAlign(CENTER, CENTER);
                this.alpha = this.life;
                this.size = abs((height / 20) * sin(0.5 * PI * this.life / max_life));
                this.life = this.life - 1;
            }
        }
        else if (this.text_direction == 'left') {
            if (this.life > 0) {
                textAlign(LEFT, CENTER);
                // this.textの横野長さを計算
                textSize(this.size);
                let text_width = textWidth(this.text);

                let start_x = windowWidth;
                let end_x = -text_width;

                // lifeの割合を計算
                let life_ratio = this.life / max_life;

                // xの位置を更新
                this.x = start_x + (1 - life_ratio) * (end_x - start_x);
                this.alpha = 255;
                this.life--;
            }
        }
        else if (this.text_direction == "right") {
            if (this.life > 0) {
                textAlign(LEFT, CENTER);
                // this.textの横野長さを計算
                textSize(this.size);
                let text_width = textWidth(this.text);

                let start_x = -text_width;
                let end_x = windowWidth;

                // lifeの割合を計算
                let life_ratio = this.life / max_life;

                // xの位置を更新
                this.x = start_x + (1 - life_ratio) * (end_x - start_x);
                this.alpha = 255;
                this.life--;
            }
        }
        else if (this.text_direction == 'up') {
            if (this.life > 0) {
                textAlign(CENTER, TOP);

                // this.textの縦の高さを計算
                textSize(this.size);
                let text_height = textAscent() + textDescent();

                let start_y = windowHeight;
                let end_y = -text_height;

                // lifeの割合を計算
                let life_ratio = this.life / max_life;

                // xの位置を更新
                this.y = start_y + (1 - life_ratio) * (end_y - start_y);
                this.alpha = 255;
                this.life--;
            }
        }
        else if (this.text_direction == "down") {
            if (this.life > 0) {
                textAlign(CENTER, TOP);
                // this.textの縦の高さを計算
                textSize(this.size);
                let text_height = textAscent() + textDescent();

                let start_y = -text_height;
                let end_y = windowHeight;

                // lifeの割合を計算
                let life_ratio = this.life / max_life;

                // xの位置を更新
                this.y = start_y + (1 - life_ratio) * (end_y - start_y);
                this.alpha = 255;
                this.life--;
            }

        }
        return;
    }
    draw() {
        textSize(this.size);
        strokeWeight(5.0 * this.alpha / 255.0);
        stroke(this.color_text_stroke + str(hex(this.alpha, 2)));
        fill(this.color_text + str(hex(this.alpha, 2)));
        text(this.text, this.x, this.y);
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
    g_room_name = room;

    // 環境に応じたSocket.IO接続
    let serverUrl = window.SOCKET_SERVER_URL || 'https://commentable.onrender.com';
    console.log('Connecting to socket server:', serverUrl);

    // Socket.IOが読み込まれるまで待機
    function connectSocket() {
        if (typeof io !== 'undefined') {
            socket = io.connect(serverUrl);
            console.log('Socket.IO connection established with:', serverUrl);

            // Socket.IOイベントリスナーの設定
            setupSocketListeners();
        } else {
            console.log('Waiting for Socket.IO to load...');
            setTimeout(connectSocket, 100);
        }
    }

    // Socket.IOイベントリスナーを設定する関数
    function setupSocketListeners() {
        socket.on('connect', () => {
            console.log('Successfully connected to server:', serverUrl);
        });

        socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            console.error('Failed to connect to:', serverUrl);
        });

        socket.on('disconnect', (reason) => {
            console.log('Disconnected from server:', reason);
            log('you have been disconnected: ' + reason);
        });

        socket.on('you_are_connected', function () {
            // 部屋名を指定してジョインする．
            socket.emit('join', room);
        });

        socket.on('comment', newComment);

        // Whenever the server emits 'user joined', log it in the chat body
        socket.on('user joined', (data) => {
            log(data.username + ' joined');
            // addParticipantsMessage(data);
        });

        // Whenever the server emits 'user left', log it in the chat body
        socket.on('user left', (data) => {
            log(data.username + ' left');
            // removeChatTyping(data);
            // addParticipantsMessage(data);
        });

        socket.on('reconnect', () => {
            log('you have been reconnected');
            socket.emit('join', room);
        });

        socket.on('login', (data) => {
            console.log("you have been connected to " + room);
            //isConnected = true;
            // Display the welcome message
            // addParticipantsMessage(data);
        });

        socket.on("deactivate_comment_control", (data) => {
            g_flg_deactivate_comment_control = data.control;
        });

        socket.on("disconnectPeer", () => {
            if (typeof peerConnection !== 'undefined') {
                peerConnection.close();
            }
        });
    }

    connectSocket();

    window.onunload = window.onbeforeunload = () => {
        if (socket) {
            socket.close();
        }
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

function showNotification(text) {
    // クラスを切り替えたい要素を取得
    var element = document.getElementById('notification');

    // notification_inクラスが存在する場合は、それを削除し、notification_outクラスを追加
    if (element.classList.contains('notification_out')) {
        element.innerHTML = `<i class="bi bi-info-circle"></i> ${text}`;
        element.classList.remove('notification_out');
        element.classList.add('notification_in');
    }

    // n秒後に消去
    setTimeout(function () {
        element.classList.remove('notification_in');
        element.classList.add('notification_out');
    }, 5000);



}
function draw() {
    clear();
    //background(0, 0, 0, 0);

    if (flg_clock == true) {
        let now = new Date();
        let hour = now.getHours();
        let minute = now.getMinutes();
        let second = now.getSeconds();

        let time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        textStyle(BOLD);
        strokeWeight(5.0);
        stroke("#000");
        fill("#ffffff");
        textSize(height / 15);
        textAlign(LEFT, TOP);
        text(time, 20, 10);
    }

    textStyle(NORMAL);
    for (var i = 0; i < max_number_of_comment; i++) {
        if (comments[i].getLife() > 0) {
            comments[i].update();
            comments[i].draw();
        }
    }

    protofessional_effect.draw();
    flash.draw();

    if (admin_message.show) {
        textAlign(CENTER, CENTER);
        textSize(height / 20);
        let txt = admin_message.text;
        let txtWidth = textWidth(txt);
        let txtHeight = textAscent() + textDescent();
        let padding = 0;  // テキスト周りの余白

        // 背景の四角形を描画
        fill("#000000");
        rect((width - txtWidth) / 2 - padding, (height - txtHeight) / 2 - padding, txtWidth + 2 * padding, txtHeight + 2 * padding);

        // テキストを描画
        fill("#ffffff");
        text(txt, width / 2, height / 2);

    }
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
    }
    // 通常のコメント
    else {
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
            console.log(data);
            comments[id].setLife(255);
            comments[id].setText(data.comment);
            comments[id].text_direction = data.text_direction;
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

var flg_clock = false;
function toggleClock(checked) {
    flg_clock = checked;
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

// _hidden: 隠しコマンド、-1のときはなし、0以上がコマンドのidとなる。
function sendComment(
    _str_comment,
    _flg_emoji,
    _str_my_name,
    _flg_img,
    _id_img,
    _flg_sound,
    _id_sound,
    _hidden) {

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

function sendCodeSnippet(clip_text) {

    let data = {
        room_name: g_room_name,
        my_name: '管理人',
        comment: clip_text,
        flg_speech: false,
        color_text: '#000000',
        color_text_stroke: '#ffffff',
        flg_image: false,
        id_image: 0,
        flg_sound: false,
        id_sound: false,
        hidden: 100
    }

    socket.emit("comment", data);
    newComment(data);

    showNotification("資料スペースにクリップボードの内容を送信しました。");
}