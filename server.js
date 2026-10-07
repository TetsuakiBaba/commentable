const fs = require('fs');
const path = require('path');
const eventLog = require('./event-log');
const roomAuth = require('./room-auth');

// コメントログファイルのパス
const LOG_DIR = path.join(__dirname, 'public', 'chatlogs');

// ログディレクトリが存在しない場合は作成
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    console.log('Created log directory:', LOG_DIR);
}

// 部屋ごとのコメントログ（従来形式）のパス。
// 英数字以外を含む部屋名はハッシュ付きの名前にして、別の部屋のログが混ざらないようにする
function legacyCommentLogFile(room) {
    return path.join(LOG_DIR, `${eventLog.roomKey(room)}.log`);
}

// コメントをログファイルに追記する関数
function saveCommentLog(data, room) {
    try {
        if (!room) {
            console.warn('Room name is empty, skipping log save');
            return;
        }

        const logFile = legacyCommentLogFile(room);

        const timestamp = new Date().toISOString();
        const logEntry = JSON.stringify({
            timestamp,
            room,
            username: data.my_name || 'Anonymous',
            comment: data.comment,
            emoji: data.flg_emoji || false,
            sound: data.flg_sound || false,
            socketid: data.socketid
        });

        // ログファイルに追記（1行ずつ）
        fs.appendFileSync(logFile, logEntry + '\n', 'utf8');
    } catch (error) {
        console.error('Error saving comment log:', error);
    }
}

// アンケート結果のログファイル（部屋ごとに JSON 配列で保存）
function surveyLogFile(room) {
    return path.join(LOG_DIR, `${eventLog.roomKey(room)}.surveys.json`);
}

function loadSurveyLog(room) {
    try {
        const file = surveyLogFile(room);
        if (fs.existsSync(file)) {
            const log = JSON.parse(fs.readFileSync(file, 'utf8'));
            return Array.isArray(log) ? log : [];
        }
    } catch (error) {
        console.error('Error loading survey log:', error);
    }
    return [];
}

function saveSurveyRecord(room, record) {
    try {
        if (!room) return;
        const log = loadSurveyLog(room);
        const index = log.findIndex(r => r.id === record.id);
        if (index >= 0) {
            log[index] = record;
        } else {
            log.push(record);
        }
        fs.writeFileSync(surveyLogFile(room), JSON.stringify(log, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving survey log:', error);
    }
}

// 回答のたびに書き込まないよう、アンケートごとに少し待ってまとめて保存する
const SURVEY_SAVE_DELAY_MS = 1000;
const pendingSurveySaves = {};

function scheduleSurveySave(room, id, getRecord) {
    const key = `${room}\n${id}`;
    if (pendingSurveySaves[key]) return;
    pendingSurveySaves[key] = setTimeout(() => {
        delete pendingSurveySaves[key];
        saveSurveyRecord(room, getRecord());
    }, SURVEY_SAVE_DELAY_MS);
}

function flushSurveySave(room, record) {
    const key = `${room}\n${record.id}`;
    if (pendingSurveySaves[key]) {
        clearTimeout(pendingSurveySaves[key]);
        delete pendingSurveySaves[key];
    }
    saveSurveyRecord(room, record);
}

// ローカル開発環境では3000番ポート、本番環境では80番ポート
var port = process.env.PORT || (process.env.NODE_ENV === 'production' ? 80 : 3000);
var express = require('express');
var app = express();

// JSONボディパーサーを追加（ダッシュボードAPI用）
app.use(express.json());

// CORS設定
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

// ダッシュボードAPIルーターを読み込み
const dashboardRouter = require('./dashboard-api');
app.use(dashboardRouter);

// 配信者（ダッシュボードのトークン）だけが読める API の認証
// トークンはヘッダー X-Room-Token で受け取る
function authorizeRoom(req, res, room) {
    if (roomAuth.verifyDashboardToken(room, req.get('X-Room-Token'))) return true;
    res.status(403).json({ error: 'forbidden' });
    return false;
}

// 授業ログ（イベントログ）の読み出しAPI
app.use(eventLog.createRouter({ legacyCommentLogFile, authorize: authorizeRoom }));

// アンケート結果（ダッシュボードの結果カード用）
app.get('/api/rooms/:room/surveys', (req, res) => {
    if (!authorizeRoom(req, res, req.params.room)) return;
    res.json(loadSurveyLog(req.params.room));
});

var server = app.listen(port, () => console.log('listening on', port));

app.use(express.static('./public'));

let broadcaster;
var socket = require('socket.io');
const options = {
    serveClient: true,
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: false
    },
    pingInterval: 15000, // サーバからのping間隔（ミリ秒）
    pingTimeout: 10000   // pongが返らなければ切断（ミリ秒）
    //pingTimeout: 25000,
    //pingInterval: 5000,
    //transports: ['polling']
    //transports: ['websockets']
}
var io = socket(server, options);

// ルームごとの状態を保持するためのメタデータ格納オブジェクト
// roomState[roomName] = { deactivate_comment_control: boolean }
const roomState = {};

// アンケートの回答を受け取る配信者（Electron）用のルーム名
function surveyHostRoom(roomName) {
    return `${roomName}::survey-host`;
}

// アンケート結果をリアルタイムで受け取るダッシュボード用のルーム名
function surveyWatchRoom(roomName) {
    return `${roomName}::survey-watch`;
}

// ログ・ダッシュボード用のアンケート結果
function surveyRecord(roomName, survey) {
    return {
        id: survey.data.id,
        room: roomName,
        question: survey.data.question,
        choices: survey.data.choices,
        multiple: survey.data.multiple,
        counts: survey.counts,
        respondents: survey.respondents,
        startedAt: survey.startedAt,
        endedAt: survey.endedAt || null,
        active: !survey.endedAt
    };
}

// アンケートの内容を検証・整形する
function sanitizeSurvey(data) {
    if (!data || typeof data.id !== 'string' || typeof data.question !== 'string' || !Array.isArray(data.choices)) {
        return null;
    }
    const question = data.question.trim().slice(0, 500);
    const choices = data.choices
        .filter(c => typeof c === 'string')
        .map(c => c.trim().slice(0, 200))
        .filter(c => c !== '')
        .slice(0, 20);
    if (question === '' || choices.length < 2) {
        return null;
    }
    return { id: data.id.slice(0, 64), question, choices, multiple: !!data.multiple };
}

// 授業ログをリアルタイムで受け取るダッシュボード・配信画面用のルーム名
function logWatchRoom(roomName) {
    return `${roomName}::log-watch`;
}

const CLIENT_ROLES = ['participant', 'overlay', 'dashboard'];

function sanitizeParticipantId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
}

function str(value, max = 500) {
    return typeof value === 'string' ? value.slice(0, max) : '';
}

// 参加者が名前欄に入れた名前（学修番号など）。未入力や初期値の判定は読み出す側で行う
function sanitizeParticipantName(value) {
    return str(value, 100).trim();
}

// 参加者の出来事に付ける本人の情報（配信者側の接続には付けない）
function participantFields(socket, fallbackId = socket.id) {
    if (socket.role !== 'participant') {
        return { participant_id: null };
    }
    return {
        participant_id: socket.participantId || fallbackId,
        name: socket.participantName || undefined
    };
}

// 受け取ったコメントを授業ログの1件に変換する
function commentEventFields(data, socket) {
    const text = str(data.comment, 10000);
    const hidden = Number.isInteger(Number(data.hidden)) ? Number(data.hidden) : -1;
    const actor = !socket.isHost ? 'participant'
        : data.origin === 'ai' ? 'ai'
            : 'host';
    const base = {
        actor,
        participant_id: actor === 'participant' ? (socket.participantId || socket.id) : null,
        name: str(data.my_name, 100)
    };
    if (hidden === 100) {
        return { ...base, type: 'material', text };
    }
    if (data.flg_emoji) {
        return {
            ...base,
            type: 'reaction',
            emoji: text,
            sound_id: data.flg_sound ? Number(data.id_sound) : null
        };
    }
    return {
        ...base,
        type: 'comment',
        text,
        hidden: hidden >= 0 ? hidden : undefined,
        trigger: actor === 'ai' ? str(data.trigger, 20) || undefined : undefined,
        display: {
            color: str(data.color_text, 20) || undefined,
            stroke: str(data.color_text_stroke, 20) || undefined,
            direction: str(data.text_direction, 10) || undefined,
            size: str(data.font_size, 10) || undefined,
            read_aloud: !!data.flg_speech
        }
    };
}

function getRoomUserCount(roomName) {
    const roomRef = io.sockets.adapter.rooms.get(roomName);
    return roomRef ? roomRef.size : 0;
}


io.on('connection', (socket) => {
    console.log('connection', socket.id);
    var room = "";
    var room_master = "-master";
    // ルームの制御フラグは roomState に集約（ソケット毎に保持しない）

    // 接続者に対してコネクションを作ったことを知らせるメッセージ
    socket.emit('you_are_connected');

    // 配信画面・ダッシュボードとして認証された接続だけが行える操作か
    function isHostSocket() {
        return room !== "" && socket.isHost === true;
    }

    // join(部屋名, { role, participantId, hostKey, token }) ※第2引数のない古いクライアントは参加者として扱う
    socket.on("join", (room_to_join, info) => {
        if (typeof room_to_join !== 'string' || room_to_join == "") room_to_join = "undefined-room"
        const requestedRole = info && CLIENT_ROLES.includes(info.role) ? info.role : 'participant';

        // 配信画面は部屋の鍵、ダッシュボードはトークンで認証する（違えば入室させない）
        if (requestedRole === 'overlay') {
            const result = roomAuth.claimOrVerifyHost(room_to_join, info.hostKey);
            if (!result.ok) {
                console.log(socket.id, 'overlay rejected for', room_to_join, result.reason);
                socket.emit('join rejected', { role: 'overlay', reason: result.reason });
                return;
            }
        } else if (requestedRole === 'dashboard') {
            if (!roomAuth.verifyDashboardToken(room_to_join, info.token)) {
                console.log(socket.id, 'dashboard rejected for', room_to_join);
                socket.emit('join rejected', { role: 'dashboard', reason: 'invalid_token' });
                return;
            }
        }
        socket.isHost = requestedRole !== 'participant';

        socket.join(room_to_join);
        console.log(socket.id, " joined to ", room_to_join);
        room = room_to_join;
        socket.role = requestedRole;
        socket.participantId = sanitizeParticipantId(info && info.participantId);
        socket.participantName = socket.role === 'participant' ? sanitizeParticipantName(info && info.name) : '';

        // ルーム状態初期化
        if (!roomState[room]) {
            roomState[room] = { deactivate_comment_control: false };
        }

        const number_of_users = getRoomUserCount(room);
        console.log('user count (join):', number_of_users);

        // we store the username in the socket session for this client
        socket.username = socket.id; //username;
        socket.emit('login', {
            numUsers: number_of_users,
            deactivate_comment_control: roomState[room].deactivate_comment_control
        });
        // echo globally (all clients) that a person has connected
        socket.to(room).emit('user joined', {
            username: socket.username,
            numUsers: number_of_users
        });

        eventLog.logEvent(room, {
            type: 'join',
            actor: socket.role === 'participant' ? 'participant' : 'host',
            role: socket.role,
            ...participantFields(socket),
            connection_id: socket.id,
            connections: number_of_users
        });

        // 実施中のアンケートがあれば途中参加者にも表示
        if (roomState[room].survey) {
            socket.emit('survey start', roomState[room].survey.data);
        }

        // 表示中の管理者メッセージ（配信画面の再起動やダッシュボードの開き直しでも状態を合わせる）
        if (roomState[room].adminMessage) {
            socket.emit('admin message', roomState[room].adminMessage);
        }
    });
    socket.on("join-as-master", (room_to_join) => {
        if (room_to_join == "") room_to_join = "undefined-room"
        socket.join(room_to_join);
        //console.log(socket.id, "joined master to ", room_to_join);
        room_master = room_to_join;
    });

    // when the client emits 'new message', this listens and executes
    socket.on('new message', (data) => {
        // we tell the client to execute 'new message'
        socket.to(room).emit('new message', {
            username: socket.username,
            message: data
        });
    });




    // when the client emits 'new message', this listens and executes
    socket.on('comment', (data) => {
        // we tell the client to execute 'new message'
        data.socketid = socket.id;

        // 名前欄を変えた直後にコメントした場合など、記録している名前をコメントの名前に合わせる
        if (socket.role === 'participant') {
            const name = sanitizeParticipantName(data.my_name);
            if (name) socket.participantName = name;
        }

        // コメントをログファイルに保存
        saveCommentLog(data, room);
        eventLog.logEvent(room, commentEventFields(data, socket));

        // 全員に送信
        socket.to(room).emit('comment', data);
    });

    // 参加者が名前欄を変更したとき（授業ログで入退室・アンケート回答を本人に結びつけるため）
    socket.on('profile', (data) => {
        if (room === '' || socket.role !== 'participant' || !data) return;
        const name = sanitizeParticipantName(data.name);
        if (name === (socket.participantName || '')) return;
        const previous = socket.participantName || '';
        socket.participantName = name;
        eventLog.logEvent(room, {
            type: 'name_change',
            actor: 'participant',
            ...participantFields(socket),
            previous
        });
    });

    socket.on('delete comment', (data) => {
        if (!isHostSocket()) return;
        eventLog.logEvent(room, { type: 'delete_comment', actor: 'host', target: data });
        socket.to(room).emit('delete comment', data);
    });

    // 配信者の発言（ダッシュボードの音声認識の確定結果）
    socket.on('speech transcript', (data) => {
        const text = data && str(data.text, 2000).trim();
        if (!isHostSocket() || !text) return;
        eventLog.logEvent(room, { type: 'speech', actor: 'host', text });
    });

    // 授業ログの購読（現在の授業回のログを返し、以降は1件ずつ送る）
    socket.on('log watch', () => {
        if (!isHostSocket()) return;
        socket.join(logWatchRoom(room));
        socket.emit('log snapshot', eventLog.currentSessionEvents(room));
    });

    socket.on('letter', (data) => {
        socket.to(room_master).emit('letter', data);
    });


    socket.on('deactivate_comment_control', (data) => {
        if (!isHostSocket() || !data) {
            return; // 配信者以外・join 前は無視
        }
        if (!roomState[room]) {
            roomState[room] = { deactivate_comment_control: false };
        }
        roomState[room].deactivate_comment_control = data.control;
        eventLog.logEvent(room, { type: 'comment_control', actor: 'host', unrestricted: !!data.control });
        socket.to(room).emit('deactivate_comment_control', data);
    });

    // アンケート開始（配信者から）
    socket.on('survey start', (data) => {
        if (!isHostSocket()) return;
        const survey = sanitizeSurvey(data);
        if (!survey) return;
        if (!roomState[room]) {
            roomState[room] = { deactivate_comment_control: false };
        }
        // 再接続時の再送（同じID）は回答済みリストと集計を引き継ぐ
        const current = roomState[room].survey;
        if (!current || current.data.id !== survey.id) {
            const next = {
                data: survey,
                voters: new Set(),
                counts: survey.choices.map(() => 0),
                respondents: 0,
                startedAt: new Date().toISOString(),
                endedAt: null
            };
            // サーバー再起動後の再送ならログから集計を復元
            const logged = loadSurveyLog(room).find(r => r.id === survey.id);
            if (logged && Array.isArray(logged.counts) && logged.counts.length === survey.choices.length) {
                next.counts = logged.counts;
                next.respondents = logged.respondents || 0;
                next.startedAt = logged.startedAt || next.startedAt;
            }
            roomState[room].survey = next;
            if (!logged) {
                eventLog.logEvent(room, {
                    type: 'survey_start',
                    actor: 'host',
                    survey_id: survey.id,
                    question: survey.question,
                    choices: survey.choices,
                    multiple: survey.multiple
                });
            }
            flushSurveySave(room, surveyRecord(room, next));
            io.to(surveyWatchRoom(room)).emit('survey update', surveyRecord(room, next));
        }
        socket.join(surveyHostRoom(room));
        socket.to(room).emit('survey start', survey);
    });

    // アンケート終了（配信者から）
    socket.on('survey end', (data) => {
        if (!isHostSocket() || !roomState[room] || !roomState[room].survey) return;
        if (data && data.id && roomState[room].survey.data.id !== data.id) return;
        const survey = roomState[room].survey;
        survey.endedAt = new Date().toISOString();
        delete roomState[room].survey;
        eventLog.logEvent(room, {
            type: 'survey_end',
            actor: 'host',
            survey_id: survey.data.id,
            counts: survey.counts,
            respondents: survey.respondents
        });
        flushSurveySave(room, surveyRecord(room, survey));
        io.to(surveyWatchRoom(room)).emit('survey update', surveyRecord(room, survey));
        socket.to(room).emit('survey end', { id: survey.data.id });
    });

    // 管理者メッセージの表示・非表示（ダッシュボードから）→ 配信画面に中継
    socket.on('admin message', (data) => {
        if (!isHostSocket() || !data) return;
        const message = {
            show: !!data.show,
            text: typeof data.text === 'string' ? data.text.trim().slice(0, 100) : ''
        };
        if (message.show && message.text === '') return;
        if (!roomState[room]) {
            roomState[room] = { deactivate_comment_control: false };
        }
        roomState[room].adminMessage = message.show ? message : null;
        eventLog.logEvent(room, { type: 'admin_message', actor: 'host', show: message.show, text: message.text });
        socket.to(room).emit('admin message', message);
    });

    // ダッシュボードからアンケート結果の購読（ログ全体を返し、以降は更新を送る）
    socket.on('survey watch', () => {
        if (!isHostSocket()) return;
        socket.join(surveyWatchRoom(room));
        socket.emit('survey log', loadSurveyLog(room));
    });

    // アンケート回答（参加者から）→ 配信者にだけ送る
    socket.on('survey answer', (data) => {
        if (room === "" || !roomState[room] || !roomState[room].survey || !data) return;
        const survey = roomState[room].survey;
        if (data.id !== survey.data.id) return;

        // 同じブラウザ（voterId）・同じ接続からの重複回答は受け付けない
        const voterId = typeof data.voterId === 'string' && data.voterId ? data.voterId.slice(0, 64) : socket.id;
        if (survey.voters.has(voterId) || survey.voters.has(socket.id)) return;

        const indexes = Array.isArray(data.choices) ? data.choices : [];
        const choices = [...new Set(indexes)]
            .filter(i => Number.isInteger(i) && i >= 0 && i < survey.data.choices.length);
        if (choices.length === 0 || (!survey.data.multiple && choices.length > 1)) return;

        survey.voters.add(voterId);
        survey.voters.add(socket.id);
        choices.forEach(i => survey.counts[i]++);
        survey.respondents++;
        eventLog.logEvent(room, {
            type: 'survey_answer',
            actor: 'participant',
            ...participantFields(socket, voterId),
            survey_id: survey.data.id,
            choices,
            choice_labels: choices.map(i => survey.data.choices[i])
        });
        io.to(surveyHostRoom(room)).emit('survey answer', { id: survey.data.id, voterId, choices });

        const roomName = room;
        io.to(surveyWatchRoom(roomName)).emit('survey update', surveyRecord(roomName, survey));
        scheduleSurveySave(roomName, survey.data.id, () => surveyRecord(roomName, survey));
    });

    // when the user disconnects.. perform this
    socket.on('disconnect', () => {
        // disconnect イベント時点ではアダプタから既に除去されているので再計算
        const number_of_users = getRoomUserCount(room);
        socket.to(room).emit('user left', {
            username: socket.username,
            numUsers: number_of_users
        });
        socket.to(broadcaster).emit("disconnectPeer", socket.id, number_of_users);
        // 明示的 leave は不要（Socket.IO が処理）
        if (room !== "" && socket.role === 'overlay') {
            roomAuth.touchHost(room);
        }
        if (room !== "") {
            eventLog.logEvent(room, {
                type: 'leave',
                actor: socket.role === 'participant' ? 'participant' : 'host',
                role: socket.role,
                ...participantFields(socket),
                connection_id: socket.id,
                connections: number_of_users
            });
        }
    });
});

// 記録した出来事を購読中のダッシュボード・配信画面に送る
eventLog.onEvent((roomName, event) => {
    io.to(logWatchRoom(roomName)).emit('log event', event);
});



// チャットログの自動削除設定
// ログの保持期間（古いログを削除する基準）
const LOG_RETENTION_DAYS = 21;      // 日数で指定（例: 21 = 3週間）
// const LOG_RETENTION_HOURS = 1;   // テスト用: 時間で指定する場合はこちらを使用
// const LOG_RETENTION_MINUTES = 2; // テスト用: 分で指定する場合はこちらを使用

// クリーンアップチェック間隔（どのくらいの頻度で古いログをチェックするか）
const CLEANUP_CHECK_INTERVAL_HOURS = 24;    // 時間で指定（例: 24 = 1日1回）
// const CLEANUP_CHECK_INTERVAL_MINUTES = 1; // テスト用: 分で指定する場合はこちらを使用

// 保持期間の計算（優先順位: MINUTES > HOURS > DAYS）
const getRetentionPeriodMs = () => {
    if (typeof LOG_RETENTION_MINUTES !== 'undefined') {
        return LOG_RETENTION_MINUTES * 60 * 1000;
    } else if (typeof LOG_RETENTION_HOURS !== 'undefined') {
        return LOG_RETENTION_HOURS * 60 * 60 * 1000;
    } else {
        return LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    }
};

// チェック間隔の計算（優先順位: MINUTES > HOURS）
const getCheckIntervalMs = () => {
    if (typeof CLEANUP_CHECK_INTERVAL_MINUTES !== 'undefined') {
        return CLEANUP_CHECK_INTERVAL_MINUTES * 60 * 1000;
    } else {
        return CLEANUP_CHECK_INTERVAL_HOURS * 60 * 60 * 1000;
    }
};

// 設定の表示用テキスト生成
const getRetentionPeriodText = () => {
    if (typeof LOG_RETENTION_MINUTES !== 'undefined') {
        return `${LOG_RETENTION_MINUTES} minutes`;
    } else if (typeof LOG_RETENTION_HOURS !== 'undefined') {
        return `${LOG_RETENTION_HOURS} hours`;
    } else {
        return `${LOG_RETENTION_DAYS} days`;
    }
};

const getCheckIntervalText = () => {
    if (typeof CLEANUP_CHECK_INTERVAL_MINUTES !== 'undefined') {
        return `every ${CLEANUP_CHECK_INTERVAL_MINUTES} minutes`;
    } else {
        return `every ${CLEANUP_CHECK_INTERVAL_HOURS} hours`;
    }
};

// 古いチャットログを削除する関数
function cleanupOldChatLogs() {
    try {
        const files = fs.readdirSync(LOG_DIR);
        const now = Date.now();
        const retentionPeriodMs = getRetentionPeriodMs();
        let deletedCount = 0;

        files.forEach(file => {
            const filePath = path.join(LOG_DIR, file);

            // .log ファイルとアンケート結果（.surveys.json）が対象
            if (path.extname(file) !== '.log' && !file.endsWith('.surveys.json')) {
                return;
            }

            try {
                const stats = fs.statSync(filePath);
                const lastModified = stats.mtime.getTime();
                const ageInMs = now - lastModified;

                // 保持期間を超えた場合は削除
                if (ageInMs > retentionPeriodMs) {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                    const ageInMinutes = Math.floor(ageInMs / (60 * 1000));
                    const ageInHours = Math.floor(ageInMs / (60 * 60 * 1000));
                    const ageInDays = Math.floor(ageInMs / (24 * 60 * 60 * 1000));

                    let ageText;
                    if (ageInDays > 0) {
                        ageText = `${ageInDays} days old`;
                    } else if (ageInHours > 0) {
                        ageText = `${ageInHours} hours old`;
                    } else {
                        ageText = `${ageInMinutes} minutes old`;
                    }

                    console.log(`Deleted old chat log: ${file} (${ageText}, last modified: ${stats.mtime.toISOString()})`);
                }
            } catch (error) {
                console.error(`Error processing file ${file}:`, error);
            }
        });

        // 授業ログ（logs/events）も同じ保持期間で削除する
        deletedCount += eventLog.cleanup(retentionPeriodMs);

        if (deletedCount > 0) {
            console.log(`Cleanup completed: ${deletedCount} old chat log(s) deleted`);
        } else {
            console.log('Cleanup completed: No old chat logs to delete');
        }
    } catch (error) {
        console.error('Error during chat log cleanup:', error);
    }
}

// 定期的にチャットログをクリーンアップ
const CLEANUP_INTERVAL_MS = getCheckIntervalMs();
setInterval(cleanupOldChatLogs, CLEANUP_INTERVAL_MS);

// サーバー起動時にも一度実行
cleanupOldChatLogs();

console.log(`Chat log cleanup scheduled:`);
console.log(`  - Check interval: ${getCheckIntervalText()}`);
console.log(`  - Retention period: ${getRetentionPeriodText()}`);
