var socket;
var sound;
var flg_clock = false;
let comment_display_duration = 10000; // コメント表示時間（ミリ秒）

var g_room_name;

var volume = 0.1;
var flg_sound_mute = false;

// ========== 描画スケジューラ ==========
// 画面全体の透明キャンバスを毎フレーム描き直すのは重いので、
// 動くものがある間だけ draw ループを回し、何もなければ止める。
const FRAME_RATE_ANIMATION = 60; // コメント・エフェクトが動いているとき
const FRAME_RATE_CAMERA = 30;    // カメラ映像だけのとき（カメラ自体が30fps程度）
var clockTimer = null;

// アニメーションを開始する（止まっていればループを再開）
function requestRender() {
    if (typeof isLooping === 'function' && !isLooping()) {
        loop();
    }
}

// 静止した内容が変わったときに1フレームだけ描き直す
function requestRedraw() {
    if (typeof isLooping === 'function' && !isLooping()) {
        redraw();
    }
}

function isCameraVisible() {
    return !!cameraCapture && personScale > 0;
}

function hasActiveAnimation() {
    return comments.some(c => c.getLife() > 0) ||
        protofessional_effect.is_activating ||
        flash.status ||
        commentCommands.length > 0;
}

// 次のフレームが必要かを判断してフレームレートを決める（draw の最後に呼ぶ）
function scheduleNextFrame() {
    if (hasActiveAnimation() || cameraFadeInProgress()) {
        frameRate(FRAME_RATE_ANIMATION);
    } else if (isCameraVisible()) {
        frameRate(FRAME_RATE_CAMERA);
    } else {
        noLoop();
    }
}

// 時計は分が変わるときだけ描き直す
function scheduleClockTick() {
    clearTimeout(clockTimer);
    clockTimer = null;
    if (!flg_clock) return;
    const now = new Date();
    const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50;
    clockTimer = setTimeout(() => {
        requestRedraw();
        scheduleClockTick();
    }, msToNextMinute);
}

// カメラ関連の変数
var cameraCapture = null;

// 実施中のアンケート（再接続時に配信し直すために保持）
var activeSurvey = null;
var personX = 0; // カメラ映像のX座標
var personY = 0; // カメラ映像のY座標
var personScale = 0.15; // カメラ映像のスケール（画面幅に対する比率、デフォルト: 小=15%）
var cameraPosition = 'bottom-left'; // カメラ位置: 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'
var cameraAlpha = 1.0; // カメラ映像の不透明度（マウスホバーでふわっと消す）
const CAMERA_FADE_TIME = 150; // フェードの時定数（ms）
const CAMERA_HOVER_ALPHA = 0.0; // ホバー中の不透明度

// 人物切り抜き（メインプロセスの Vision でマスクを生成し、背景を透過して描画）
const SEGMENTATION_INPUT_WIDTH = 512; // Vision に送るフレームの幅
var cameraSegmentationEnabled = false;
var segmentationInFlight = false;
var segmentationReady = false; // 切り抜き済みフレームが用意できているか
var segmentationLastVideoTime = -1;
var segmentationFrameCanvas = null; // マスク生成に使ったフレーム（原寸）
var segmentationInputCanvas = null; // Vision に送る縮小フレーム
var segmentationMaskCanvas = null;  // マスク（アルファのみ）
var segmentationOutputCanvas = null; // 切り抜き結果

// QRコードの状態を保持
var currentQRPosition = 'none'; // 'none', 'center', 'top_right'
var currentQRChecked = false;
var currentQRRoom = '';

// ウィンドウサイズの最新値を保持
var latestWindowMetrics = null;

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

var flash;
var speech;
var mycanvas;
var max_number_of_comment = 50;
let version = window.APP_VERSION || "undefined";
var protofessional_effect;

var admin_message = {
    show: false,
    text: ""
}
function toggleMessage(checked, text_message) {
    admin_message.show = checked;
    admin_message.text = text_message;
    requestRedraw();
}

function toggleQR(checked, position, room) {
    // 現在の状態を保存
    currentQRChecked = checked;
    currentQRPosition = position;
    currentQRRoom = room;

    if (position == "none") {
        document.getElementById("QR_center").innerHTML = "";
        document.getElementById("QR_top_right").innerHTML = "";
        document.getElementById("QR_center").hidden = true;
        document.getElementById("QR_top_right").hidden = true;
        return;
    }

    // 現在のキャンバスサイズを取得
    const currentWidth = (typeof width !== 'undefined' && width > 0) ? width : (document.documentElement.clientWidth || window.innerWidth);

    let qr_width, qr_height;
    if (position == "center") {
        qr_width = qr_height = currentWidth / 3;
    } else if (position == "top_right") {
        qr_width = qr_height = currentWidth / 10;
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

    // DOMをクリアして再生成
    const centerEl = document.getElementById("QR_center");
    const topRightEl = document.getElementById("QR_top_right");
    centerEl.innerHTML = "";
    topRightEl.innerHTML = "";

    if (checked && position == "center") {
        qrCode.append(centerEl);
        centerEl.hidden = false;
        topRightEl.hidden = true;
    } else if (checked && position == "top_right") {
        qrCode.append(topRightEl);
        topRightEl.hidden = false;
        centerEl.hidden = true;
    } else {
        centerEl.hidden = true;
        topRightEl.hidden = true;
    }
}


class ProtofessionalEffect {
    constructor() {
        this.is_activating = false;
        this.effect_duration = 10000;
        this.sound = loadSound('./sounds/protofessional.mp3');
        this.volume = 0.5;
        this.max_life = 255;
    }
    activate() {
        this.is_activating = true;
        this.timestamp = millis();
        requestRender();
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
            let alpha = this.max_life * cos(radians(90 * (millis() - this.timestamp) / this.effect_duration));
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
        this.font_size_multiplier = 1.0; // フォントサイズの倍率（small: 0.7, medium: 1.0, large: 1.5）
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
        this.measured_size = null;
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
    setFontSize(_font_size) {
        // フォントサイズに応じて倍率を設定
        if (_font_size === 'small') {
            this.font_size_multiplier = 0.7;
        } else if (_font_size === 'large') {
            this.font_size_multiplier = 1.5;
        } else {
            this.font_size_multiplier = 1.0; // medium
        }
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

        // フォントサイズの倍率を適用
        const baseSize = height / 20;
        this.size = baseSize * this.font_size_multiplier;

        if (this.text_direction == 'still') {
            textAlign(CENTER, CENTER);
            // フェードアウト
            this.alpha = parseInt(255 * (1.0 - progress));
            this.size = abs(baseSize * this.font_size_multiplier * sin(0.5 * PI * (1 - progress)));
            this.life = 255 * (1 - progress);
        }
        else if (this.text_direction == 'left' || this.text_direction == 'right') {
            textAlign(LEFT, CENTER);
            // 文字幅はサイズが変わったときだけ測り直す
            if (this.measured_size !== this.size) {
                textSize(this.size);
                this.text_width = textWidth(this.text);
                this.measured_size = this.size;
            }
            let text_width = this.text_width;

            let start_x = this.text_direction == 'left' ? width : -text_width;
            let end_x = this.text_direction == 'left' ? -text_width : width;

            this.x = start_x + progress * (end_x - start_x);
            this.alpha = 255;
            this.life = 255 * (1 - progress);
        }
        else if (this.text_direction == 'up' || this.text_direction == 'down') {
            let textAlign_mode = (this.text_direction == 'up') ? TOP : TOP;
            textAlign(CENTER, textAlign_mode);
            textSize(this.size);
            let text_height = textAscent() + textDescent();

            let start_y = this.text_direction == 'up' ? height : -text_height;
            let end_y = this.text_direction == 'up' ? -text_height : height;

            this.y = start_y + progress * (end_y - start_y);
            this.alpha = 255;
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
            const xPos = parseFloat(this.args[1]) * width;
            const yPos = parseFloat(this.args[2]) * height;

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

var comments = [];

function preload() {
    // コメントの初期化
    for (var i = 0; i < max_number_of_comment; i++) {
        comments[i] = new Comment();
        comments[i].setLife(0);
    }

    let count_loaded = 0;
    // コメントの効果音（id_sound の番号順。配列のものはランダムに1つ鳴らす）
    sound = [
        [loadSound('./sounds/camera1.mp3', () => readyLoading(++count_loaded)),
        loadSound('./sounds/camera2.mp3', () => readyLoading(++count_loaded)),
        loadSound('./sounds/camera3.mp3', () => readyLoading(++count_loaded))],
        [loadSound('./sounds/clap1.mp3', () => readyLoading(++count_loaded)),
        loadSound('./sounds/clap2.mp3', () => readyLoading(++count_loaded)),
        loadSound('./sounds/clap3.mp3', () => readyLoading(++count_loaded)),
        loadSound('./sounds/clap4.mp3', () => readyLoading(++count_loaded)),
        loadSound('./sounds/clap5.mp3', () => readyLoading(++count_loaded)),
        loadSound('./sounds/clap6.mp3', () => readyLoading(++count_loaded)),
        loadSound('./sounds/clap7.mp3', () => readyLoading(++count_loaded)),
        loadSound('./sounds/clap8.mp3', () => readyLoading(++count_loaded))],
        loadSound('./sounds/cracker.mp3', () => readyLoading(++count_loaded)),
        loadSound('./sounds/kansei.mp3', () => readyLoading(++count_loaded)),
        loadSound('./sounds/he.wav', () => readyLoading(++count_loaded)),
        loadSound('./sounds/chottomatte.wav', () => readyLoading(++count_loaded)),
        loadSound('./sounds/OK.wav', () => readyLoading(++count_loaded)),
        loadSound('./sounds/punch.mp3', () => readyLoading(++count_loaded)),
        loadSound('./sounds/laugh3.mp3', () => readyLoading(++count_loaded)),
        [loadSound('./sounds/kusa00.mp3', () => readyLoading(++count_loaded)),
        loadSound('./sounds/kusa01.mp3', () => readyLoading(++count_loaded)),
        loadSound('./sounds/kusa02.mp3', () => readyLoading(++count_loaded)),
        loadSound('./sounds/kusa03.mp3', () => readyLoading(++count_loaded)),
        loadSound('./sounds/kusa04.mp3', () => readyLoading(++count_loaded)),
        loadSound('./sounds/kusa05.mp3', () => readyLoading(++count_loaded))]
    ]
    protofessional_effect = new ProtofessionalEffect();
}

function readyLoading(count_loaded) {
    document.getElementById('p5_loading').textContent = count_loaded + ' files loaded.';
}


function startSocketConnection(room) {
    g_room_name = room;

    // 環境に応じたSocket.IO接続
    let serverUrl = window.SOCKET_SERVER_URL || 'https://commentable.onrender.com';
    console.log('Connecting to socket server:', serverUrl);

    // socket.io クライアントは同梱しているので、サーバーが未起動でも接続を試み続ける
    function connectSocket() {
        socket = io.connect(serverUrl);
        setupSocketListeners();
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
        });

        socket.on('you_are_connected', function () {
            // 部屋名を指定してジョインする．
            socket.emit('join', room, { role: 'overlay' });
            // 実施中のアンケートがあれば再接続後に配信し直す（回答者のブラウザ側で重複表示はされない）
            if (activeSurvey) {
                socket.emit('survey start', activeSurvey);
            }
        });

        // アンケートの回答をメインプロセス（集計ウィンドウ）へ
        socket.on('survey answer', (data) => {
            if (window.electronAPI) {
                window.electronAPI.sendSurveyAnswer(data);
            }
        });

        socket.on('comment', newComment);

        // 管理者メッセージ（ダッシュボードの「メッセージ表示」カードから）
        socket.on('admin message', (data) => {
            toggleMessage(!!(data && data.show), data && data.text ? String(data.text) : '');
        });

        socket.on('reconnect', () => {
            console.log('you have been reconnected');
            socket.emit('join', room, { role: 'overlay' });
        });

        socket.on('login', (data) => {
            console.log("you have been connected to " + room);
            // 授業ログを購読して、この Mac にも保存する（サーバーのログが消えても残るように）
            socket.emit('log watch');
        });

        socket.on('log snapshot', (events) => {
            if (window.electronAPI && events.length > 0) window.electronAPI.archiveLogEvents(events);
        });

        socket.on('log event', (event) => {
            if (window.electronAPI) window.electronAPI.archiveLogEvents([event]);
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

    // 実際のクライアント領域のサイズを取得
    const actualWidth = document.documentElement.clientWidth || window.innerWidth;
    const actualHeight = document.documentElement.clientHeight || window.innerHeight;
    const pixelRatio = window.devicePixelRatio || 1;

    mycanvas = createCanvas(actualWidth, actualHeight);
    console.log('Canvas created:', actualWidth, 'x', actualHeight, 'DPR:', pixelRatio);
    document.getElementById("canvas_placeholder").append(mycanvas.elt);

    // デバイスピクセル比に合わせてピクセル密度を設定
    pixelDensity(Math.max(1, pixelRatio));

    // 初期ウィンドウサイズを記録
    applyCanvasSizeFromMetrics({
        width: actualWidth,
        height: actualHeight,
        scaleFactor: pixelRatio,
        physicalWidth: Math.round(actualWidth * pixelRatio),
        physicalHeight: Math.round(actualHeight * pixelRatio)
    });

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

        // アンケートの開始・終了をサーバーへ中継
        window.electronAPI.onSurveyStart((event, survey) => {
            activeSurvey = survey;
            if (socket) socket.emit('survey start', survey);
        });

        window.electronAPI.onSurveyEnd((event, data) => {
            activeSurvey = null;
            if (socket) socket.emit('survey end', data);
        });

        // ウィンドウリサイズイベントのリスナー
        window.electronAPI.onWindowResized((event, size) => {
            console.log('Received window resize:', size.width, 'x', size.height);
            applyCanvasSizeFromMetrics(size);
        });
    }

    // 部屋に接続し、QRコードを表示（IPC の受信準備ができてから始める）
    if (window.ROOM_NAME !== null && window.ROOM_NAME !== undefined) {
        startSocketConnection(window.ROOM_NAME);
        toggleQR(true, "top_right", window.ROOM_NAME);
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

    drawCamera();
    if (flg_clock) drawClock();
    drawComments();
    protofessional_effect.draw();
    flash.draw();
    drawCommentCommands();
    if (admin_message.show) drawAdminMessage();

    scheduleNextFrame();
}

// カメラ映像の表示サイズ（画面幅に対する比率）
function getCameraDisplaySize() {
    const vidWidth = width * personScale;
    const vidHeight = vidWidth / (cameraCapture.width / cameraCapture.height);
    return { vidWidth, vidHeight };
}

// マウスホバーで消すときの目標の不透明度
function cameraTargetAlpha() {
    const { vidWidth, vidHeight } = getCameraDisplaySize();
    const isMouseOverCamera = mouseX >= (personX - vidWidth / 2) &&
        mouseX <= (personX + vidWidth / 2) &&
        mouseY >= (personY - vidHeight / 2) &&
        mouseY <= (personY + vidHeight / 2);
    return isMouseOverCamera ? CAMERA_HOVER_ALPHA : 1.0;
}

function cameraFadeInProgress() {
    return isCameraVisible() && Math.abs(cameraTargetAlpha() - cameraAlpha) > 0.01;
}

function drawCamera() {
    if (!isCameraVisible()) return;
    const { vidWidth, vidHeight } = getCameraDisplaySize();

    // マウスがホバーしている場合はふわっと透過（フレームレートに依存しないイージング）
    cameraAlpha += (cameraTargetAlpha() - cameraAlpha) * (1 - Math.exp(-deltaTime / CAMERA_FADE_TIME));

    let source = cameraCapture.elt;
    if (cameraSegmentationEnabled) {
        requestSegmentation();
        source = segmentationReady ? segmentationOutputCanvas : null;
    }

    if (source && cameraAlpha > 0.01) {
        drawingContext.save();
        drawingContext.globalAlpha = cameraAlpha;
        drawingContext.drawImage(source,
            personX - vidWidth / 2, personY - vidHeight / 2, vidWidth, vidHeight);
        drawingContext.restore();
    }
}

function drawClock() {
    let now = new Date();
    let time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    textStyle(BOLD);
    strokeWeight(5.0);
    stroke("#000");
    fill("#ffffff");
    textSize(height / 15);
    textAlign(LEFT, TOP);
    text(time, 20, 10);
    textStyle(NORMAL);
}

function drawComments() {
    for (const comment of comments) {
        if (comment.getLife() > 0) {
            comment.update();
            // 表示時間が終わったコメントは描かない（ループ停止時に残像が残らないように）
            if (comment.getLife() > 0) comment.draw();
        }
    }
}

// コメントコマンドの描画と削除
function drawCommentCommands() {
    for (let i = commentCommands.length - 1; i >= 0; i--) {
        commentCommands[i].update();
        if (commentCommands[i].isActive) {
            commentCommands[i].draw();
        } else {
            commentCommands.splice(i, 1);
        }
    }
}

// 管理者メッセージ表示
function drawAdminMessage() {
    textAlign(CENTER, CENTER);
    textSize(height / 20);
    let txt = admin_message.text;
    let txtWidth = textWidth(txt);
    let txtHeight = textAscent() + textDescent();

    noStroke();
    fill("#000000");
    rect((width - txtWidth) / 2, (height - txtHeight) / 2, txtWidth, txtHeight);

    fill("#ffffff");
    text(txt, width / 2, height / 2);
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
    requestRender();

    console.log('Comment command executed:', parsed.functionName, parsed.args, 'colors:', colorText, colorTextStroke);
    return true;
}

function newComment(data) {
    // コメントコマンドチェック（= で始まる場合）
    if (data.comment && data.comment.startsWith('=')) {
        const executed = executeCommentCommand(data.comment, data.color_text, data.color_text_stroke);
        if (executed) {
            mainLog('Comment command processed:', data.comment);
            return;
        }
    }

    // 隠しコマンド
    if (data.hidden == 0) {
        protofessional_effect.setText(data.comment);
        protofessional_effect.setVolume(volume);
        protofessional_effect.activate();
    }
    else {
        // 通常のコメント
        if (data.comment.length <= 0) return;
        if (data.hidden >= 1) return; // 隠しコマンド（1以上）は表示しない
        const id = comments.findIndex(c => c.getLife() == 0);

        // パーティクルに空きがあれば
        if (id >= 0) {
            comments[id].setLife(255);
            comments[id].setText(data.comment);
            comments[id].text_direction = data.text_direction;
            comments[id].setFontSize(data.font_size || 'medium');
            textSize(height / 20);
            let text_width = textWidth(data.comment);

            if (text_width < width) {
                comments[id].setX(random(text_width / 2, width - text_width / 2));
            } else {
                comments[id].setX(text_width / 2);
            }
            comments[id].setY(random(100, height - 100));
            comments[id].setColor(data.color_text, data.color_text_stroke);
            comments[id].flg_image = data.flg_img;
            comments[id].id_image = data.id_img;
            comments[id].flg_sound = data.flg_sound;
            comments[id].id_sound = data.id_sound;

            requestRender();
            if (data.flg_sound && data.id_sound == 0) { // camera
                flash.do();
            }
            if (data.flg_sound && !flg_sound_mute) {
                comments[id].setVolume(volume);
                comments[id].playSound();
            }
            if (data.flg_speech && !data.flg_sound && !data.flg_emoji && !flg_sound_mute) {
                speech.speak(data.comment, volume);
            }
        }
    }
}

function applyCanvasSizeFromMetrics(metrics) {
    if (!metrics) {
        console.warn('applyCanvasSizeFromMetrics called without metrics');
        return;
    }

    // 最新のメトリクスを保存
    latestWindowMetrics = {
        width: metrics.width,
        height: metrics.height,
        scaleFactor: metrics.scaleFactor,
        physicalWidth: metrics.physicalWidth,
        physicalHeight: metrics.physicalHeight
    };

    const logicalWidth = Math.max(1, Math.round(metrics.width || (document.documentElement.clientWidth || window.innerWidth)));
    const logicalHeight = Math.max(1, Math.round(metrics.height || (document.documentElement.clientHeight || window.innerHeight)));
    const scaleFactor = metrics.scaleFactor && metrics.scaleFactor > 0 ? metrics.scaleFactor : (window.devicePixelRatio || 1);

    console.log('Applying canvas size:', logicalWidth, 'x', logicalHeight, 'Scale:', scaleFactor);

    if (mycanvas) {
        resizeCanvas(logicalWidth, logicalHeight);
        pixelDensity(Math.max(1, scaleFactor));
        mycanvas.elt.style.position = 'absolute';
        mycanvas.elt.style.top = '0';
        mycanvas.elt.style.left = '0';
        mycanvas.elt.style.width = '100%';
        mycanvas.elt.style.height = '100%';
    }

    const placeholder = document.getElementById('canvas_placeholder');
    if (placeholder) {
        placeholder.style.width = '100vw';
        placeholder.style.height = '100vh';
    }

    // カメラ位置を再計算
    if (cameraCapture) {
        updateCameraPosition();
    }

    // QRコードを再描画
    if (currentQRPosition !== 'none' && currentQRChecked) {
        toggleQR(currentQRChecked, currentQRPosition, currentQRRoom);
    }

    requestRedraw();
}

function windowResized() {
    if (latestWindowMetrics) {
        console.log('windowResized() using latest metrics');
        applyCanvasSizeFromMetrics(latestWindowMetrics);
        return;
    }

    const fallbackWidth = document.documentElement.clientWidth || window.innerWidth;
    const fallbackHeight = document.documentElement.clientHeight || window.innerHeight;
    const fallbackScale = window.devicePixelRatio || 1;

    console.log('windowResized() using fallback measurements');
    applyCanvasSizeFromMetrics({
        width: fallbackWidth,
        height: fallbackHeight,
        scaleFactor: fallbackScale,
        physicalWidth: Math.round(fallbackWidth * fallbackScale),
        physicalHeight: Math.round(fallbackHeight * fallbackScale)
    });
}

function toggleSoundMute() {
    flg_sound_mute = !flg_sound_mute;
}

function toggleClock(checked) {
    flg_clock = checked;
    scheduleClockTick();
    requestRedraw();
}

function toggleCommentControl(checked) {
    var data = {
        key: 'dummy',
        control: checked
    }
    socket.emit('deactivate_comment_control', data);
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
        hidden: 100,
        origin: 'host'
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
            console.log('Camera capture created:', cameraCapture.width, 'x', cameraCapture.height);
            cameraCapture.hide();
            updateCameraPosition();
            requestRender();
        });

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
        segmentationReady = false;
        segmentationLastVideoTime = -1;
        console.log('Camera stopped');
        requestRedraw(); // 最後のフレームを消す
    }
}

// 人物切り抜きのON/OFF
function setCameraSegmentation(enabled) {
    cameraSegmentationEnabled = enabled && !!(window.electronAPI && window.electronAPI.segmentPerson);
    segmentationReady = false;
    segmentationLastVideoTime = -1;
    console.log('Camera segmentation:', cameraSegmentationEnabled);
}

function createSegmentationCanvas(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return canvas;
}

// 現在のカメラフレームを Vision に送り、返ってきたマスクで切り抜く
// 1フレームずつ処理し、マスクは同じフレームに適用するので映像とずれない
async function requestSegmentation() {
    if (segmentationInFlight || !cameraCapture) return;

    const video = cameraCapture.elt;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (video.readyState < 2 || !vw || !vh) return;
    if (video.currentTime === segmentationLastVideoTime) return; // 新しいフレームがない
    segmentationLastVideoTime = video.currentTime;

    const iw = Math.min(SEGMENTATION_INPUT_WIDTH, vw);
    const ih = Math.round(vh * iw / vw);

    if (!segmentationFrameCanvas || segmentationFrameCanvas.width !== vw || segmentationFrameCanvas.height !== vh) {
        segmentationFrameCanvas = createSegmentationCanvas(vw, vh);
        segmentationOutputCanvas = createSegmentationCanvas(vw, vh);
        segmentationReady = false;
    }
    if (!segmentationInputCanvas || segmentationInputCanvas.width !== iw || segmentationInputCanvas.height !== ih) {
        segmentationInputCanvas = createSegmentationCanvas(iw, ih);
    }

    segmentationInFlight = true;
    try {
        segmentationFrameCanvas.getContext('2d').drawImage(video, 0, 0, vw, vh);
        const inputCtx = segmentationInputCanvas.getContext('2d', { willReadFrequently: true });
        inputCtx.drawImage(segmentationFrameCanvas, 0, 0, iw, ih);
        const frame = inputCtx.getImageData(0, 0, iw, ih);

        const result = await window.electronAPI.segmentPerson(frame.data, iw, ih);
        if (!cameraSegmentationEnabled || !cameraCapture) return;

        // マスク（0-255）をアルファチャンネルに入れる
        if (!segmentationMaskCanvas || segmentationMaskCanvas.width !== result.width || segmentationMaskCanvas.height !== result.height) {
            segmentationMaskCanvas = createSegmentationCanvas(result.width, result.height);
        }
        const maskImage = new ImageData(result.width, result.height);
        const mask = result.data;
        for (let i = 0; i < mask.length; i++) {
            maskImage.data[i * 4 + 3] = mask[i];
        }
        segmentationMaskCanvas.getContext('2d').putImageData(maskImage, 0, 0);

        // フレームをマスクで切り抜く（マスクは拡大時に補間されるので輪郭が滑らかになる）
        const outCtx = segmentationOutputCanvas.getContext('2d');
        outCtx.save();
        outCtx.globalCompositeOperation = 'copy';
        outCtx.drawImage(segmentationFrameCanvas, 0, 0);
        outCtx.globalCompositeOperation = 'destination-in';
        outCtx.imageSmoothingEnabled = true;
        outCtx.imageSmoothingQuality = 'high';
        outCtx.drawImage(segmentationMaskCanvas, 0, 0, vw, vh);
        outCtx.restore();
        segmentationReady = true;
    } catch (error) {
        console.error('Segmentation error:', error);
    } finally {
        segmentationInFlight = false;
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
    const sizeMap = {
        'small': 0.15,
        'medium': 0.25,
        'large': 0.40
    };
    personScale = sizeMap[size] || 0.15;
    updateCameraPosition();
    console.log('Camera size set to:', size, 'scale:', personScale);
}

// カメラ位置を更新
function updateCameraPosition() {
    if (!cameraCapture) return;

    const margin = 50;
    const targetWidth = width * personScale;
    const aspectRatio = cameraCapture.width / cameraCapture.height;
    const vidHeight = targetWidth / aspectRatio;
    const vidWidth = targetWidth;

    const halfWidth = vidWidth / 2;
    const halfHeight = vidHeight / 2;

    const positions = {
        'top-left': [margin + halfWidth, margin + halfHeight],
        'top-right': [width - margin - halfWidth, margin + halfHeight],
        'bottom-left': [margin + halfWidth, height - margin - halfHeight],
        'bottom-right': [width - margin - halfWidth, height - margin - halfHeight],
        'center': [width / 2, height / 2]
    };

    const pos = positions[cameraPosition] || positions['bottom-left'];
    personX = pos[0];
    personY = pos[1];
    requestRender();
}
