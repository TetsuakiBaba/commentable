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
let max_life = 255; // 後方互換性のため残す（非推奨）
let comment_display_duration = 10000; // コメント表示時間（ミリ秒）
var timestamp_last_send

var flg_speech;
var flg_deactivate_comment_control;
let peerConnection;

var g_room_name;

var color_text;
var color_text_stroke;
var volume = 0.1;

// カメラ関連の変数
var cameraCapture = null;
var personX = 0; // カメラ映像のX座標
var personY = 0; // カメラ映像のY座標
var personScale = 0.3; // カメラ映像のスケール（デフォルト: 小）
var cameraPosition = 'top-right'; // カメラ位置: 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'

// コメントコマンド関連の変数
var commentCommands = []; // アクティブなコメントコマンドの配列

// メインプロセスのコンソールに出力するヘルパー関数
function mainLog(...args) {
    if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log(...args);
    } else {
        console.log(...args);
    }
}

function mainWarn(...args) {
    if (window.electronAPI && window.electronAPI.warn) {
        window.electronAPI.warn(...args);
    } else {
        console.warn(...args);
    }
}

function mainError(...args) {
    if (window.electronAPI && window.electronAPI.error) {
        window.electronAPI.error(...args);
    } else {
        console.error(...args);
    }
}

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
        "data": `${window.SOCKET_SERVER_URL || 'https://commentable.onrender.com'}/?room=${encodeURI(room)}&v=${version}`,
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
        this.life = 1; // 0 - 255（後方互換性のため残す）
        this.startTime = 0; // コメント開始時刻（ミリ秒）
        this.duration = comment_display_duration; // 表示時間（ミリ秒）
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
        this.startTime = millis(); // 開始時刻を記録
        this.duration = comment_display_duration;
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
        // 経過時間を計算
        const elapsed = millis() - this.startTime;
        const progress = elapsed / this.duration; // 0.0 - 1.0

        // 終了チェック
        if (elapsed >= this.duration) {
            this.life = 0;
            return;
        }


        this.size = abs((height / 20) * sin(0.5 * PI));


        if (this.text_direction == 'still') {
            textAlign(CENTER, CENTER);
            // 残り時間に応じてアルファ値を計算（フェードアウト）
            this.alpha = parseInt(255 * (1.0 - progress));
            this.size = abs((height / 20) * sin(0.5 * PI * (1 - progress)));
            // lifeは後方互換性のため更新
            this.life = 255 * (1 - progress);
        }
        else if (this.text_direction == 'left') {
            textAlign(LEFT, CENTER);
            // this.textの横野長さを計算
            textSize(this.size);
            let text_width = textWidth(this.text);

            let start_x = windowWidth;
            let end_x = -text_width;

            // xの位置を更新（progressを使用）
            this.x = start_x + progress * (end_x - start_x);
            this.alpha = 255;
            // lifeは後方互換性のため更新
            this.life = 255 * (1 - progress);
        }
        else if (this.text_direction == "right") {
            textAlign(LEFT, CENTER);
            // this.textの横野長さを計算
            textSize(this.size);
            let text_width = textWidth(this.text);

            let start_x = -text_width;
            let end_x = windowWidth;

            // xの位置を更新（progressを使用）
            this.x = start_x + progress * (end_x - start_x);
            this.alpha = 255;
            // lifeは後方互換性のため更新
            this.life = 255 * (1 - progress);
        }
        else if (this.text_direction == 'up') {
            textAlign(CENTER, TOP);

            // this.textの縦の高さを計算
            textSize(this.size);
            let text_height = textAscent() + textDescent();

            let start_y = windowHeight;
            let end_y = -text_height;

            // yの位置を更新（progressを使用）
            this.y = start_y + progress * (end_y - start_y);
            this.alpha = 255;
            // lifeは後方互換性のため更新
            this.life = 255 * (1 - progress);
        }
        else if (this.text_direction == "down") {
            textAlign(CENTER, TOP);
            // this.textの縦の高さを計算
            textSize(this.size);
            let text_height = textAscent() + textDescent();

            let start_y = -text_height;
            let end_y = windowHeight;

            // yの位置を更新（progressを使用）
            this.y = start_y + progress * (end_y - start_y);
            this.alpha = 255;
            // lifeは後方互換性のため更新
            this.life = 255 * (1 - progress);
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

// コメントコマンドクラス
class CommentCommand {
    constructor(commandName, args, colorText, colorTextStroke) {
        this.commandName = commandName;
        this.args = args;
        this.colorText = colorText || "#ffffff";
        this.colorTextStroke = colorTextStroke || "#000000";
        this.startTime = millis();
        this.duration = 10000; // 10秒間表示
        this.isActive = true;
    }

    update() {
        if (millis() - this.startTime > this.duration) {
            this.isActive = false;
        }
    }

    draw() {
        if (!this.isActive) return;

        // commandNameに応じた描画処理
        if (this.commandName === 'text') {
            this.drawText();
        }
    }

    drawText() {
        // 引数: text(表示テキスト, x位置(0-1), y位置(0-1))
        if (this.args.length >= 3) {
            const textContent = this.args[0].replace(/['"]/g, ''); // クォートを削除
            const xPos = parseFloat(this.args[1]) * windowWidth;
            const yPos = parseFloat(this.args[2]) * windowHeight;

            push();
            textAlign(CENTER, CENTER);
            textSize(height / 15);
            strokeWeight(5.0);
            stroke(this.colorTextStroke);
            fill(this.colorText);
            text(textContent, xPos, yPos);
            pop();
        }
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
    console.log('Canvas created with size:', windowWidth, 'x', windowHeight);
    document.getElementById("canvas_placeholder").append(mycanvas.elt);

    // frameRate(30);
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

    // カメラ選択のIPCイベントリスナーを設定
    if (window.electronAPI) {
        window.electronAPI.onSelectCamera((event, deviceId) => {
            console.log('Camera selected:', deviceId);
            startCamera(deviceId);
        });

        window.electronAPI.onStopCamera(() => {
            console.log('Stop camera requested');
            stopCamera();
        });

        // 保存された設定を読み込み
        loadCameraSettingsFromMain();
    }

}

// カメラ設定を読み込み
async function loadCameraSettingsFromMain() {
    try {
        const settings = await window.electronAPI.getCameraSetting();
        console.log('Loaded camera settings:', settings);
        // 設定は文字列で返ってくる可能性があるのでパースする
        // ここでは使わないが、位置とサイズはtoggleCameraで適用される
    } catch (error) {
        console.error('Error loading camera settings:', error);
    }
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
    // 透明背景をクリア
    clear();
    // background(0, 0, 0, 0); // 完全透明の背景

    // カメラ映像を描画
    if (cameraCapture && personScale > 0) {
        // マウスがカメラ映像の範囲内にあるかチェック
        const vidWidth = cameraCapture.width * personScale;
        const vidHeight = cameraCapture.height * personScale;
        const cameraLeft = personX - vidWidth / 2;
        const cameraRight = personX + vidWidth / 2;
        const cameraTop = personY - vidHeight / 2;
        const cameraBottom = personY + vidHeight / 2;

        const isMouseOverCamera = mouseX >= cameraLeft && mouseX <= cameraRight &&
            mouseY >= cameraTop && mouseY <= cameraBottom;

        push();
        imageMode(CENTER);

        // マウスがホバーしている場合は透過度を下げる
        if (isMouseOverCamera) {
            tint(255, 50); // 透明度を約20%に設定（255の約20% = 50）
        }

        image(cameraCapture, personX, personY, vidWidth, vidHeight);
        pop();
    }

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

    // コメントコマンドの描画
    for (let i = commentCommands.length - 1; i >= 0; i--) {
        commentCommands[i].update();
        if (commentCommands[i].isActive) {
            commentCommands[i].draw();
        } else {
            // 非アクティブなコマンドを削除
            commentCommands.splice(i, 1);
        }
    }

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

// コメントコマンドをパースして実行
function executeCommentCommand(commandString, colorText, colorTextStroke) {
    // = で始まるかチェック
    if (!commandString.startsWith('=')) {
        return false;
    }

    // = を削除
    const command = commandString.substring(1);

    // 関数としてパース
    const parsed = parseFunctionString(command);

    if (!parsed) {
        console.log('Invalid comment command format:', commandString);
        return false;
    }

    // 許可された関数名のリスト
    const allowedCommands = ['text'];

    if (!allowedCommands.includes(parsed.functionName)) {
        console.log('Command not allowed:', parsed.functionName);
        return false;
    }

    // コメントコマンドを作成して配列に追加
    const commentCommand = new CommentCommand(parsed.functionName, parsed.args, colorText, colorTextStroke);
    commentCommands.push(commentCommand);

    console.log('Comment command executed:', parsed.functionName, parsed.args, 'colors:', colorText, colorTextStroke);
    return true;
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

    // コメントコマンドチェック（= で始まる場合）
    if (data.comment && data.comment.startsWith('=')) {
        const executed = executeCommentCommand(data.comment, data.color_text, data.color_text_stroke);
        if (executed) {
            console.log('Comment command processed:', data.comment);
            return; // コメントコマンドとして処理したので通常の描画はスキップ
        }
    }

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

// ========== カメラ関連の関数 ==========

// カメラを開始
async function startCamera(deviceId) {
    console.log('Starting camera with deviceId:', deviceId);

    try {
        // 既存のカメラを停止
        stopCamera();

        const constraints = {
            video: {
                deviceId: deviceId ? { exact: deviceId } : undefined,
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        };

        console.log('Creating capture with constraints:', constraints);

        cameraCapture = createCapture(constraints, () => {
            console.log('Camera capture created successfully');
            console.log('Camera size:', cameraCapture.width, 'x', cameraCapture.height);

            // ビデオ要素を非表示にする（p5で描画するため）
            cameraCapture.hide();

            // 位置を設定
            updateCameraPosition();
            console.log('Initial position set to:', personX, personY, 'scale:', personScale);
        });

        // エラーハンドリング
        cameraCapture.elt.addEventListener('error', (e) => {
            console.error('Camera error:', e);
        });

    } catch (error) {
        console.error('Error starting camera:', error);
    }
}

// カメラを停止
function stopCamera() {
    if (cameraCapture) {
        cameraCapture.remove();
        cameraCapture = null;
        console.log('Camera stopped');
    }
}

// カメラ位置を設定
function setCameraPosition(position) {
    cameraPosition = position;
    updateCameraPosition();
    console.log('Camera position set to:', position);
}

// カメラサイズを設定
function setCameraSize(size) {
    switch (size) {
        case 'small':
            personScale = 0.3;
            break;
        case 'medium':
            personScale = 0.5;
            break;
        case 'large':
            personScale = 0.8;
            break;
    }
    updateCameraPosition(); // サイズ変更時も位置を再計算
    console.log('Camera size set to:', size, 'scale:', personScale);
}

// カメラ位置を更新
function updateCameraPosition() {
    if (!cameraCapture) return;

    const margin = 50; // 画面端からのマージン
    const vidWidth = cameraCapture.width * personScale;
    const vidHeight = cameraCapture.height * personScale;

    switch (cameraPosition) {
        case 'top-left':
            personX = margin + vidWidth / 2;
            personY = margin + vidHeight / 2;
            break;
        case 'top-right':
            personX = windowWidth - margin - vidWidth / 2;
            personY = margin + vidHeight / 2;
            break;
        case 'bottom-left':
            personX = margin + vidWidth / 2;
            personY = windowHeight - margin - vidHeight / 2;
            break;
        case 'bottom-right':
            personX = windowWidth - margin - vidWidth / 2;
            personY = windowHeight - margin - vidHeight / 2;
            break;
        case 'center':
            personX = windowWidth / 2;
            personY = windowHeight / 2;
            break;
    }
}
