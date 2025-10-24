// コメント機能共通ユーティリティ
(function (global) {
    const state = {
        count: 0,
        lastSend: 0,
        intervalMs: 5000,
        deactivateControl: false,
        colorText: '#EEEEEE',
        colorStroke: '#111111',
        speech: false,
        socket: null,
        emojiFilter: true, // デフォルトでemojiフィルタはオン
        allHistory: [], // 全てのコメント履歴を保持
    };

    function pad(n, l = 2) { return String(n).padStart(l, '0'); }

    function formatTimestamp(count) {
        const d = new Date();
        return `[${pad(d.getFullYear(), 4)}:${pad(d.getMonth() + 1)}:${pad(d.getDate())}:${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}-${pad(count, 4)}] `;
    }

    function appendHistory(text) {
        // 全履歴に追加
        state.allHistory.push(text);
        // フィルタを適用して表示
        updateHistoryDisplay();
    }

    function updateHistoryDisplay() {
        const area = document.getElementById('textarea_comment_history');
        if (!area) return;

        // フィルタ適用
        let displayHistory = state.allHistory;
        if (state.emojiFilter) {
            // [emoji]を含む行を除外
            displayHistory = state.allHistory.filter(line => !line.includes('[emoji]'));
        }

        area.innerHTML = displayHistory.join('');
        area.scrollTop = area.scrollHeight;

        // トップ10を計算
        calculateTop10();
    }

    function calculateTop10() {
        // emoji部門とコメント部門で送信者をカウント
        const emojiSenders = {};
        const normalSenders = {};

        // 除外するユーザー名のリスト
        const excludedNames = ['Anonymous', '匿名'];

        state.allHistory.forEach(line => {
            // 行から情報を抽出
            // フォーマット: [timestamp] comment[emoji][sound][username]\n
            const emojiMatch = line.includes('[emoji]');

            // 送信者名を抽出（最後の[...]の中身）
            const usernameMatch = line.match(/\[([^\]]+)\]\s*$/);
            if (!usernameMatch) return;

            const username = usernameMatch[1].trim();

            // 除外リストに含まれている場合はスキップ
            if (excludedNames.includes(username)) return;

            if (emojiMatch) {
                emojiSenders[username] = (emojiSenders[username] || 0) + 1;
            } else {
                normalSenders[username] = (normalSenders[username] || 0) + 1;
            }
        });

        // トップ10を取得
        const getTop10 = (senders) => {
            return Object.entries(senders)
                .sort((a, b) => b[1] - a[1]) // 降順ソート
                .slice(0, 10) // 上位10件
                .map(([username, count], index) => ({ rank: index + 1, username, count }));
        };

        const emojiTop10 = getTop10(emojiSenders);
        const normalTop10 = getTop10(normalSenders);

        // HTMLに表示
        updateRankingDisplay(emojiTop10, normalTop10);

        // デバッグログに出力
        if (typeof debugLog === 'function') {
            debugLog('===== トップ10統計（送信者別） =====');
            debugLog('【絵文字部門】');
            if (emojiTop10.length === 0) {
                debugLog('  まだデータがありません');
            } else {
                emojiTop10.forEach(item => {
                    debugLog(`  ${item.rank}位: ${item.username} (${item.count}回)`);
                });
            }
            debugLog('【コメント部門】');
            if (normalTop10.length === 0) {
                debugLog('  まだデータがありません');
            } else {
                normalTop10.forEach(item => {
                    debugLog(`  ${item.rank}位: ${item.username} (${item.count}回)`);
                });
            }
            debugLog('====================================');
        }
    }

    function updateRankingDisplay(emojiTop10, normalTop10) {
        // i18n翻訳を取得
        const getTranslation = (key, fallback) => {
            if (window.i18next && window.i18next.t) {
                return window.i18next.t(key);
            }
            return fallback;
        };

        const noDataText = getTranslation('no_data_yet', 'まだデータがありません');
        const timesSuffix = getTranslation('times_suffix', '回');

        // 絵文字部門のランキングを表示
        const emojiRankingDiv = document.getElementById('emoji_ranking');
        if (emojiRankingDiv) {
            if (emojiTop10.length === 0) {
                emojiRankingDiv.innerHTML = `<p class="text-muted mb-0">${noDataText}</p>`;
            } else {
                const emojiHtml = emojiTop10.map(item => {
                    let badgeClass = 'badge bg-secondary';
                    if (item.rank === 1) badgeClass = 'badge bg-info text-dark';
                    else if (item.rank === 2) badgeClass = 'badge bg-light text-dark';
                    else if (item.rank === 3) badgeClass = 'badge bg-warning text-dark';

                    return `<div class="d-flex justify-content-between align-items-center mb-1">
                        <span><span class="${badgeClass}">${item.rank}</span> ${escapeHtml(item.username)}</span>
                        <span class="badge bg-primary">${item.count}${timesSuffix}</span>
                    </div>`;
                }).join('');
                emojiRankingDiv.innerHTML = emojiHtml;
            }
        }

        // コメント部門のランキングを表示
        const commentRankingDiv = document.getElementById('comment_ranking');
        if (commentRankingDiv) {
            if (normalTop10.length === 0) {
                commentRankingDiv.innerHTML = `<p class="text-muted mb-0">${noDataText}</p>`;
            } else {
                const commentHtml = normalTop10.map(item => {
                    let badgeClass = 'badge bg-secondary';
                    if (item.rank === 1) badgeClass = 'badge bg-info text-dark';
                    else if (item.rank === 2) badgeClass = 'badge bg-light text-dark';
                    else if (item.rank === 3) badgeClass = 'badge bg-warning text-dark';

                    return `<div class="d-flex justify-content-between align-items-center mb-1">
                        <span><span class="${badgeClass}">${item.rank}</span> ${escapeHtml(item.username)}</span>
                        <span class="badge bg-primary">${item.count}${timesSuffix}</span>
                    </div>`;
                }).join('');
                commentRankingDiv.innerHTML = commentHtml;
            }
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function setEmojiFilter(enabled) {
        state.emojiFilter = enabled;
        updateHistoryDisplay();
    }

    function canSend() {
        return (performance.now() - state.lastSend) > state.intervalMs || state.deactivateControl;
    }

    function buildData({ comment, myName, emoji = false, sound = false, idSound = 0, hidden = -1 }) {
        return {
            key: undefined, // api key 使うなら後で注入
            my_name: myName,
            comment,
            flg_speech: state.speech,
            color_text: state.colorText,
            color_text_stroke: state.colorStroke,
            text_direction: document.getElementById('select_text_direction')?.value || 'left',
            flg_emoji: emoji,
            flg_sound: sound,
            id_sound: idSound,
            hidden: hidden
        };
    }

    function recordSend() { state.lastSend = performance.now(); }

    function sendComment(params) {
        if (!canSend()) return { ok: false, reason: 'interval' };
        if (!params.comment || params.comment.length === 0) return { ok: false, reason: 'empty' };
        if (params.comment.length > 80 && params.hidden !== 100) return { ok: false, reason: 'length' };
        state.count += 1;
        const data = buildData(params);
        if (state.socket) state.socket.emit('comment', data);
        // ローカル即時反映
        const ts = formatTimestamp(state.count);
        let out = ts + data.comment;
        if (data.flg_emoji) out += '[emoji]';
        if (data.flg_sound) out += '[sound]';
        out += '[' + data.my_name + ']\n';
        appendHistory(out);
        recordSend();
        return { ok: true, data };
    }

    function integrateIncoming(data) {
        state.count += 1;
        const ts = formatTimestamp(state.count);
        let out = ts + data.comment;
        if (data.flg_emoji) out += '[emoji]';
        if (data.flg_sound) out += '[sound]';
        out += '[' + data.my_name + ']\n';
        appendHistory(out);
    }

    function attachSocket(ioSocket) { state.socket = ioSocket; }

    global.CommentApp = { state, formatTimestamp, appendHistory, sendComment, integrateIncoming, attachSocket, setEmojiFilter, updateHistoryDisplay };
})(window);
