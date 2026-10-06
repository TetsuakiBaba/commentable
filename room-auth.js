// 部屋の配信者認証
//
// - 配信画面（Electron アプリ）は部屋ごとに秘密の鍵（hostKey）を持つ。
//   最初に入室したアプリの鍵がその部屋の配信者として登録され、違う鍵のアプリは入室できない
// - ダッシュボードは、鍵から作ったトークン（dashboardTokenFor）で入室する
// - 配信者が一定期間まったく接続しなければ登録を外す（部屋名を別の人が使えるように）
//
// サーバーには鍵そのものは保存せず、ハッシュだけを logs/rooms.json に保存する

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOMS_FILE = path.join(__dirname, 'logs', 'rooms.json');
const LOCK_TTL_MS = (Number(process.env.ROOM_LOCK_TTL_DAYS) || 30) * 24 * 60 * 60 * 1000;
const KEY_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

function sha256(text) {
    return crypto.createHash('sha256').update(String(text)).digest('hex');
}

// Electron アプリ側（main.js）と同じ式でダッシュボード用のトークンを作る
function dashboardTokenFor(hostKey) {
    return sha256(`commentable-dashboard:${hostKey}`);
}

function sameHash(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

let rooms = {};
try {
    rooms = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8')) || {};
} catch (error) {
    rooms = {};
}

function save() {
    try {
        fs.mkdirSync(path.dirname(ROOMS_FILE), { recursive: true });
        fs.writeFileSync(ROOMS_FILE, JSON.stringify(rooms, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving room owners:', error);
    }
}

function activeRecord(room, now = Date.now()) {
    const record = rooms[room];
    if (!record || now - record.lastSeenAt > LOCK_TTL_MS) return null;
    return record;
}

// 配信画面の入室：未登録（または期限切れ）なら登録し、登録済みなら鍵を照合する
function claimOrVerifyHost(room, hostKey) {
    if (typeof hostKey !== 'string' || !KEY_PATTERN.test(hostKey)) {
        return { ok: false, reason: 'invalid_key' };
    }
    const now = Date.now();
    const record = activeRecord(room, now);
    if (!record) {
        rooms[room] = {
            hostKeyHash: sha256(hostKey),
            dashboardTokenHash: sha256(dashboardTokenFor(hostKey)),
            createdAt: now,
            lastSeenAt: now
        };
        save();
        return { ok: true, claimed: true };
    }
    if (!sameHash(record.hostKeyHash, sha256(hostKey))) {
        return { ok: false, reason: 'host_taken' };
    }
    record.lastSeenAt = now;
    save();
    return { ok: true, claimed: false };
}

// ダッシュボードの入室・API：トークンを照合する
function verifyDashboardToken(room, token) {
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return false;
    const record = activeRecord(room);
    return !!record && sameHash(record.dashboardTokenHash, sha256(token));
}

// 配信者が接続していた時刻を更新する（期限切れの判定に使う）
function touchHost(room) {
    if (rooms[room]) {
        rooms[room].lastSeenAt = Date.now();
        save();
    }
}

module.exports = {
    LOCK_TTL_MS,
    dashboardTokenFor,
    claimOrVerifyHost,
    verifyDashboardToken,
    touchHost
};
