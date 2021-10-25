var api_key;
var socket;
var flg_sound_mute = true;
var comments = []; //new Array(50);
var telop;
var max_number_of_comment = 50;
var sound;
var sound_chime;
var sound_dodon;
var sound_drumroll;
var sound_dora;
var sound_deden;
var sound_pingpong;
var sound_chin;
var sound_kansei;
var sound_applause;

var flg_chime;
var flg_clock;
var flg_noDraw;
var flg_glitch;

var time_start;
var time_start_hour;
var time_start_minute;
var time_end;
var time_end_hour;
var time_end_minute;
var is_streaming = false;

var p5_captures;
var glitch_lines;

var myRec = new p5.SpeechRec('', parseResult); // new P5.SpeechRec object
var is_recognition_activated = false;



let peerConnection;
const config = {
    iceServers: [{
        urls: ["stun:stun.l.google.com:19302"]
    }]
};


class ProtofessionalEffect {
    constructor() {
        this.is_activating = false;
        this.effect_duration = 7000;
        this.sound = loadSound('../assets/protofessional.mp3');
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

class Telop {
    constructor() {
        this.x = width / 2;
        this.y = height / 2;
        this.text = "";
        this.alpha = 255;
        this.size = 72;
    }
    setColor(_color_text, _color_text_stroke) {
        this.color_text = _color_text;
        this.color_text_stroke = _color_text_stroke;
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
    playSound() {
        // if (sound[this.id_sound].length > 1) {
        //     let number = int(random(sound[this.id_sound].length));
        //     sound[this.id_sound][number].setVolume(this.volume);
        //     sound[this.id_sound][number].play();
        // } else {
        //     sound[this.id_sound].setVolume(this.volume);
        //     sound[this.id_sound].play();
        // }
    }
    update() {
        return;
    }
    draw() {
        this.size = width / 10.0;
        textAlign(CENTER, CENTER);
        textSize(this.size);
        strokeWeight(5.0 * this.alpha / 255.0);
        stroke(this.color_text_stroke + str(hex(this.alpha, 2)));
        fill(this.color_text + str(hex(this.alpha, 2)));
        text(this.text, this.x, this.y);

        //imageMode(CENTER);
        //image(this.img[0],this.x, this.y, this.img[0].width*this.alpha/255, this.img[0].height*this.alpha/255);

        return;
    }
}


var color_background;
var color_text;
var color_text_stroke;
var capture;
var capture_screen;
var volume = 0.1;
var flash;

var speech;
var g_room = "";

function readyLoading(count_loaded) {
    console.log(count_loaded);
    document.getElementById('p5_loading').innerHTML = str(count_loaded) + ' files loaded.';
}
function whileLoading(total) {
    console.log('loaded: ', + total);
}
function preload() {
    let count_loaded = 0;

    json = loadJSON('../api_key.json', preloadJSON);
    for (var i = 0; i < max_number_of_comment; i++) {
        comments[i] = new Comment();
        comments[i].setLife(0);
    }
    telop = new Telop();

    // Load sound files
    sound_chime = loadSound('../assets/chime.mp3', readyLoading(++count_loaded), null, whileLoading);


    sound = [
        [loadSound('../assets/camera1.mp3', readyLoading(++count_loaded)),
        loadSound('../assets/camera2.mp3', readyLoading(++count_loaded)),
        loadSound('../assets/camera3.mp3', readyLoading(++count_loaded))],
        [loadSound('../assets/clap1.mp3', readyLoading(++count_loaded)),
        loadSound('../assets/clap2.mp3', readyLoading(++count_loaded)),
        loadSound('../assets/clap3.mp3', readyLoading(++count_loaded)),
        loadSound('../assets/clap4.mp3', readyLoading(++count_loaded)),
        loadSound('../assets/clap5.mp3', readyLoading(++count_loaded)),
        loadSound('../assets/clap6.mp3', readyLoading(++count_loaded)),
        loadSound('../assets/clap7.mp3', readyLoading(++count_loaded)),
        loadSound('../assets/clap8.mp3', readyLoading(++count_loaded))],
        loadSound('../assets/cracker.mp3', readyLoading(++count_loaded)),
        loadSound('../assets/kansei.mp3', readyLoading(++count_loaded)),
        loadSound('../assets/he.wav', readyLoading(++count_loaded)),
        loadSound('../assets/chottomatte.wav', readyLoading(++count_loaded)),
        loadSound('../assets/OK.wav', readyLoading(++count_loaded)),
        loadSound('../assets/punch.mp3', readyLoading(++count_loaded)),
        loadSound('../assets/laugh3.mp3', readyLoading(++count_loaded)),
        [loadSound('../assets/kusa00.mp3', readyLoading(++count_loaded)),
        loadSound('../assets/kusa01.mp3', readyLoading(++count_loaded)),
        loadSound('../assets/kusa02.mp3', readyLoading(++count_loaded)),
        loadSound('../assets/kusa03.mp3', readyLoading(++count_loaded)),
        loadSound('../assets/kusa04.mp3', readyLoading(++count_loaded)),
        loadSound('../assets/kusa05.mp3', readyLoading(++count_loaded))]
    ]
    sound_dodon = loadSound('../assets/dodon.mp3', readyLoading(++count_loaded));
    sound_drumroll = loadSound('../assets/drumroll.mp3', readyLoading(++count_loaded));
    sound_dora = loadSound('../assets/dora.mp3', readyLoading(++count_loaded));
    sound_deden = loadSound('../assets/quiz.mp3', readyLoading(++count_loaded));
    sound_pingpong = loadSound('../assets/seikai.mp3', readyLoading(++count_loaded));
    sound_chin = loadSound('../assets/chin.mp3', readyLoading(++count_loaded));
    sound_kansei = loadSound('../assets/kansei.mp3', readyLoading(++count_loaded));
    sound_applause = loadSound('../assets/applause.mp3', readyLoading(++count_loaded));
    protofessional_effect = new ProtofessionalEffect();


    // 部屋名を指定してジョインする．部屋名が指定されていない場合はalertを出す
    let params = getURLParams();
    if (params.room) {
        g_room = decodeURIComponent(params.room);
    } else {
        while ((g_room = prompt("部屋名を入力してください", 'test_room')) == '');
    }

    const qrCode = new QRCodeStyling({
        "width": 200,
        "height": 200,
        "data": window.location.origin + "/?room=" + g_room,
        "margin": 0,
        "qrOptions": { "typeNumber": "0", "mode": "Byte", "errorCorrectionLevel": "Q" },
        "imageOptions": { "hideBackgroundDots": true, "imageSize": 0.5, "margin": 10 },
        "dotsOptions": { "type": "dots", "color": "#333333" },
        "backgroundOptions": { "color": "#ffffff" },
        "image": "./images/commentable_qr.png",
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

    document.getElementById("qr").innerHTML = "";
    qrCode.append(document.getElementById("qr"));

}

function preloadJSON(jsonData) {
    data = jsonData;
    api_key = data.key;
}

function changedVideoDevice() {
    console.log('Device Id:', this.value());
}

const video = document.querySelector("video");

function setup() {


    glitch_lines = new GlitchLines();

    let str_name = "管理人"; //prompt("お名前を入力してください（匿名OK、途中から変更可能）", "匿名");
    //setupOsc(12000, 3334);

    select("#text_my_name").value(str_name);
    // getStream()
    //   .then(getDevices)
    //   .then(gotDevices);
    // set all available video/audio devices to #videoSource
    attachVideoDevicesToSelect("#videoSource");

    var video_device = document.getElementById("videoSource");
    console.log(video_device);
    select("#videoSource").changed(changedVideoDevice);

    // Execute loadVoices.
    speech = new Speech();
    //speech.loadVoices();
    window.speechSynthesis.onvoiceschanged = function (e) {
        speech.loadVoices();
    };
    p5_captures = new P5Captures();
    textFont("Noto Sans JP");

    var canvas = createCanvas(windowWidth, (windowWidth) * (9.0 / 16.0), P2D);
    canvas.parent('sketch-holder');
    color_background = document.getElementById("color_background").value;
    color_text = document.getElementById("color_text").value;
    color_text_stroke = document.getElementById("color_text_stroke").value;

    flash = new Flash();
    stroke(0);
    strokeWeight(1);
    textAlign(CENTER);
    textSize(32);
    //textStyle(BOLD);
    background(100);

    //socket = io.connect('http://localhost');
    //socket = io.connect('https://commentable.lolipop.io')
    socket = io.connect(window.location.origin, {
        auth: {
            token: '123'
        }
    });

    // 部屋名を指定してジョインする．部屋名が指定されていない場合はalertを出す
    let params = getURLParams();
    socket.emit('join', g_room);
    socket.emit('join-as-master', g_room + '-master');


    socket.on('comment', newComment);
    socket.on('letter', newLetter);
    socket.on('telop', newTelop);


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

    socket.on('display_clock', (data) => {
        flg_clock = data.show;
        document.getElementById('checkbox_clock').checked = flg_clock;
    });

    socket.on('glitch_effect', (data) => {
        flg_glitch = data.show;
        document.getElementById('checkbox_glitch').checked = flg_glitch;
    });
    socket.on('toggleQR', (data) => {
        document.querySelector('#qr').hidden = data;
    });



    socket.on('reconnect', () => {
        log('you have been reconnected');
        if (username) {
            socket.emit('add user', username);
        }
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

        peerConnection.ontrack = event => {
            video.srcObject = event.streams[0];
            select("#stream_video").style('display:flex');
            select("#sketch-holder").style('position:absolute');
            select("#button_stream_status").class('btn btn-danger btn-sm');
            select("#button_stream_status").html("Streaming On");
            is_streaming = true;
        };
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
        select("#stream_video").style('display:none');
        select("#sketch-holder").style('position:relative');
        select("#button_stream_status").class('btn btn-secondary btn-sm');
        select("#button_stream_status").html("Streaming Off");
        is_streaming = false;
    });

    socket.on("disconnectPeer", () => {
        peerConnection.close();
    });

    window.onunload = window.onbeforeunload = () => {
        socket.close();
    };


    select("#button_send").mouseClicked(pushedSendButton);
    select("#color_background").changed(changeBackgroundColor);
    select("#color_text").changed(changeTextColor);
    select("#color_text_stroke").changed(changeTextOutlineColor);
    select("#button_camera").mouseClicked(toggleCamera);
    //select("#button_image_reaction_01").mouseClicked(sendImageReaction01);
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

    select("#slider_volume").changed(changeVolume);
    select("#button_sound_mute").mouseClicked(toggleSoundMute);

    select("#checkbox_chime").mouseClicked(toggleChime);
    select("#checkbox_clock").mouseClicked(toggleClock);
    select("#checkbox_speech").mouseClicked(toggleSpeech);
    select("#checkbox_noDraw").mouseClicked(toggleDraw);
    select("#checkbox_glitch").mouseClicked(toggleGlitch);
    select("#checkbox_deactivate_comment_control").mouseClicked(toggleDeactivateCommentControl);
    select("#checkbox_qr").mouseClicked(toggleQR);

    select("#time_start").changed(updateStartTime);
    select("#time_end").changed(updateEndTime);
    select("#button_toggle_screen_capture").mouseClicked(toggleScreenCapture);

    select("#slider_stream_volume").changed(changeStreamVolume);
    select("#button_stream_sound_mute").mouseClicked(toggleStreamMute);

    select("#button_sound_dora").mouseClicked(makeSound);
    select("#button_sound_chime").mouseClicked(makeSound);
    select("#button_sound_chin").mouseClicked(makeSound);
    select("#button_sound_applause").mouseClicked(makeSound);
    select("#button_sound_deden").mouseClicked(makeSound);
    select("#button_sound_pingpong").mouseClicked(makeSound);

    select("#download_all_comments").mouseClicked(downloadAllComments);
    select("#download_all_letters").mouseClicked(downloadAllLetters);
    flg_chime = document.getElementById("checkbox_chime").checked;
    flg_clock = document.getElementById("checkbox_clock").checked;
    flg_speech = document.getElementById("checkbox_speech").checked;
    flg_noDraw = document.getElementById("checkbox_noDraw").checked;

    time_start = document.getElementById("time_start").value;
    time_end = document.getElementById("time_end").value;
    sound_chime.setVolume(volume);
    document.getElementById("screen_size").value = str(int(width)) + "x" + str(int(height));


    // Check for browser support
    if (!"speechSynthesis" in window) {
        $("#msg").html(
            "Sorry. Your browser <strong>does not support</strong> speech synthesis."
        );
    } else {
        $("#msg").html("👍Your browser supports speech synthesis.");
    }

    myRec.onEnd = endSpeech;
    myRec.onStart = startSpeech();
    myRec.continuous = false; // no continuous recognition
    myRec.interimResults = true; // allow partial recognition (faster, less accurate)
    //myRec.onResult = parseResult; // now in the constructor
    is_recognition_activated = false;
    myRec.rec.lang = 'ja';
    select("#toggle_speech_recognition").mouseClicked(toggleSpeechRecognition);

    frameRate(30);
}

function makeSound() {
    console.log(this.value());

    if (this.value() == "sound_dora") {
        sound_dora.setVolume(parseFloat(document.getElementById('slider_volume').value));
        sound_dora.play();
    }
    else if (this.value() == "sound_chime") {
        sound_chime.setVolume(parseFloat(document.getElementById('slider_volume').value));
        sound_chime.play();
    }
    else if (this.value() == "sound_chin") {
        sound_chin.setVolume(parseFloat(document.getElementById('slider_volume').value));
        sound_chin.play();
    }
    else if (this.value() == "sound_applause") {
        sound_applause.setVolume(parseFloat(document.getElementById('slider_volume').value));
        sound_applause.play();
    }
    else if (this.value() == "sound_deden") {
        sound_deden.setVolume(parseFloat(document.getElementById('slider_volume').value));
        sound_deden.play();
    }
    else if (this.value() == "sound_pingpong") {
        sound_pingpong.setVolume(parseFloat(document.getElementById('slider_volume').value));
        sound_pingpong.play();
    }

}
function toggleSpeechRecognition() {
    is_recognition_activated = !is_recognition_activated;
    if (is_recognition_activated == true) {
        myRec.rec.lang = 'ja'; //document.getElementById("lang_speaking").value;
        myRec.start();
        this.html("音声認識中");
        this.attribute('class', "btn btn-danger btn-sm");
    } else {
        myRec.stop();
        this.html("音声認識を起動");
        this.attribute('class', "btn btn-outline-primary btn-sm");
    }
}

function parseResult() {
    //document.getElementById("label").innerHTML = "speaking...";
    document.getElementById("text_speech").value = myRec.resultString;

    if (document.getElementById('checkbox_telop').checked) {
        // リアルタイム文字起こしテロップを送信
        var data = {
            key: api_key,
            name: document.getElementById('text_my_name').value,
            text: myRec.resultString,
            color_text: color_text,
            color_text_stroke: color_text_stroke,
        }
        if (myRec.resultString.length > 0) {
            socket.emit("telop", data);
        }

        newTelop(data);
    }
}


function startSpeech() {
    console.log("start");
}

function endSpeech() {
    if (is_recognition_activated == true) {
        if (!myRec.resultValue) {
            myRec.start(); // start engine
            return;
        }
        if (myRec.resultString.length > 0) {
            console.log("End");
            //document.getElementById("label").innerHTML = "quiet";
            //document.getElementById("text_speech").innerHTML += myRec.resultString + "。";
            //here
            // 効果音再生コマンド文言がある場合は該当する効果音を再生
            if (myRec.resultString.indexOf('どどん') !== -1 ||
                myRec.resultString.indexOf('ドドン') !== -1) {
                sound_dodon.setVolume(parseFloat(document.getElementById('slider_volume').value));
                sound_dodon.play();
            } else if (myRec.resultString.indexOf('ドラムロール') !== -1) {
                sound_drumroll.setVolume(parseFloat(document.getElementById('slider_volume').value));
                sound_drumroll.play();
            } else if (myRec.resultString.indexOf('ドラ') !== -1) {
                sound_dora.setVolume(parseFloat(document.getElementById('slider_volume').value));
                sound_dora.play();
            } else if (myRec.resultString.indexOf('問題です') !== -1) {
                sound_deden.setVolume(parseFloat(document.getElementById('slider_volume').value));
                sound_deden.play();

            } else if (myRec.resultString.indexOf('チャイム') !== -1) {
                sound_chime.setVolume(parseFloat(document.getElementById('slider_volume').value));
                sound_chime.play();
            } else if (myRec.resultString.indexOf('正解です') !== -1) {
                sound_pingpong.setVolume(parseFloat(document.getElementById('slider_volume').value));
                sound_pingpong.play();
            } else if (myRec.resultString.indexOf('残念') !== -1) {
                sound_chin.setVolume(parseFloat(document.getElementById('slider_volume').value));
                sound_chin.play();
            } else if (myRec.resultString.indexOf('歓声') !== -1) {
                sound_kansei.setVolume(parseFloat(document.getElementById('slider_volume').value));
                sound_kansei.play();
            }
            else if (myRec.resultString.indexOf('拍手') !== -1) {
                sound_applause.setVolume(parseFloat(document.getElementById('slider_volume').value));
                sound_applause.play();
            }


            document.getElementById("text_speech").value = "";
            myRec.resultString = '';
            telop.setText('');
            // リアルタイム文字起こしテロップを送信
            var data = {
                key: api_key,
                name: document.getElementById('text_my_name').value,
                text: '',
                color_text: color_text,
                color_text_stroke: color_text_stroke,
            }
            socket.emit("telop", data);

        }
        myRec.start(); // start engine
    }
}




function touchStarted() {
    if (getAudioContext().state !== 'running') {
        getAudioContext().resume();
    }
}
var count_comment = 0;

function newTelop(data) {
    count_comment++;
    console.log(data);

    let comment_format = "[" + nf(year(), 4) + ":" + nf(month(), 2) + ":" + nf(day(), 2) + ":" + nf(hour(), 2) + ":" + nf(minute(), 2) + ":" + nf(second(), 2) + "-" + nf(count_comment, 4) + "] ";
    comment_format += data.text;
    comment_format += " [telop]";

    comment_format += "[" + data.name + "]" + "\n";
    //here
    select("#textarea_comment_history").html(comment_format, true);
    var psconsole = $('#textarea_comment_history');
    psconsole.scrollTop(
        psconsole[0].scrollHeight - psconsole.height()
    );

    telop.setText(data.text);
    telop.setX(width / 2);
    telop.setY(height / 2);
    telop.setColor(data.color_text, data.color_text_stroke);

}

function newComment(data) {
    count_comment++;

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
        //here
        select("#textarea_comment_history").html(comment_format, true);
        var psconsole = $('#textarea_comment_history');
        psconsole.scrollTop(
            psconsole[0].scrollHeight - psconsole.height()
        );
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


        comment_format += "image reaction" + "\n";
        select("#textarea_comment_history").html(comment_format, true);
        var psconsole = $('#textarea_comment_history');
        psconsole.scrollTop(
            psconsole[0].scrollHeight - psconsole.height()
        );
    }


}
function newLetter(data) {

    if (data.letter.length <= 0) {
        return;
    }

    let letter_format = "[" + nf(year(), 4) + ":" + nf(month(), 2) + ":" + nf(day(), 2) + ":" + nf(hour(), 2) + ":" + nf(minute(), 2) + ":" + nf(second(), 2) + "-" + nf(count_comment, 4) + "] ";
    letter_format += data.letter;
    letter_format += " [" + data.my_name + "]" + "\n";
    //here
    select("#textarea_letter_history").html(letter_format, true);
    var psconsole = $('#textarea_letter_history');
    psconsole.scrollTop(
        psconsole[0].scrollHeight - psconsole.height()
    );
}


function draw() {
    if (is_streaming) {
        clear();
        var element = document.getElementById("stream_video");
        resizeCanvas(windowWidth, (windowWidth) * (element.videoHeight / element.videoWidth));
        document.getElementById("stream_time").value = nf(element.currentTime, 4);
        document.getElementById("stream_resolution").value = str(element.videoWidth) + "x" + str(element.videoHeight);
    } else {
        //background(color_background);
        clear();
        background(0, 0, 0, 0);
    }
    if (flg_camera_is_opened) {
        p5_captures.drawCamera(0, 0, width, height);
    }

    if (p5_captures.screen) {
        p5_captures.drawScreen(0, 0, width, height);
    }

    telop.draw();

    protofessional_effect.draw();
    flash.draw();

    if (flg_clock) {
        fill(255);
        stroke(0);
        strokeWeight(5.0);
        textSize(32);
        text(str(nf(hour(), 2)) + ":" + str(nf(minute(), 2)), 100, 70);
    }

    if (flg_chime && !sound_chime.isPlaying()) {
        let time_now = str(nf(hour(), 2)) + ":" + str(nf(minute(), 2)) + ":" + str(nf(second(), 2));
        if ((time_start + ":00") == time_now) {
            sound_chime.play();
        } else if ((time_end + ":00" == time_now)) {
            sound_chime.play();
        }
    }

    if (flg_glitch) {
        glitch_lines.draw();
    }

    for (var i = 0; i < max_number_of_comment; i++) {
        if (comments[i].getLife() > 0) {
            comments[i].update();
            if (flg_noDraw == false) comments[i].draw();
        }
    }
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

function changeBackgroundColor() {
    color_background = this.value();
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
    if (is_streaming) {
        var element = document.getElementById("stream_video");
        print(element.videoWidth, element.videoHeight);
        resizeCanvas(windowWidth, (windowWidth) * (element.videoHeight / element.videoWidth));
    } else {
        resizeCanvas(windowWidth, (windowWidth) * 9 / 16);
    }
    print(windowWidth, windowHeight);
    document.getElementById("screen_size").value = str(int(width)) + "x" + str(int(height));
}

function sendImageReaction01() {
    sendComment(
        document.getElementById("text_comment").value, false,
        document.getElementById("text_my_name").value,
        true, 0,
        false, 0, -1);
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
    console.log(id_sound);
    sendComment(
        this.html(), false,
        document.getElementById("text_my_name").value,
        false, 0,
        true, id_sound, -1
    );
    if (id_sound == 0) { // Camera
        flash.do();
    }
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
    resizeCanvas(windowWidth, (windowWidth) * 9.0 / 16.0);
}

function toggleChime() {
    print(this.checked());
    flg_chime = this.checked();
}

function toggleClock() {
    flg_clock = this.checked();

    // 時計表示メッセージ送信
    var data = {
        key: api_key,
        name: document.getElementById('text_my_name').value,
        show: this.checked()
    }
    socket.emit("display_clock", data);

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

function toggleGlitch() {
    flg_glitch = this.checked();
    // グリッジ表示メッセージ送信
    var data = {
        key: api_key,
        show: this.checked()
    }
    socket.emit("glitch_effect", data);
}

function toggleDeactivateCommentControl() {
    var data = {
        key: api_key,
        control: this.checked()
    }
    socket.emit("deactivate_comment_control", data);
}

function toggleQR() {
    document.querySelector("#qr").hidden = !this.checked();
    socket.emit("toggleQR", !this.checked());
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
    resizeCanvas(windowWidth, (windowWidth) * 10.0 / 16.0);
}