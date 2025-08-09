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
    };

    function pad(n, l = 2) { return String(n).padStart(l, '0'); }

    function formatTimestamp(count) {
        const d = new Date();
        return `[${pad(d.getFullYear(), 4)}:${pad(d.getMonth() + 1)}:${pad(d.getDate())}:${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}-${pad(count, 4)}] `;
    }

    function appendHistory(text) {
        const area = document.getElementById('textarea_comment_history');
        if (!area) return;
        area.innerHTML += text;
        area.scrollTop = area.scrollHeight;
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
        if (data.flg_sound) out += ' [sound]';
        out += '[' + data.my_name + ']\n';
        appendHistory(out);
        recordSend();
        return { ok: true, data };
    }

    function integrateIncoming(data) {
        state.count += 1;
        const ts = formatTimestamp(state.count);
        let out = ts + data.comment;
        if (data.flg_sound) out += ' [sound]';
        out += '[' + data.my_name + ']\n';
        appendHistory(out);
    }

    function attachSocket(ioSocket) { state.socket = ioSocket; }

    global.CommentApp = { state, formatTimestamp, appendHistory, sendComment, integrateIncoming, attachSocket };
})(window);
