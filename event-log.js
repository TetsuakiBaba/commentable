// 授業の出来事（コメント・リアクション・音声認識・AIの応答・入退室・アンケート・運営操作）を
// 1本の JSON Lines に記録する。授業回（セッション）ごとに1ファイル。
//
// 1行の例:
// {"schema":1,"event_id":"…","session_id":"20261006-230333","room":"Computer_Class",
//  "t":"2026-10-06T14:03:33.123Z","elapsed_s":12.3,"type":"comment","actor":"participant",
//  "participant_id":"…","name":"24123456","text":"なるほど"}
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

// 部屋ごとの現在の授業回 { id, startedAt, lastAt }
const sessions = new Map();
const listeners = [];

function appendEvent(room, sessionId, event) {
    fs.mkdirSync(roomDir(room), { recursive: true });
    fs.appendFileSync(sessionFile(room, sessionId), JSON.stringify(event) + '\n', 'utf8');
}

// 現在の授業回を返す（なければ作る）。サーバーが再起動しても、直前の授業回が続いていれば引き継ぐ
function currentSession(room, now) {
    let session = sessions.get(room);
    if (!session) {
        const latest = listSessionIds(room).pop();
        if (latest) {
            const events = readEvents(sessionFile(room, latest));
            const first = events[0];
            const last = events[events.length - 1];
            if (first && last && now - Date.parse(last.t) < SESSION_GAP_MS) {
                session = { id: latest, startedAt: Date.parse(first.t), lastAt: Date.parse(last.t) };
                sessions.set(room, session);
            }
        }
    }
    if (session && now - session.lastAt < SESSION_GAP_MS) {
        return session;
    }

    session = { id: formatSessionId(now), startedAt: now, lastAt: now };
    sessions.set(room, session);
    writeEvent(room, session, now, { type: 'session_start', actor: 'system' });
    return session;
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
    session.lastAt = now;
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
        return writeEvent(room, currentSession(room, now), now, fields);
    } catch (error) {
        console.error('Error writing event log:', error);
        return null;
    }
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
        return {
            session_id: id,
            started_at: events[0] ? events[0].t : null,
            last_at: events.length ? events[events.length - 1].t : null,
            events: events.length
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
function createRouter({ legacyCommentLogFile }) {
    const router = express.Router();

    // 授業回の一覧（新しい順）
    router.get('/api/rooms/:room/sessions', (req, res) => {
        res.json(listSessions(req.params.room));
    });

    // 授業回の全イベント（JSON Lines）。session に "current" を指定すると現在の授業回
    router.get('/api/rooms/:room/sessions/:session/events', (req, res) => {
        const room = req.params.room;
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

    // これまでのコメントログ（参加者ページの履歴同期用。従来と同じ形式）
    router.get('/api/rooms/:room/comments', (req, res) => {
        const file = legacyCommentLogFile(req.params.room);
        if (!fs.existsSync(file)) {
            return res.status(404).send('no comments');
        }
        res.type('application/x-ndjson; charset=utf-8');
        fs.createReadStream(file).pipe(res);
    });

    return router;
}

module.exports = {
    SCHEMA_VERSION,
    roomKey,
    logEvent,
    onEvent,
    currentSessionEvents,
    listSessions,
    cleanup,
    createRouter
};
