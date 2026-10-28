#!/usr/bin/env node
// 分かれてしまった授業回の授業ログ（JSON Lines）を1つの授業回にまとめる。
// 元のファイルは変更せず、まとめたものを別のファイルに書き出す。
//
// 使い方:
//   node tools/merge-sessions.js <授業ログ.jsonl>... --out <書き出し先.jsonl>
//        [--class-start <時刻>] [--class-end <時刻>]
//   時刻は ISO 形式（2026-10-28T14:44:43+09:00 など）。省略すると、開始はいちばん早い授業回の始まり、
//   終了は最後の「授業終了」（なければ記録しない）
//
// まとめ方:
//   - session_id をいちばん早い授業回のものにそろえ、elapsed_s をその始まりからの秒数に直す（元の ID は merged_from に残す）
//   - 2つ目以降の授業回の session_start と、授業回の始まりに接続中の人を入室扱いにした join（carried_over）を除く
//     （在室時間の計算で、同じ接続の入室が二重になるため）
//   - 「授業開始」は1つにし、途中の「授業終了」は除く

const fs = require('fs');
const crypto = require('crypto');

function parseArgs(argv) {
    const options = { inputs: [], out: null, classStart: null, classEnd: null };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--out') options.out = argv[++i];
        else if (arg === '--class-start') options.classStart = argv[++i];
        else if (arg === '--class-end') options.classEnd = argv[++i];
        else options.inputs.push(arg);
    }
    return options;
}

function parseTime(value, label) {
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) throw new Error(`${label} の時刻が読めません: ${value}`);
    return ms;
}

function readEvents(file) {
    return fs.readFileSync(file, 'utf8').split('\n')
        .filter(line => line.trim() !== '')
        .map(line => {
            try { return JSON.parse(line); } catch (e) { return null; }
        })
        .filter(Boolean);
}

function merge(events, { classStart, classEnd }) {
    const seen = new Set();
    events = events.filter(ev => {
        if (!ev.event_id) return true;
        if (seen.has(ev.event_id)) return false;
        seen.add(ev.event_id);
        return true;
    }).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));

    const sessionIds = [...new Set(events.map(ev => ev.session_id))].sort();
    if (sessionIds.length === 0) throw new Error('授業ログが空です');
    const baseId = sessionIds[0];
    const baseStartEvent = events.find(ev => ev.session_id === baseId && ev.type === 'session_start')
        || events.find(ev => ev.session_id === baseId);
    const baseStart = Date.parse(baseStartEvent.t);

    const classStarts = events.filter(ev => ev.type === 'class_start');
    const classEnds = events.filter(ev => ev.type === 'class_end');
    const lastClassEnd = classEnds[classEnds.length - 1];
    const now = new Date().toISOString();

    const merged = events.filter(ev => {
        if (ev.session_id === baseId) return ev.type !== 'class_start' && ev.type !== 'class_end';
        if (ev.type === 'session_start' || ev.type === 'class_start' || ev.type === 'class_end') return false;
        return !(ev.type === 'join' && ev.carried_over);
    });

    const template = classStarts[0] || baseStartEvent;
    const startMs = classStart !== null ? classStart : baseStart;
    merged.push({
        schema: template.schema,
        event_id: crypto.randomUUID(),
        session_id: baseId,
        room: template.room,
        t: new Date(startMs).toISOString(),
        actor: 'host',
        type: 'class_start',
        trigger: 'merged',
        recorded_at: now
    });
    if (classEnd !== null || lastClassEnd) {
        const endMs = classEnd !== null ? classEnd : Date.parse(lastClassEnd.t);
        merged.push({
            ...(lastClassEnd || {}),
            schema: template.schema,
            event_id: classEnd !== null || !lastClassEnd ? crypto.randomUUID() : lastClassEnd.event_id,
            room: template.room,
            t: new Date(endMs).toISOString(),
            actor: 'host',
            type: 'class_end',
            ...(classEnd !== null ? { trigger: 'merged', recorded_at: now } : {})
        });
    }

    return merged
        .map(ev => {
            const result = { ...ev, elapsed_s: Math.round((Date.parse(ev.t) - baseStart) / 100) / 10 };
            if (ev.session_id && ev.session_id !== baseId) result.merged_from = ev.session_id;
            result.session_id = baseId;
            return result;
        })
        .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.inputs.length < 2 || !options.out) {
        console.error('使い方: node tools/merge-sessions.js <授業ログ.jsonl>... --out <書き出し先.jsonl> [--class-start <時刻>] [--class-end <時刻>]');
        process.exit(1);
    }
    if (options.inputs.includes(options.out)) {
        console.error('書き出し先は元のファイルと別にしてください');
        process.exit(1);
    }
    const merged = merge(options.inputs.flatMap(readEvents), {
        classStart: options.classStart ? parseTime(options.classStart, '--class-start') : null,
        classEnd: options.classEnd ? parseTime(options.classEnd, '--class-end') : null
    });
    fs.writeFileSync(options.out, merged.map(ev => JSON.stringify(ev)).join('\n') + '\n', 'utf8');
    const classStart = merged.find(ev => ev.type === 'class_start');
    const classEnd = merged.find(ev => ev.type === 'class_end');
    console.log(`${merged.length} 件を ${merged[0].session_id} としてまとめました: ${options.out}`);
    console.log(`授業: ${classStart.t} 〜 ${classEnd ? classEnd.t : '（終了の記録なし）'}`);
}

main();
