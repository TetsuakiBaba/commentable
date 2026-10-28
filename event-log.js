// 授業の出来事（コメント・リアクション・音声認識・AIの応答・入退室・アンケート・運営操作）を
// 1本の JSON Lines に記録する。授業回（セッション）ごとに1ファイル。
//
// 1行の例:
// {"schema":1,"event_id":"…","session_id":"20261006-230333","room":"Computer_Class",
//  "t":"2026-10-06T14:03:33.123Z","elapsed_s":12.3,"type":"comment","actor":"participant",
//  "participant_id":"…","name":"24123456","text":"なるほど"}
//
// 配信者がダッシュボードで「授業開始」を押すと新しい授業回が始まり（class_start）、
// 「授業終了」（class_end）以降の出来事は次の授業回になる。押さなかった場合は、
// 出来事が SESSION_GAP_MS 途切れたところで自動的に区切る（class_start のない授業回）。
//
// ファイルは公開フォルダの外（logs/events/<部屋キー>/<セッションID>.jsonl）に置き、
// 読み出しは API（/api/rooms/:room/...）経由で行う。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const SCHEMA_VERSION = 1;
const EVENTS_DIR = path.join(__dirname, 'logs', 'events');
// この時間イベントがなければ、次のイベントから新しい授業回として記録する
const SESSION_GAP_MS = 3 * 60 * 60 * 1000;
// 入退室だけでは授業回を続けない・始めない（つなぎっぱなしの画面の再接続で、授業回が何日も続かないように）
const PRESENCE_TYPES = new Set(['join', 'leave']);
// セッションIDに使うタイムゾーン（授業の開始時刻がそのまま読めるように）
const SESSION_TIMEZONE = process.env.LOG_TIMEZONE || 'Asia/Tokyo';
const SESSION_ID_PATTERN = /^\d{8}-\d{6}$/;

// 部屋名からファイル名に使えるキーを作る。
// 英数字以外を置き換えると「授業A」と「講義A」が同じ名前になるので、その場合はハッシュを付けて区別する
function roomKey(room) {
    const safe = String(room).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    if (safe === room) return safe;
    const hash = crypto.createHash('sha1').update(String(room)).digest('hex').slice(0, 8);
    return `${safe}_${hash}`;
}

function roomDir(room) {
    return path.join(EVENTS_DIR, roomKey(room));
}

function sessionFile(room, sessionId) {
    return path.join(roomDir(room), `${sessionId}.jsonl`);
}

function formatSessionId(ms) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: SESSION_TIMEZONE,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
    return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

function readEvents(file) {
    try {
        return fs.readFileSync(file, 'utf8').split('\n')
            .filter(line => line.trim() !== '')
            .map(line => {
                try { return JSON.parse(line); } catch (e) { return null; }
            })
            .filter(Boolean);
    } catch (error) {
        return [];
    }
}

function listSessionIds(room) {
    try {
        return fs.readdirSync(roomDir(room))
            .filter(f => f.endsWith('.jsonl') && SESSION_ID_PATTERN.test(f.slice(0, -6)))
            .map(f => f.slice(0, -6))
            .sort();
    } catch (error) {
        return [];
    }
}

// 部屋ごとの現在の授業回 { id, startedAt, lastAt, inClass, closed, classStartedAt }
//   lastAt: 入退室以外の最後の出来事の時刻
//   classStartedAt: 授業の開始時刻（後から記録した場合は授業回の始まりより後になる）
//   inClass: 配信者が「授業開始」で始めた授業回で、まだ終了していない
//   closed: 「授業終了」済み（入退室だけはこの回に記録し、ほかの出来事は新しい授業回にする）
const sessions = new Map();
const listeners = [];
// 授業回を新しく始めたときに、その時点で接続している人を入室として記録するための関数
let presenceProvider = () => [];

function appendEvent(room, sessionId, event) {
    fs.mkdirSync(roomDir(room), { recursive: true });
    fs.appendFileSync(sessionFile(room, sessionId), JSON.stringify(event) + '\n', 'utf8');
}

// 入退室以外の最後の出来事の時刻（後から記録した授業開始などは時刻順に並んでいないので、行の順ではなく時刻で見る）
// 出来事がなければ null
function lastActivityAt(events) {
    const last = events
        .filter(ev => !PRESENCE_TYPES.has(ev.type))
        .reduce((max, ev) => Math.max(max, Date.parse(ev.t)), -Infinity);
    return Number.isFinite(last) ? last : null;
}

// サーバーの再起動後に、最後の授業回の状態をファイルから戻す
function restoreSession(room) {
    const latest = listSessionIds(room).pop();
    if (!latest) return null;
    const events = readEvents(sessionFile(room, latest));
    const lastAt = lastActivityAt(events);
    if (lastAt === null) return null;
    const ended = events.some(ev => ev.type === 'class_end');
    const classStart = events.find(ev => ev.type === 'class_start');
    return {
        id: latest,
        startedAt: Date.parse(events[0].t),
        lastAt,
        inClass: !ended && !!classStart,
        closed: ended,
        classStartedAt: classStart ? Date.parse(classStart.t) : null
    };
}

function latestSession(room) {
    let session = sessions.get(room);
    if (!session) {
        session = restoreSession(room);
        if (session) sessions.set(room, session);
    }
    return session || null;
}

function isLive(session, now) {
    return !!session && now - session.lastAt < SESSION_GAP_MS;
}

// 新しい授業回を始める。接続中の人は入室したものとして記録する（在室時間の計算に使う）
function openSession(room, now, excludeConnectionId) {
    // 同じ秒に授業回が続けて始まってもファイルが重ならないようにする
    let ms = now;
    while (fs.existsSync(sessionFile(room, formatSessionId(ms)))) ms += 1000;
    const session = { id: formatSessionId(ms), startedAt: now, lastAt: now, inClass: false, closed: false };
    sessions.set(room, session);
    writeEvent(room, session, now, { type: 'session_start', actor: 'system' });
    let present = [];
    try {
        present = presenceProvider(room) || [];
    } catch (error) {
        console.error('Presence provider error:', error);
    }
    present
        .filter(fields => !excludeConnectionId || fields.connection_id !== excludeConnectionId)
        .forEach(fields => writeEvent(room, session, now, { ...fields, type: 'join', carried_over: true }));
    return session;
}

// 出来事を記録する授業回を返す（なければ作る）。サーバーが再起動しても、直前の授業回が続いていれば引き継ぐ
function currentSession(room, now, fields) {
    const session = latestSession(room);
    if (PRESENCE_TYPES.has(fields.type)) {
        // 入退室は直前の授業回に記録する（入退室だけで授業回を作らない）
        return session || openSession(room, now, fields.connection_id);
    }
    if (isLive(session, now) && !session.closed) {
        return session;
    }
    return openSession(room, now);
}

function writeEvent(room, session, now, fields) {
    const event = {
        schema: SCHEMA_VERSION,
        event_id: crypto.randomUUID(),
        session_id: session.id,
        room,
        t: new Date(now).toISOString(),
        elapsed_s: Math.round((now - session.startedAt) / 100) / 10,
        ...fields
    };
    appendEvent(room, session.id, event);
    if (!PRESENCE_TYPES.has(event.type)) session.lastAt = Math.max(session.lastAt, now);
    listeners.forEach(fn => {
        try { fn(room, event); } catch (error) { console.error('Event listener error:', error); }
    });
    return event;
}

// 出来事を1件記録する。fields には type と actor（participant / host / ai / system）を含める
function logEvent(room, fields) {
    if (!room) return null;
    try {
        const now = Date.now();
        return writeEvent(room, currentSession(room, now, fields), now, fields);
    } catch (error) {
        console.error('Error writing event log:', error);
        return null;
    }
}

// 授業を始める：新しい授業回を作り、授業の開始を記録する（授業前の動作確認などは前の授業回に残る）
// 授業中に呼ばれた場合は、いまの授業を終えてから新しい授業回を始める
function startClass(room, fields = {}) {
    if (!room) return null;
    try {
        const now = Date.now();
        const previous = latestSession(room);
        if (previous && previous.inClass && isLive(previous, now)) {
            endSession(room, previous, now, { actor: 'host', reason: 'next_class' });
        }
        const session = openSession(room, now);
        session.inClass = true;
        session.classStartedAt = now;
        return writeEvent(room, session, now, { actor: 'host', ...fields, type: 'class_start' });
    } catch (error) {
        console.error('Error starting class:', error);
        return null;
    }
}

function endSession(room, session, now, fields) {
    session.inClass = false;
    session.closed = true;
    return writeEvent(room, session, now, { ...fields, type: 'class_end' });
}

// 授業を終える：授業の終了を記録する。これ以降の出来事（入退室を除く）は新しい授業回になる
function endClass(room, fields = {}) {
    if (!room) return null;
    try {
        const now = Date.now();
        const session = latestSession(room);
        if (!session || !session.inClass || !isLive(session, now)) return null;
        return endSession(room, session, now, { actor: 'host', ...fields });
    } catch (error) {
        console.error('Error ending class:', error);
        return null;
    }
}

// 「授業開始」を押し忘れた授業回を、後から授業として記録する（記録済みの行は書き換えず、授業開始・終了を書き足す）
//   startMs: 授業の開始時刻。endMs: 終了時刻（null なら終了を記録しない。いまの授業回なら授業中になる）
// 戻り値は { ok: true } か { ok: false, error: 理由 }
function recordClass(room, sessionId, startMs, endMs, fields = {}) {
    if (!room || !SESSION_ID_PATTERN.test(String(sessionId))) return { ok: false, error: '授業回が見つかりません' };
    const file = sessionFile(room, sessionId);
    if (!fs.existsSync(file)) return { ok: false, error: '授業回が見つかりません' };
    try {
        const events = readEvents(file);
        if (events.some(ev => ev.type === 'class_start' || ev.type === 'class_end')) {
            return { ok: false, error: 'この授業回はすでに授業として記録されています' };
        }
        const now = Date.now();
        const sessionStart = Date.parse(events[0].t);
        // 分単位で入力した開始時刻が授業回の始まりの少し前になった場合は、授業回の始まりにそろえる
        if (startMs < sessionStart && sessionStart - startMs < 60 * 1000) startMs = sessionStart;
        if (!Number.isFinite(startMs) || startMs < sessionStart || startMs > now) {
            return { ok: false, error: '開始時刻は授業回の始まりから現在までの間にしてください' };
        }
        if (endMs !== null && (!Number.isFinite(endMs) || endMs <= startMs || endMs > now)) {
            return { ok: false, error: '終了時刻は開始時刻より後で、現在より前にしてください' };
        }
        const latest = latestSession(room);
        const isCurrent = !!latest && latest.id === sessionId;
        // 過去の授業回は、書き込み用に一時的な状態を作る（現在の授業回の状態は変えない）
        const session = isCurrent ? latest : { id: sessionId, startedAt: sessionStart, lastAt: lastActivityAt(events) };
        const recorded = { actor: 'host', ...fields, trigger: 'recovered', recorded_at: new Date(now).toISOString() };
        writeEvent(room, session, startMs, { ...recorded, type: 'class_start' });
        if (endMs !== null) {
            writeEvent(room, session, endMs, { ...recorded, type: 'class_end' });
        }
        if (isCurrent) {
            session.classStartedAt = startMs;
            session.inClass = endMs === null;
            session.closed = endMs !== null;
        }
        return { ok: true };
    } catch (error) {
        console.error('Error recording class:', error);
        return { ok: false, error: '記録に失敗しました' };
    }
}

// 授業中かどうか（ダッシュボードの表示用）
function classState(room) {
    const session = latestSession(room);
    const inClass = !!session && session.inClass && isLive(session, Date.now());
    return {
        in_class: inClass,
        session_id: inClass ? session.id : null,
        started_at: inClass ? new Date(session.classStartedAt || session.startedAt).toISOString() : null
    };
}

// fn(room) は、その部屋に接続している人の入室イベント用の項目（actor, role, participant_id など）の配列を返す
function setPresenceProvider(fn) {
    presenceProvider = fn;
}

// 記録された出来事を受け取る（ダッシュボードへの配信用）
function onEvent(fn) {
    listeners.push(fn);
}

function currentSessionEvents(room) {
    const session = sessions.get(room);
    return session ? readEvents(sessionFile(room, session.id)) : [];
}

function listSessions(room) {
    return listSessionIds(room).map(id => {
        const events = readEvents(sessionFile(room, id));
        const lastAt = lastActivityAt(events);
        const classStart = events.find(ev => ev.type === 'class_start');
        const classEnd = events.find(ev => ev.type === 'class_end');
        return {
            session_id: id,
            started_at: events[0] ? events[0].t : null,
            last_at: lastAt === null ? null : new Date(lastAt).toISOString(),
            events: events.length,
            // 配信者が「授業開始」で始めた授業回か（false は授業前の動作確認や授業外の記録）
            class: !!classStart,
            class_started_at: classStart ? classStart.t : null,
            class_ended_at: classEnd ? classEnd.t : null
        };
    }).reverse();
}

// 保持期間を過ぎた授業回のファイルを削除する
function cleanup(retentionMs) {
    let deleted = 0;
    let roomDirs = [];
    try {
        roomDirs = fs.readdirSync(EVENTS_DIR);
    } catch (error) {
        return deleted;
    }
    const now = Date.now();
    for (const dir of roomDirs) {
        const full = path.join(EVENTS_DIR, dir);
        let files = [];
        try { files = fs.readdirSync(full); } catch (error) { continue; }
        for (const file of files) {
            if (!file.endsWith('.jsonl')) continue;
            const filePath = path.join(full, file);
            try {
                if (now - fs.statSync(filePath).mtime.getTime() > retentionMs) {
                    fs.unlinkSync(filePath);
                    deleted++;
                }
            } catch (error) {
                console.error('Error deleting event log:', filePath, error);
            }
        }
    }
    return deleted;
}

// 記録を読み出す API
// authorize(req, res, room) が false を返したら処理しない（配信者だけが読めるようにする）
function createRouter({ legacyCommentLogFile, authorize }) {
    const router = express.Router();

    // 授業回の一覧（新しい順）
    router.get('/api/rooms/:room/sessions', (req, res) => {
        if (!authorize(req, res, req.params.room)) return;
        res.json(listSessions(req.params.room));
    });

    // 授業回の全イベント（JSON Lines）。session に "current" を指定すると現在の授業回
    router.get('/api/rooms/:room/sessions/:session/events', (req, res) => {
        const room = req.params.room;
        if (!authorize(req, res, room)) return;
        let sessionId = req.params.session;
        if (sessionId === 'current') {
            sessionId = (sessions.get(room) || {}).id || listSessionIds(room).pop();
        }
        if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) {
            return res.status(404).send('session not found');
        }
        const file = sessionFile(room, sessionId);
        if (!fs.existsSync(file)) {
            return res.status(404).send('session not found');
        }
        res.type('application/x-ndjson; charset=utf-8');
        if (req.query.download) {
            res.attachment(`${roomKey(room)}_${sessionId}.jsonl`);
        }
        fs.createReadStream(file).pipe(res);
    });

    // 今の授業回のコメント（参加者ページの履歴同期用。従来と同じ形式）
    // 部屋名を知っていれば誰でも読めるので、過去の授業回の分（最大 21 日分）は返さず、
    // 途中から参加した人が今の授業のコメントを見られる範囲にとどめる。接続 ID も返さない
    router.get('/api/rooms/:room/comments', (req, res) => {
        const room = req.params.room;
        const file = legacyCommentLogFile(room);
        if (!fs.existsSync(file)) {
            return res.status(404).send('no comments');
        }
        const now = Date.now();
        const session = latestSession(room);
        const since = isLive(session, now) ? session.startedAt : now - SESSION_GAP_MS;
        const lines = [];
        for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
            if (!line) continue;
            try {
                const entry = JSON.parse(line);
                if (Date.parse(entry.timestamp) < since) continue;
                delete entry.socketid;
                lines.push(JSON.stringify(entry));
            } catch (error) {
                // 壊れた行は飛ばす
            }
        }
        if (lines.length === 0) {
            return res.status(404).send('no comments');
        }
        res.type('application/x-ndjson; charset=utf-8');
        res.send(lines.join('\n') + '\n');
    });

    return router;
}

module.exports = {
    SCHEMA_VERSION,
    roomKey,
    logEvent,
    startClass,
    endClass,
    recordClass,
    classState,
    setPresenceProvider,
    onEvent,
    currentSessionEvents,
    listSessions,
    cleanup,
    createRouter
};
