// ========================================
// デバッグ設定
// ========================================
// デバッグモードのON/OFF (開発時はtrue、本番環境ではfalseに設定)
const DEBUG_MODE = false;

// デバッグ用ログ関数
function debugLog(...args) {
    if (DEBUG_MODE) {
        console.log('[DEBUG]', ...args);
    }
}

// デバッグ用エラーログ関数
function debugError(...args) {
    if (DEBUG_MODE) {
        console.error('[DEBUG ERROR]', ...args);
    }
}

// デバッグ用警告ログ関数
function debugWarn(...args) {
    if (DEBUG_MODE) {
        console.warn('[DEBUG WARN]', ...args);
    }
}
// ========================================

// 不要になった旧グローバルは削除 (comment_interval_ms / api_key / sound 系 / is_streaming / timestamp_last_send)
var socket; // 接続用
var currentRoom; // 現在接続している部屋名

var flg_speech = false;
var flg_deactivate_comment_control;

var color_text;
var color_text_stroke;

// 不適切な単語リスト
var inappropriateWords = [];

// 不適切な単語リストを読み込む（base64化されたファイルから）
async function loadInappropriateWords() {
    try {
        // 読み込むbase64ファイルのリスト
        const base64Files = [
            '/inappropriate-words-ja/Sexual.base64.txt',
            '/inappropriate-words-ja/Sexual_with_mask.base64.txt',
            '/inappropriate-words-ja/Sexual_with_bopo.base64.txt'
        ];

        // 全てのファイルを並行して読み込む
        const promises = base64Files.map(async (file) => {
            try {
                const response = await fetch(file);
                const text = await response.text();

                // 行ごとに分割してbase64デコード
                const words = text.split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0)
                    .map(base64String => {
                        try {
                            // base64デコード
                            const decoded = atob(base64String);
                            // UTF-8としてデコード
                            return decodeURIComponent(escape(decoded));
                        } catch (e) {
                            debugError(`Failed to decode: ${base64String}`, e);
                            return null;
                        }
                    })
                    .filter(word => word !== null);

                return words;
            } catch (error) {
                debugError(`${file} の読み込みに失敗しました:`, error);
                return [];
            }
        });

        // 全てのファイルの読み込みを待つ
        const results = await Promise.all(promises);

        // 全ての単語を結合して重複を除去
        inappropriateWords = [...new Set(results.flat())];

        debugLog(`${inappropriateWords.length}個の不適切な単語を読み込みました`);
    } catch (error) {
        debugError('不適切な単語リストの読み込みに失敗しました:', error);
    }
}


// テキストから不適切な単語を伏せ字にする
function maskInappropriateWords(text) {
    if (!text || inappropriateWords.length === 0) return text;

    let maskedText = text;

    // 長い単語から順にマッチさせる（部分一致を避けるため）
    const sortedWords = [...inappropriateWords].sort((a, b) => b.length - a.length);

    for (const word of sortedWords) {
        if (word.length === 0) continue;

        // 単語を正規表現でエスケープ
        const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedWord, 'gi');

        // 単語の文字数分だけ「*」で置き換え
        const mask = '*'.repeat(word.length);
        maskedText = maskedText.replace(regex, mask);
    }

    return maskedText;
}

// flash / capture / 音量関連機能は未使用化のため削除

function setup() {
    flg_deactivate_comment_control = false;

    // 保存された設定をlocalStorageから読み込み
    const savedTextColor = localStorage.getItem('commentable_text_color');
    const savedStrokeColor = localStorage.getItem('commentable_stroke_color');
    const savedTextDirection = localStorage.getItem('commentable_text_direction');

    // テキスト色の復元
    if (savedTextColor) {
        document.getElementById("color_text").value = savedTextColor;
    }
    color_text = document.getElementById("color_text").value;

    // アウトライン色の復元
    if (savedStrokeColor) {
        document.getElementById("color_text_stroke").value = savedStrokeColor;
    }
    color_text_stroke = document.getElementById("color_text_stroke").value;

    // 文字移動方向の復元
    if (savedTextDirection) {
        document.getElementById("select_text_direction").value = savedTextDirection;
    }

    // 保存された名前をlocalStorageから読み込み
    const savedName = localStorage.getItem('commentable_user_name');
    if (savedName) {
        document.getElementById('text_my_name').value = savedName;
    }

    // 名前入力フィールドの変更を監視してlocalStorageに保存
    const nameInput = document.getElementById('text_my_name');
    if (nameInput) {
        nameInput.addEventListener('input', function () {
            const name = this.value.trim();
            if (name) {
                localStorage.setItem('commentable_user_name', name);
            }
        });
    }

    // 不適切な単語リストを読み込む
    loadInappropriateWords();

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
            currentRoom = decodeURIComponent(params.room);
            socket.emit('join', currentRoom);
        } else {
            // i18nextが初期化されている場合は翻訳を使用
            const promptMessage = window.i18next ? window.i18next.t('enter_room_name') : '部屋名を入力してください';
            while ((currentRoom = prompt(promptMessage, 'test_room')) == '');
            socket.emit('join', currentRoom);
        }

        // 部屋に接続した後、サーバーからチャットログを同期（アラートは表示しない）
        setTimeout(() => {
            if (typeof syncCommentsFromServer === 'function') {
                syncCommentsFromServer(false);
            }
        }, 500); // 部屋接続後少し待ってから実行
    });

    socket.on('disconnect', () => {
        log('you have been disconnected');
    });
    // Whenever the server emits 'user joined', log it in the chat body
    socket.on('user joined', (data) => {
        log(data.username + ' joined: ' + data.numUsers);
        document.getElementById('text_number_of_joined').value = String(data.numUsers);
    });
    // Whenever the server emits 'user left', log it in the chat body
    socket.on('user left', (data) => {
        log(data.username + ' left: ' + data.numUsers);
        document.getElementById('text_number_of_joined').value = String(data.numUsers);
    });
    socket.on('reconnect', () => {
        log('you have been reconnected');
        // 部屋名を指定してジョインする．部屋名が指定されていない場合はalertを出す
        let params = Object.fromEntries(new URLSearchParams(window.location.search).entries());
        if (params.room) {
            currentRoom = decodeURIComponent(params.room);
            socket.emit('join', currentRoom);
        } else {
            // i18nextが初期化されている場合は翻訳を使用
            const promptMessage = window.i18next ? window.i18next.t('enter_room_name') : '部屋名を入力してください';
            currentRoom = prompt(promptMessage, 'test_room');
            socket.emit('join', currentRoom);
        }
        // 再接続後に人数を明示的に問い合わせ
        setTimeout(() => {
            socket.emit('get user count');
        }, 1000);
    });
    socket.on('login', (data) => {
        document.getElementById('text_number_of_joined').value = String(data.numUsers);
        flg_deactivate_comment_control = data.deactivate_comment_control;
        document.getElementById('checkbox_deactivate_comment_control').checked = flg_deactivate_comment_control;
        if (window.CommentApp) CommentApp.state.deactivateControl = flg_deactivate_comment_control;
    });
    // サーバからの定期同期イベントを受信
    socket.on('sync user count', (data) => {
        document.getElementById('text_number_of_joined').value = String(data.numUsers);
    });
    // 明示的な人数問い合わせの応答
    socket.on('user count', (data) => {
        document.getElementById('text_number_of_joined').value = String(data.numUsers);
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

        // アイコンの切り替え
        const iconSpeech = document.getElementById("icon_speech");
        if (iconSpeech) {
            if (flg_speech) {
                iconSpeech.classList.remove('fa-volume-mute');
                iconSpeech.classList.add('fa-volume-up');
            } else {
                iconSpeech.classList.remove('fa-volume-up');
                iconSpeech.classList.add('fa-volume-mute');
            }
        }
    });
    document.getElementById("color_text")?.addEventListener('change', (e) => {
        changeTextColor(e);
        if (window.CommentApp) CommentApp.state.colorText = color_text;
        localStorage.setItem('commentable_text_color', color_text);
    });
    document.getElementById("color_text_stroke")?.addEventListener('change', (e) => {
        changeTextOutlineColor(e);
        if (window.CommentApp) CommentApp.state.colorStroke = color_text_stroke;
        localStorage.setItem('commentable_stroke_color', color_text_stroke);
    });

    // 文字移動方向の変更を監視
    document.getElementById("select_text_direction")?.addEventListener('change', (e) => {
        localStorage.setItem('commentable_text_direction', e.target.value);
    });

    ["01", "02", "03", "04", "05"].forEach(n => {
        const el = document.getElementById(`button_emoji_reaction_${n}`); if (el) el.addEventListener('click', sendEmojiReaction);
    });
    ["00", "01", "02", "03", "04", "05", "06", "07", "08", "09"].forEach(n => {
        const el = document.getElementById(`button_sound_reaction_${n}`); if (el) el.addEventListener('click', sendSoundReaction);
    });
    document.getElementById("download_all_comments")?.addEventListener('click', downloadAllComments);
    document.getElementById("sync_comments")?.addEventListener('click', syncCommentsFromServer);

    // emojiフィルタのトグルボタン
    document.getElementById("checkbox_emoji_filter")?.addEventListener('change', (e) => {
        if (window.CommentApp) {
            CommentApp.setEmojiFilter(e.target.checked);
        }
    });

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
        debugLog(`パラメータの値は: ${v}`);
    } else {
        document.querySelector('#version').innerText = 'undefined';
        debugLog('パラメータのキーは存在しません。');
    }

    // no canvas usage

    // IME（日本語入力等）用フラグ設定
    window.__isComposing = false;
    const __imeTarget = document.getElementById('text_comment');
    if (__imeTarget) {
        // コメント履歴機能
        const commentHistory = JSON.parse(localStorage.getItem('commentHistory') || '[]');
        let historyIndex = -1;

        // 履歴に追加する関数
        const addToHistory = (text) => {
            if (!text || text.trim() === '') return;
            // 同じコメントが既にある場合は削除
            const index = commentHistory.indexOf(text);
            if (index > -1) {
                commentHistory.splice(index, 1);
            }
            // 先頭に追加
            commentHistory.unshift(text);
            // 最大100件まで保存
            if (commentHistory.length > 100) {
                commentHistory.pop();
            }
            localStorage.setItem('commentHistory', JSON.stringify(commentHistory));
        };

        __imeTarget.addEventListener('compositionstart', () => { window.__isComposing = true; });
        __imeTarget.addEventListener('compositionend', () => { window.__isComposing = false; });
        // Enter 処理をテキストエリア専用に移行
        __imeTarget.addEventListener('keydown', (e) => {
            if (window.__isComposing || e.isComposing || e.keyCode === 229) return; // IME 中は無視

            // 履歴機能: Ctrl+P / Ctrl+N または 上下キー
            if ((e.ctrlKey && e.key === 'p') || e.key === 'ArrowUp') {
                e.preventDefault();
                if (commentHistory.length === 0) return;
                if (historyIndex < commentHistory.length - 1) {
                    historyIndex++;
                    __imeTarget.value = commentHistory[historyIndex];
                }
                return;
            }
            if ((e.ctrlKey && e.key === 'n') || e.key === 'ArrowDown') {
                e.preventDefault();
                if (historyIndex > 0) {
                    historyIndex--;
                    __imeTarget.value = commentHistory[historyIndex];
                } else if (historyIndex === 0) {
                    historyIndex = -1;
                    __imeTarget.value = '';
                }
                return;
            }

            if (e.key === 'Enter') {
                // Ctrl(+Shift) の隠しコマンド判定
                let hidden = -1;
                if (e.ctrlKey && !e.shiftKey) hidden = 0;
                if (e.ctrlKey && e.shiftKey) hidden = 100;

                // 履歴に追加
                const commentText = document.getElementById("text_comment").value;
                addToHistory(commentText);
                historyIndex = -1; // リセット

                // 文字列長チェックは sendComment 内で既存処理利用
                sendComment(
                    commentText,
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
    try { debugLog(msg); } catch (e) { }
}


// コメント数は CommentApp.state.count で管理
async function newComment(data) {
    debugLog("新しいコメント:", data);
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
    // 不適切な単語を伏せ字にする（絵文字の場合は除く）
    let maskedComment = _str_comment;
    if (!_flg_emoji && _str_comment) {
        maskedComment = maskInappropriateWords(_str_comment);
    }

    // 名前にも不適切な単語が含まれている場合は伏せ字にする
    let maskedName = _str_my_name;
    if (_str_my_name) {
        maskedName = maskInappropriateWords(_str_my_name);
    }

    const result = CommentApp.sendComment({ comment: maskedComment, myName: maskedName, emoji: _flg_emoji, sound: _flg_sound, idSound: _id_sound, hidden: _hidden });
    if (!result.ok) {
        if (result.reason === 'interval') {
            const remain = 5 - parseInt((performance.now() - CommentApp.state.lastSend) / 1000);
            // i18nextが初期化されている場合は翻訳を使用
            const message = window.i18next
                ? window.i18next.t('comment_interval_message', { seconds: remain })
                : `いつも素敵なコメントありがとうございます\n投稿まで後 ${remain} 秒お待ち下さい。\n\n注）画面上部の「繰り返し」ランプが点灯しているときは連投ができます。`;
            alert(message);
        } else if (result.reason === 'length') {
            // i18nextが初期化されている場合は翻訳を使用
            const message = window.i18next
                ? window.i18next.t('comment_length_error')
                : '一度に遅れる文字数は80文字までです．';
            alert(message);
        } else if (result.reason === 'empty') {
            // 無入力。特別な通知は無し
        }
        return;
    }

    // 自分で送信したhidden=100のコメントに対してもDOM作成
    if (_hidden === 100) {
        const selfCommentData = {
            comment: maskedComment,
            my_name: maskedName,
            hidden: _hidden
        };
        // newComment関数を直接呼び出して同じDOM処理を実行
        newComment(selfCommentData);
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