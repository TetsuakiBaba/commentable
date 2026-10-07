// 授業ログ（JSON Lines）から参加者ごとの授業参画度を計算する。
// 画面（app.js）と Node（テスト）の両方から使えるよう、DOM には触れない。
//
// 指標（授業回ごと）
//   滞在     在室時間 ÷ 授業時間
//   発言     有効コメント数
//   質       実質コメント数（記号・絵文字・「w」などを除いた本文が一定文字数以上の有効コメント）
//   回答率   回答数 ÷ 在室中に行われたアンケート数
//   継続性   授業を一定時間ごとに区切り、有効コメントかアンケート回答があった区間の割合
// 各指標を「満点の基準」で 0〜1 に正規化し、重み付き平均 × 100 を授業回の点とする。
// 複数回の点は、欠席回を 0 点として全授業回で平均する。

(function (global) {
    const DEFAULT_SETTINGS = {
        weights: { presence: 30, comments: 25, quality: 15, survey: 20, continuity: 10 },
        presenceFull: 80,          // 在室率（%）がこれ以上で満点
        commentsFull: 3,           // 有効コメント数がこれ以上で満点
        qualityFull: 2,            // 実質コメント数がこれ以上で満点
        surveyFull: 100,           // 回答率（%）がこれ以上で満点
        continuityFull: 50,        // 活動のあった区間の割合（%）がこれ以上で満点
        commentMinChars: 2,        // これより短いコメントは数えない
        commentMinIntervalSec: 10, // 自分の直前の有効コメントからこれより短い間隔のコメントは数えない
        qualityMinChars: 10,       // 実質コメントとみなす本文の文字数
        slotMinutes: 10,           // 継続性の区間の長さ
        defaultNames: ['匿名', 'Anonymous', '名無し', 'test'],
        fillNamesFromOtherSessions: true // その回に名前がないブラウザは、他の回の名前で補う
    };

    const INDICATORS = [
        { key: 'presence', label: '滞在' },
        { key: 'comments', label: '発言' },
        { key: 'quality', label: '質' },
        { key: 'survey', label: '回答率' },
        { key: 'continuity', label: '継続性' }
    ];

    function cloneSettings(settings) {
        return JSON.parse(JSON.stringify(settings));
    }

    // 保存されていた設定に、足りない項目を初期値で補う
    function mergeSettings(saved) {
        const merged = cloneSettings(DEFAULT_SETTINGS);
        if (!saved || typeof saved !== 'object') return merged;
        Object.keys(merged).forEach(key => {
            if (key === 'weights') {
                Object.keys(merged.weights).forEach(w => {
                    if (saved.weights && Number.isFinite(Number(saved.weights[w]))) merged.weights[w] = Number(saved.weights[w]);
                });
            } else if (key === 'defaultNames') {
                if (Array.isArray(saved.defaultNames)) merged.defaultNames = saved.defaultNames.map(String);
            } else if (typeof merged[key] === 'boolean') {
                if (typeof saved[key] === 'boolean') merged[key] = saved[key];
            } else if (Number.isFinite(Number(saved[key]))) {
                merged[key] = Number(saved[key]);
            }
        });
        return merged;
    }

    // ---------- 読み込み ----------

    // JSON Lines の文字列をイベントの配列にする（壊れた行は数えて飛ばす）
    function parseJsonl(text) {
        const events = [];
        let invalid = 0;
        String(text).split('\n').forEach(line => {
            if (!line.trim()) return;
            try {
                const ev = JSON.parse(line);
                if (ev && typeof ev === 'object' && ev.session_id && ev.t && ev.type) events.push(ev);
                else invalid++;
            } catch (e) {
                invalid++;
            }
        });
        return { events, invalid };
    }

    // 複数ファイルのイベントをまとめ、授業回ごとに分ける（同じイベントの重複は除く）
    function groupSessions(events) {
        const seen = new Set();
        const sessions = new Map();
        events.forEach(ev => {
            if (ev.event_id) {
                if (seen.has(ev.event_id)) return;
                seen.add(ev.event_id);
            }
            const key = `${ev.room || ''}\u0000${ev.session_id}`;
            if (!sessions.has(key)) sessions.set(key, { key, room: ev.room || '', sessionId: ev.session_id, events: [] });
            sessions.get(key).events.push(ev);
        });
        return [...sessions.values()]
            .map(s => {
                s.events.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
                const startEvent = s.events.find(ev => ev.type === 'session_start') || s.events[0];
                s.autoStart = Date.parse(startEvent.t);
                s.autoEnd = Date.parse(s.events[s.events.length - 1].t);
                return s;
            })
            .sort((a, b) => a.autoStart - b.autoStart);
    }

    // ---------- 名前 ----------

    function isDefaultName(name, settings) {
        const value = String(name || '').trim().toLowerCase();
        if (value === '') return true;
        return settings.defaultNames.some(d => String(d).trim().toLowerCase() === value);
    }

    // 授業回ごとに、ブラウザ（participant_id）→ 名前 を決める。
    // その回に記録された最後の名前を使う（途中で「匿名」から学修番号に直した場合も回全体をその名前にする）
    function namesInSession(session, settings) {
        const last = new Map();
        const all = new Map();
        session.events.forEach(ev => {
            if (ev.actor !== 'participant' || !ev.participant_id) return;
            if (isDefaultName(ev.name, settings)) return;
            const name = String(ev.name).trim();
            last.set(ev.participant_id, name);
            if (!all.has(ev.participant_id)) all.set(ev.participant_id, new Set());
            all.get(ev.participant_id).add(name);
        });
        return { last, all };
    }

    // ---------- 指標の部品 ----------

    // 区間の和の長さ（ミリ秒）
    function unionLength(intervals) {
        const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
        let total = 0;
        let curStart = null;
        let curEnd = null;
        sorted.forEach(([a, b]) => {
            if (curEnd === null || a > curEnd) {
                if (curEnd !== null) total += curEnd - curStart;
                curStart = a;
                curEnd = b;
            } else if (b > curEnd) {
                curEnd = b;
            }
        });
        if (curEnd !== null) total += curEnd - curStart;
        return total;
    }

    function clipIntervals(intervals, start, end) {
        return intervals
            .map(([a, b]) => [Math.max(a, start), Math.min(b, end)])
            .filter(([a, b]) => b > a);
    }

    function overlaps(intervals, start, end) {
        return intervals.some(([a, b]) => a <= end && b >= start);
    }

    // ブラウザごとの在室区間を join / leave から作る。
    // connection_id があれば接続ごとに対応させ、ない古いログは接続数を数えて近似する。
    function presenceIntervals(session, end) {
        const byPid = new Map();
        const open = new Map();   // connection_id → { pid, t }
        const counts = new Map(); // 古いログ用: pid → { n, since }
        const add = (pid, a, b) => {
            if (!byPid.has(pid)) byPid.set(pid, []);
            byPid.get(pid).push([a, b]);
        };
        session.events.forEach(ev => {
            if ((ev.type !== 'join' && ev.type !== 'leave') || ev.actor !== 'participant' || !ev.participant_id) return;
            const pid = ev.participant_id;
            const t = Date.parse(ev.t);
            if (ev.connection_id) {
                if (ev.type === 'join') {
                    open.set(ev.connection_id, { pid, t });
                } else if (open.has(ev.connection_id)) {
                    add(pid, open.get(ev.connection_id).t, t);
                    open.delete(ev.connection_id);
                }
                return;
            }
            const c = counts.get(pid) || { n: 0, since: null };
            if (ev.type === 'join') {
                if (c.n === 0) c.since = t;
                c.n++;
            } else if (c.n > 0) {
                c.n--;
                if (c.n === 0) add(pid, c.since, t);
            }
            counts.set(pid, c);
        });
        // 退室が記録されていない接続（授業終了まで在室、またはサーバーの再起動）は授業の終わりまでとする
        open.forEach(({ pid, t }) => add(pid, t, end));
        counts.forEach((c, pid) => { if (c.n > 0) add(pid, c.since, end); });
        return byPid;
    }

    // 「質」を判定するための本文：空白・記号・絵文字・笑いの「w」「草」を除き、同じ文字の繰り返しを1文字にまとめる
    function substantiveText(text) {
        return String(text || '')
            .replace(/[ｗＷ]+/g, '')
            .replace(/(?<![A-Za-z])[wW]{2,}(?![A-Za-z])/g, '')
            .replace(/(?<=[^\x00-\x7F])[wW]+(?![A-Za-z])/gu, '')
            .replace(/草+/g, '')
            .replace(/[\s\p{P}\p{S}\p{Extended_Pictographic}‍️]/gu, '')
            .replace(/(.)\1{2,}/gu, '$1');
    }

    function charLength(text) {
        return [...String(text || '')].length;
    }

    // 有効コメントを選ぶ（短すぎる・直前と同じ文・連打を除く）
    function validComments(comments, settings) {
        const result = [];
        let prevText = null;
        let lastValidAt = -Infinity;
        comments.forEach(ev => {
            const text = String(ev.text || '').trim();
            const t = Date.parse(ev.t);
            const ok = charLength(text.replace(/\s/g, '')) >= settings.commentMinChars
                && text !== prevText
                && t - lastValidAt >= settings.commentMinIntervalSec * 1000;
            prevText = text;
            if (ok) {
                lastValidAt = t;
                result.push(ev);
            }
        });
        return result;
    }

    const ratio = (value, full) => (full > 0 ? Math.min(1, value / full) : 1);

    // ---------- 授業回ごとの計算 ----------

    // globalNames: 他の回も含めた ブラウザ → 名前（補完用）
    function analyzeSession(session, settings, globalNames) {
        const start = Number.isFinite(session.start) ? session.start : session.autoStart;
        const end = Number.isFinite(session.end) ? session.end : session.autoEnd;
        const duration = Math.max(0, end - start);
        const inRange = ev => {
            const t = Date.parse(ev.t);
            return t >= start && t <= end;
        };

        const { last: sessionNames, all: namesByPid } = namesInSession(session, settings);
        const presenceByPid = presenceIntervals(session, end);

        // この回に登場した参加者のブラウザ
        const pids = new Set();
        session.events.forEach(ev => {
            if (ev.actor === 'participant' && ev.participant_id) pids.add(ev.participant_id);
        });

        // ブラウザ → 名前（なければ他の回の名前、それもなければ未結び付け）
        const nameOf = new Map();
        const estimated = new Set();
        pids.forEach(pid => {
            if (sessionNames.has(pid)) {
                nameOf.set(pid, sessionNames.get(pid));
            } else if (settings.fillNamesFromOtherSessions && globalNames.has(pid)) {
                nameOf.set(pid, globalNames.get(pid));
                estimated.add(pid);
            }
        });

        // アンケート（授業時間内に始まったもの）
        const surveys = [];
        session.events.forEach(ev => {
            if (ev.type === 'survey_start' && inRange(ev)) {
                surveys.push({ id: ev.survey_id, question: ev.question, start: Date.parse(ev.t), end });
            } else if (ev.type === 'survey_end') {
                const s = surveys.find(x => x.id === ev.survey_id);
                if (s) s.end = Date.parse(ev.t);
            }
        });

        const slotMs = Math.max(1, settings.slotMinutes) * 60 * 1000;
        const slotCount = Math.max(1, Math.round(duration / slotMs));

        // 本人（名前、未結び付けはブラウザ）ごとにまとめる
        const people = new Map();
        const keyOf = pid => (nameOf.has(pid) ? `name:${nameOf.get(pid)}` : `pid:${pid}`);
        pids.forEach(pid => {
            const key = keyOf(pid);
            if (!people.has(key)) {
                people.set(key, {
                    key,
                    name: nameOf.get(pid) || null,
                    pids: new Set(),
                    estimated: false,
                    otherNames: new Set(),
                    intervals: [],
                    comments: [],
                    answers: []
                });
            }
            const p = people.get(key);
            p.pids.add(pid);
            if (estimated.has(pid)) p.estimated = true;
            (namesByPid.get(pid) || new Set()).forEach(n => { if (n !== p.name) p.otherNames.add(n); });
            p.intervals.push(...(presenceByPid.get(pid) || []));
        });
        session.events.forEach(ev => {
            if (ev.actor !== 'participant' || !ev.participant_id || !inRange(ev)) return;
            const p = people.get(keyOf(ev.participant_id));
            if (ev.type === 'comment' && ev.hidden === undefined) p.comments.push(ev);
            else if (ev.type === 'survey_answer') p.answers.push(ev);
        });

        const results = [];
        people.forEach(p => {
            const intervals = clipIntervals(p.intervals, start, end);
            const presenceRate = duration > 0 ? unionLength(intervals) / duration : 0;

            const valid = validComments(p.comments, settings);
            const substantive = valid.filter(ev => charLength(substantiveText(ev.text)) >= settings.qualityMinChars);

            const answered = new Set(p.answers.map(a => a.survey_id));
            const eligible = surveys.filter(s => answered.has(s.id) || overlaps(intervals, s.start, s.end));
            const answeredEligible = eligible.filter(s => answered.has(s.id)).length;
            const surveyRate = eligible.length > 0 ? answeredEligible / eligible.length : null;

            const activeSlots = new Set();
            [...valid, ...p.answers].forEach(ev => {
                const t = Date.parse(ev.t);
                activeSlots.add(Math.min(slotCount - 1, Math.max(0, Math.floor((t - start) / slotMs))));
            });
            const continuityRate = activeSlots.size / slotCount;

            const raw = {
                presence: presenceRate,
                comments: valid.length,
                quality: substantive.length,
                survey: surveyRate,
                continuity: continuityRate
            };
            const normalized = {
                presence: ratio(presenceRate * 100, settings.presenceFull),
                comments: ratio(valid.length, settings.commentsFull),
                quality: ratio(substantive.length, settings.qualityFull),
                survey: surveyRate === null ? null : ratio(surveyRate * 100, settings.surveyFull),
                continuity: ratio(continuityRate * 100, settings.continuityFull)
            };

            results.push({
                key: p.key,
                name: p.name,
                pids: [...p.pids],
                estimated: p.estimated,
                otherNames: [...p.otherNames],
                present: presenceRate > 0 || p.comments.length > 0 || p.answers.length > 0,
                raw,
                normalized,
                details: {
                    allComments: p.comments.length,
                    validComments: valid.length,
                    surveysEligible: eligible.length,
                    surveysAnswered: answeredEligible,
                    activeSlots: activeSlots.size,
                    slotCount
                },
                score: weightedScore(normalized, settings)
            });
        });

        return {
            key: session.key,
            room: session.room,
            sessionId: session.sessionId,
            start,
            end,
            duration,
            surveys: surveys.length,
            slotCount,
            results
        };
    }

    // 重み付き平均 × 100（値のない指標＝アンケートのない回の回答率 は除いて割り直す）
    function weightedScore(normalized, settings) {
        let sum = 0;
        let weight = 0;
        INDICATORS.forEach(({ key }) => {
            const w = Math.max(0, Number(settings.weights[key]) || 0);
            if (normalized[key] === null || w === 0) return;
            sum += w * normalized[key];
            weight += w;
        });
        return weight > 0 ? (sum / weight) * 100 : 0;
    }

    // ---------- 全体の集計 ----------

    // sessions: groupSessions の結果（include=false の回は除く。start / end で授業時間を上書きできる）
    function analyze(sessions, settings) {
        const included = sessions.filter(s => s.include !== false);

        // 他の回の名前で補うための ブラウザ → 名前（後の回ほど優先）
        const globalNames = new Map();
        included.forEach(s => {
            namesInSession(s, settings).last.forEach((name, pid) => globalNames.set(pid, name));
        });

        const sessionResults = included.map(s => analyzeSession(s, settings, globalNames));

        // 名前ごとに全授業回をまとめる（欠席回は 0 点）
        const students = new Map();
        const unlinked = [];
        sessionResults.forEach((sr, index) => {
            sr.results.forEach(r => {
                if (!r.name) {
                    unlinked.push({ session: sr, result: r });
                    return;
                }
                if (!students.has(r.name)) {
                    students.set(r.name, { name: r.name, perSession: new Array(sessionResults.length).fill(null) });
                }
                students.get(r.name).perSession[index] = r;
            });
        });

        const sessionCount = sessionResults.length;
        const summary = [...students.values()].map(st => {
            const attended = st.perSession.filter(r => r && r.present);
            const avg = key => {
                // 欠席回は 0、アンケートのない回の回答率は平均から除く
                const values = st.perSession.map(r => (r && r.present ? r.normalized[key] : 0)).filter(v => v !== null);
                return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
            };
            const warnings = [];
            if (st.perSession.some(r => r && r.pids.length > 1)) warnings.push('multiDevice');
            if (st.perSession.some(r => r && r.otherNames.length > 0)) warnings.push('sharedBrowser');
            if (st.perSession.some(r => r && r.estimated)) warnings.push('estimated');
            return {
                name: st.name,
                score: sessionCount
                    ? st.perSession.reduce((sum, r) => sum + (r && r.present ? r.score : 0), 0) / sessionCount
                    : 0,
                attended: attended.length,
                sessions: sessionCount,
                indicators: Object.fromEntries(INDICATORS.map(({ key }) => [key, avg(key)])),
                warnings,
                perSession: st.perSession
            };
        });

        return { sessions: sessionResults, summary, unlinked };
    }

    const api = {
        DEFAULT_SETTINGS,
        INDICATORS,
        cloneSettings,
        mergeSettings,
        parseJsonl,
        groupSessions,
        isDefaultName,
        substantiveText,
        validComments,
        unionLength,
        presenceIntervals,
        analyzeSession,
        weightedScore,
        analyze
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else global.EngagementScore = api;
})(typeof window !== 'undefined' ? window : globalThis);
