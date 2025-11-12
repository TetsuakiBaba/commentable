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
        allHistory: [], // 全てのコメント履歴を保持（表示用テキスト）
        allHistoryJSON: [], // 全てのコメント履歴を保持（JSON形式、ダウンロード用）
        // ランキング用の増分カウント
        emojiSenders: {}, // {username: count}
        normalSenders: {}, // {username: count}
        totalEmojiCount: 0,
        totalCommentCount: 0,
        rankingUpdateTimer: null, // デバウンス用タイマー
        // 表示最適化用
        displayCache: '', // フィルタ適用済みテキストのキャッシュ
        displayCacheLength: 0, // キャッシュの文字数（.lengthアクセスを避けるため）
        needsFullUpdate: false, // フィルタ切り替え時にフル更新が必要かどうか
    };

    const excludedNames = ['Anonymous', '匿名']; // 除外ユーザー名（定数化）
    const usernameRegex = /\[([^\]]+)\]\s*$/; // 正規表現を事前コンパイル

    function pad(n, l = 2) { return String(n).padStart(l, '0'); }

    function formatTimestamp(count) {
        const d = new Date();
        return `[${pad(d.getFullYear(), 4)}:${pad(d.getMonth() + 1)}:${pad(d.getDate())}:${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}-${pad(count, 4)}] `;
    }

    function appendHistory(text) {
        const perfStart = performance.now();

        // 全履歴に追加
        state.allHistory.push(text);

        // 増分でランキングを更新
        updateRankingIncremental(text);

        // 差分で表示を更新（高速化）
        updateHistoryDisplayIncremental(text);

        const perfEnd = performance.now();
        if (typeof debugLog === 'function') {
            debugLog(`appendHistory took ${(perfEnd - perfStart).toFixed(2)}ms`);
        }
    }

    // 差分更新：新しい行だけを追加（高速化）
    function updateHistoryDisplayIncremental(newLine) {
        const perfStart = performance.now();

        const area = document.getElementById('textarea_comment_history');
        if (!area) return;

        // emojiフィルタが有効で、新しい行がemojiを含む場合はスキップ
        if (state.emojiFilter && newLine.includes('[emoji]')) {
            return; // 表示しない
        }

        // キャッシュに追加
        state.displayCache += newLine;
        const newLineLength = newLine.length;

        // 効率的に末尾に追加: setRangeText()を使用
        // area.value.lengthではなく、キャッシュした長さを使用
        area.setRangeText(newLine, state.displayCacheLength, state.displayCacheLength, 'end');
        state.displayCacheLength += newLineLength;

        const perfEnd = performance.now();
        if (typeof debugLog === 'function') {
            debugLog(`  updateHistoryDisplayIncremental took ${(perfEnd - perfStart).toFixed(2)}ms`);
        }
    }

    // 増分ランキング更新（新しいコメント1件だけを処理）
    function updateRankingIncremental(line) {
        const emojiMatch = line.includes('[emoji]');
        const usernameMatch = line.match(usernameRegex);

        if (!usernameMatch) return;

        const username = usernameMatch[1].trim();

        if (emojiMatch) {
            state.totalEmojiCount++;
            if (!excludedNames.includes(username)) {
                state.emojiSenders[username] = (state.emojiSenders[username] || 0) + 1;
            }
        } else {
            state.totalCommentCount++;
            if (!excludedNames.includes(username)) {
                state.normalSenders[username] = (state.normalSenders[username] || 0) + 1;
            }
        }

        // ランキング表示更新をデバウンス（300ms以内の連続更新をまとめる）
        scheduleRankingUpdate();
    }

    // ランキング表示の更新をスケジュール（デバウンス）
    function scheduleRankingUpdate() {
        if (state.rankingUpdateTimer) {
            clearTimeout(state.rankingUpdateTimer);
        }
        state.rankingUpdateTimer = setTimeout(() => {
            renderRankingDisplay();
            state.rankingUpdateTimer = null;
        }, 300);
    }

    // フル更新（フィルタ切り替え時や同期時のみ使用）
    function updateHistoryDisplay() {
        const area = document.getElementById('textarea_comment_history');
        if (!area) return;

        // フィルタ適用して全体を再構築
        let displayHistory = state.allHistory;
        if (state.emojiFilter) {
            displayHistory = state.allHistory.filter(line => !line.includes('[emoji]'));
        }

        // キャッシュを更新
        state.displayCache = displayHistory.join('');
        state.displayCacheLength = state.displayCache.length;

        // textareaに設定（innerHTML→valueに変更でパフォーマンス改善）
        area.value = state.displayCache;
        area.scrollTop = area.scrollHeight;
    }

    // ランキングを全体から再計算（同期時のみ使用）
    function calculateTop10() {
        // 状態をリセット
        state.emojiSenders = {};
        state.normalSenders = {};
        state.totalEmojiCount = 0;
        state.totalCommentCount = 0;

        // 全履歴を一度だけループして集計
        state.allHistory.forEach(line => {
            const emojiMatch = line.includes('[emoji]');
            const usernameMatch = line.match(usernameRegex);
            if (!usernameMatch) return;

            const username = usernameMatch[1].trim();

            if (emojiMatch) {
                state.totalEmojiCount++;
                if (!excludedNames.includes(username)) {
                    state.emojiSenders[username] = (state.emojiSenders[username] || 0) + 1;
                }
            } else {
                state.totalCommentCount++;
                if (!excludedNames.includes(username)) {
                    state.normalSenders[username] = (state.normalSenders[username] || 0) + 1;
                }
            }
        });

        // ランキング表示を即座に更新
        renderRankingDisplay();
    }

    // ランキング表示のレンダリング（実際のDOM操作）
    function renderRankingDisplay() {
        // トップ10を取得
        const getTop10 = (senders) => {
            return Object.entries(senders)
                .sort((a, b) => b[1] - a[1]) // 降順ソート
                .slice(0, 10) // 上位10件
                .map(([username, count], index) => ({ rank: index + 1, username, count }));
        };

        const emojiTop10 = getTop10(state.emojiSenders);
        const normalTop10 = getTop10(state.normalSenders);

        // HTMLに表示
        updateRankingDisplay(emojiTop10, normalTop10, state.totalEmojiCount, state.totalCommentCount);
    }

    function updateRankingDisplay(emojiTop10, normalTop10, totalEmojiCount, totalCommentCount) {
        // i18n翻訳を取得
        const getTranslation = (key, fallback) => {
            if (window.i18next && window.i18next.t) {
                return window.i18next.t(key);
            }
            return fallback;
        };

        const noDataText = getTranslation('no_data_yet', 'まだデータがありません');
        const timesSuffix = getTranslation('times_suffix', '回');

        // 総コメント数を表示（引数で渡された値を使用）
        const totalEmojiCountElement = document.getElementById('total_emoji_count');
        if (totalEmojiCountElement) {
            totalEmojiCountElement.textContent = totalEmojiCount || 0;
        }

        const totalCommentCountElement = document.getElementById('total_comment_count');
        if (totalCommentCountElement) {
            totalCommentCountElement.textContent = totalCommentCount || 0;
        }

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
            font_size: document.getElementById('select_font_size')?.value || 'medium',
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

        // JSON形式でも保存（ダウンロード用）
        const jsonData = {
            timestamp: new Date().toISOString(),
            room: data.room || window.currentRoom || '',
            username: data.my_name || '',
            comment: data.comment || '',
            emoji: data.flg_emoji || false,
            sound: data.flg_sound || false,
            socketid: data.socketid || ''
        };
        state.allHistoryJSON.push(jsonData);
    }

    function attachSocket(ioSocket) { state.socket = ioSocket; }

    global.CommentApp = {
        state,
        formatTimestamp,
        appendHistory,
        sendComment,
        integrateIncoming,
        attachSocket,
        setEmojiFilter,
        updateHistoryDisplay,
        calculateTop10  // 同期時に全体再計算するために公開
    };
})(window);
