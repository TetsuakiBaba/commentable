// 不要になった旧グローバルは削除 (comment_interval_ms / api_key / sound 系 / is_streaming / timestamp_last_send)
var socket; // 接続用

var flg_speech = false;
var flg_deactivate_comment_control;


var color_text;
var color_text_stroke;
// flash / capture / 音量関連機能は未使用化のため削除

function setup() {
    flg_deactivate_comment_control = false;
    color_text = document.getElementById("color_text").value;
    color_text_stroke = document.getElementById("color_text_stroke").value;

    //socket = io.connect('http://localhost:80');
    //socket = io.connect('https://commentable.lolipop.io')
    socket = io.connect(window.location.origin);

    // 誰かがコメント送信してきた場合
    socket.on('comment', newComment);

    // 接続確認のメッセージがきた場合
    socket.on('you_are_connected', function () {
        // 部屋名を指定してジョインする．部屋名が指定されていない場合はalertを出す
        let params = Object.fromEntries(new URLSearchParams(window.location.search).entries());
        if (params.room) {
            var room = decodeURIComponent(params.room);
            socket.emit('join', room);
        } else {
            while ((room = prompt("部屋名を入力してください", 'test_room')) == '');
            //var room = prompt("部屋名を入力してください", 'test_room');
            socket.emit('join', room);
        }
    });

    socket.on('disconnect', () => {
        log('you have been disconnected');
    });
    // Whenever the server emits 'user joined', log it in the chat body
    socket.on('user joined', (data) => {
        log(data.username + ' joined');
        document.getElementById('text_number_of_joined').value = String(data.numUsers);
    });
    // Whenever the server emits 'user left', log it in the chat body
    socket.on('user left', (data) => {
        log(data.username + ' left');
        document.getElementById('text_number_of_joined').value = String(data.numUsers);
    });
    socket.on('reconnect', () => {
        log('you have been reconnected');
        // 部屋名を指定してジョインする．部屋名が指定されていない場合はalertを出す
        let params = Object.fromEntries(new URLSearchParams(window.location.search).entries());
        if (params.room) {
            var room = decodeURIComponent(params.room);
            socket.emit('join', room);
        } else {
            var room = prompt("部屋名を入力してください", 'test_room');
            socket.emit('join', room);
        }
    });
    socket.on('login', (data) => {
        document.getElementById('text_number_of_joined').value = String(data.numUsers);
        flg_deactivate_comment_control = data.deactivate_comment_control;
        document.getElementById('checkbox_deactivate_comment_control').checked = flg_deactivate_comment_control;
        if (window.CommentApp) CommentApp.state.deactivateControl = flg_deactivate_comment_control;
    });
    socket.on('deactivate_comment_control', (data) => {
        document.getElementById('checkbox_deactivate_comment_control').checked = data.control;
        flg_deactivate_comment_control = data.control;
        if (window.CommentApp) CommentApp.state.deactivateControl = flg_deactivate_comment_control;
    });

    // 旧 WebRTC (offer/answer) 機能は完全削除済み
    window.onunload = window.onbeforeunload = () => socket.close();


    document.getElementById("button_send")?.addEventListener('click', pushedSendButton);
    document.getElementById("checkbox_speech")?.addEventListener('click', () => {
        flg_speech = !flg_speech;
        if (window.CommentApp) CommentApp.state.speech = flg_speech;
    });
    document.getElementById("color_text")?.addEventListener('change', (e) => { changeTextColor(e); if (window.CommentApp) CommentApp.state.colorText = color_text; });
    document.getElementById("color_text_stroke")?.addEventListener('change', (e) => { changeTextOutlineColor(e); if (window.CommentApp) CommentApp.state.colorStroke = color_text_stroke; });

    ["01", "02", "03", "04", "05"].forEach(n => {
        const el = document.getElementById(`button_emoji_reaction_${n}`); if (el) el.addEventListener('click', sendEmojiReaction);
    });
    ["00", "01", "02", "03", "04", "05", "06", "07", "08", "09"].forEach(n => {
        const el = document.getElementById(`button_sound_reaction_${n}`); if (el) el.addEventListener('click', sendSoundReaction);
    });
    document.getElementById("download_all_comments")?.addEventListener('click', downloadAllComments);

    if (window.CommentApp) {
        CommentApp.attachSocket(socket);
        CommentApp.state.lastSend = performance.now();
        CommentApp.state.colorText = color_text;
        CommentApp.state.colorStroke = color_text_stroke;
        CommentApp.state.speech = flg_speech;
        CommentApp.state.deactivateControl = flg_deactivate_comment_control;
    }

    // version情報を #versionに挿入
    // 現在のページのURLからクエリパラメータを取得する場合
    const params = new URLSearchParams(window.location.search);
    const v = params.get('v'); // 'v'はクエリパラメータのキーです
    if (v !== null) {
        document.querySelector('#version').innerText = v;
        console.log(`パラメータの値は: ${v}`);
    } else {
        document.querySelector('#version').innerText = 'undefined';
        console.log('パラメータのキーは存在しません。');
    }

    // no canvas usage

    // IME（日本語入力等）用フラグ設定
    window.__isComposing = false;
    const __imeTarget = document.getElementById('text_comment');
    if (__imeTarget) {
        __imeTarget.addEventListener('compositionstart', () => { window.__isComposing = true; });
        __imeTarget.addEventListener('compositionend', () => { window.__isComposing = false; });
        // Enter 処理をテキストエリア専用に移行
        __imeTarget.addEventListener('keydown', (e) => {
            if (window.__isComposing || e.isComposing || e.keyCode === 229) return; // IME 中は無視
            if (e.key === 'Enter') {
                // Ctrl(+Shift) の隠しコマンド判定
                let hidden = -1;
                if (e.ctrlKey && !e.shiftKey) hidden = 0;
                if (e.ctrlKey && e.shiftKey) hidden = 100;

                // 文字列長チェックは sendComment 内で既存処理利用
                sendComment(
                    document.getElementById("text_comment").value,
                    false,
                    document.getElementById("text_my_name").value,
                    false,
                    0,
                    false,
                    0,
                    hidden
                );
                e.preventDefault();
            }
        });
    }
}

// p5.js の自動呼び出しが無くなったため DOM 準備後に明示的に setup 実行
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setup());
} else {
    setup();
}

// 以前 p5 の log もしくは独自 util があった想定のため簡易実装
function log(msg) {
    try { console.log(msg); } catch (e) { }
}


// コメント数は CommentApp.state.count で管理
async function newComment(data) {
    CommentApp.integrateIncoming(data);
    // 隠しコマンド処理
    if (data.hidden === 100) { // コード / ロングテキスト共有
        const container = document.getElementById("code_share");
        if (!container) return;
        let card = document.createElement("div");
        card.setAttribute("class", "card mb-2");
        let card_body = document.createElement("div");
        card_body.setAttribute("class", "card-body");
        let card_header = document.createElement("small");
        card_header.setAttribute("class", "card-header d-flex justify-content-between align-items-center");
        card_header.textContent = `${data.my_name}`;
        card.appendChild(card_header);
        let card_code;
        if (data.comment.match(/^https?:\/\//)) {
            card_code = document.createElement("a");
            card_code.setAttribute("href", data.comment);
            card_code.setAttribute("target", "_blank");
            card_code.id = `codeBlock${CommentApp.state.count}`;
            card_code.textContent = data.comment;
            card_body.appendChild(card_code);
        } else {
            card_code = document.createElement("pre");
            card_code.id = `codeBlock${CommentApp.state.count}`;
            card_code.textContent = data.comment;
            card_body.appendChild(card_code);
        }
        card.appendChild(card_body);
        container.insertBefore(card, container.firstChild);
        let copy_button = document.createElement("button");
        copy_button.setAttribute("class", "btn btn-outline-secondary btn-sm copy-btn");
        copy_button.setAttribute("data-clipboard-target", `#${card_code.id}`);
        copy_button.innerHTML = `<i class="bi bi-clipboard"></i> Copy`;
        copy_button.addEventListener("click", function () {
            copy_button.innerHTML = `<i class=\"bi bi-check-lg\"></i> Copied!!`;
            copy_button.setAttribute("class", "btn btn-outline-success btn-sm copy-btn");
            setTimeout(function () {
                copy_button.innerHTML = `<i class=\"bi bi-clipboard\"></i> Copy`;
                copy_button.setAttribute("class", "btn btn-outline-secondary btn-sm copy-btn");
            }, 2000);
        });
        card_header.appendChild(copy_button);
        new ClipboardJS(copy_button);
    }
}

function pushedSendButton() {
    sendComment(
        document.getElementById("text_comment").value,
        false,
        document.getElementById("text_my_name").value,
        false, 0,
        false, 0,
        -1
    );
}







// _hidden: 隠しコマンド、-1のときはなし、0以上がコマンドのidとなる。
function sendComment(_str_comment, _flg_emoji, _str_my_name, _flg_img, _id_img, _flg_sound, _id_sound, _hidden) {
    const result = CommentApp.sendComment({ comment: _str_comment, myName: _str_my_name, emoji: _flg_emoji, sound: _flg_sound, idSound: _id_sound, hidden: _hidden });
    if (!result.ok) {
        if (result.reason === 'interval') {
            const remain = 5 - parseInt((performance.now() - CommentApp.state.lastSend) / 1000);
            alert("いつも素敵なコメントありがとうございます\n投稿まで後 " + String(remain) + " 秒お待ち下さい。\n\n注）画面上部の「繰り返し」ランプが点灯しているときは連投ができます。");
        } else if (result.reason === 'length') {
            alert("一度に遅れる文字数は80文字までです．");
        } else if (result.reason === 'empty') {
            // 無入力。特別な通知は無し
        }
        return;
    }
    clearTextBox();
}


// 旧：お手紙機能 / グローバルキー監視は未使用のため削除

function clearTextBox() {
    //document.getElementById("text_comment").value = "";
    let textarea = document.getElementById('text_comment');
    textarea.value = ' ';
    textarea.value = '';
    textarea.blur();

    // ブラウザレンダリングが間に合わないので、フォーカスを戻すのはちょっとだけ待つ
    setTimeout(function () {
        textarea.focus();
    }, 50);
    textarea.innerText = '';
}

function changeTextColor(e) {
    color_text = e.target.value;
}

function changeTextOutlineColor(e) {
    color_text_stroke = e.target.value;
}

// windowResized: 未使用

function sendEmojiReaction(e) {
    const content = e.currentTarget.innerHTML;
    sendComment(
        content,
        true,
        document.getElementById("text_my_name").value,
        false,
        0,
        false,
        0, -1
    );
}

function sendSoundReaction(e) {
    var id_sound = e.currentTarget.getAttribute("value");
    const content = e.currentTarget.innerHTML;
    sendComment(
        content,
        true,
        document.getElementById("text_my_name").value,
        false,
        0,
        true,
        id_sound,
        -1
    );
}


// サウンド / ストリーミング制御系は未使用のため削除


// カメラ / 画面キャプチャ / 時計 / チャイム等の機能は未使用のため削除