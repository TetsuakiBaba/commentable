var socket;
var room;
//ES5
var getURLParams = function () {
    return window.location.search.substring(1).split('&').reduce(function (result, query) { var pair = query.split('='); result[pair[0]] = decodeURI(pair[1]); return result; }, {});
}

window.addEventListener('load', function () {
    //socket = io.connect('http://localhost');
    //socket = io.connect('https://commentable.lolipop.io')
    socket = io.connect(window.location.origin);

    // 誰かがコメント送信してきた場合
    socket.on('comment', function (data) {
        createComment(data.my_name, data.name_to, data.comment);
        //        console.log(data);
    });

    // 接続確認のメッセージがきた場合
    socket.on('you_are_connected', function () {
        // 部屋名を指定してジョインする．部屋名が指定されていない場合はalertを出す
        let params = getURLParams();
        if (params.room) {
            room = decodeURIComponent(params.room);
            socket.emit('join', room);
        } else {
            while ((room = prompt("部屋名を入力してください", 'test_room')) == '');
            //var room = prompt("部屋名を入力してください", 'test_room');
            socket.emit('join', room);
        }
        // csvチャットデータログの読み込み
        import_csv(`../chatlogs/${room}.csv`);
        document.querySelector('#name_room').innerHTML = room;
    });

    socket.on('disconnect', () => {
        //console.log('you have been disconnected');
    });
    // Whenever the server emits 'user joined', log it in the chat body
    socket.on('user joined', (data) => {
        document.querySelector('#number_of_users').value = data.numUsers;
    });
    // Whenever the server emits 'user left', log it in the chat body
    socket.on('user left', (data) => {

    });
    socket.on('reconnect', () => {
        log('you have been reconnected');
        // 部屋名を指定してジョインする．部屋名が指定されていない場合はalertを出す
        let params = getURLParams();
        if (params.room) {
            room = decodeURIComponent(params.room);
            socket.emit('join', room);
        } else {
            room = prompt("部屋名を入力してください", 'test_room');
            socket.emit('join', room);
        }
        // csvチャットデータログの読み込み
        import_csv(`../chatlogs/${room}.csv`);
        document.querySelector('#name_room').innerHTML = room;
        document.querySelector('#link_download').href = `../chatlogs/${room}.csv`;
    });
    socket.on('login', (data) => {
        //console.log(data);
        this.document.querySelector('#number_of_users').value = data.numUsers;
        document.querySelector('#link_download').href = `../chatlogs/${room}.csv`;
    });
    socket.on('deactivate_comment_control', (data) => {

    });

    socket.on("connect", () => {
        socket.emit("watcher", socket.id);
    });

    socket.on("broadcaster", () => {
        socket.emit("watcher", socket.id);
    });

    socket.on("stop streaming", () => {

    });

    socket.on("disconnectPeer", () => {
        peerConnection.close();
    });

    window.onunload = window.onbeforeunload = () => {
        socket.close();
    };



});

// CSVの読み込み
function import_csv(csv_path) {
    fetch(csv_path)
        .then((res) => {
            if (!res.ok) {
                console.log('正常にリクエストを処理できませんでした。');
            }
            return res.text();
        })
        .then((csv_data) => {
            convert_array(csv_data);
        })
        .catch((error) => {
            console.log('エラーが発生しました。', error);
        })
}

// テキストデータを配列に変換
function convert_array(csv_data) {
    let data_array = [];
    const data_string = csv_data.split('\n');
    for (let i = 0; i < data_string.length; i++) {
        data_array[i] = data_string[i].split(',');
    }
    for (row of data_array) {
        if (row.length == 4) {
            createComment(row[1], row[2], row[3]);
        }
    }
}

function checkNameFrom(value) {
    ////console.log(value);
    if (value == '') {
        document.querySelector('#name_from').value = '匿名';
    }
}
function checkNameTo(value) {
    //console.log(value);
    if (value == '') {
        document.querySelector('#name_to').value = '全員';
    }
}




function clickSendButton(value) {
    let comment = document.querySelector('#textarea_comment').value;
    let name_from = document.querySelector('#name_from').value;
    let name_to = document.querySelector('#name_to').value;
    if (comment != '' && name_from != '' && name_to != '') {
        sendComment(
            comment, false, name_from, 0, false, 0, false, 0, name_to
        );
    }
    else {
        alert('空欄があります');
    }
}

// _hidden: 隠しコマンド、-1のときはなし、0以上がコマンドのidとなる。
function sendComment(
    _str_comment, _flg_emoji, _str_my_name,
    _flg_img, _id_img, _flg_sound, _id_sound, _hidden,
    _str_name_to) {

    //console.log(_str_comment);
    var data = {
        key: '',
        my_name: _str_my_name,
        name_to: _str_name_to,
        comment: _str_comment,
        flg_speech: false,
        color_text: '0x000000',
        color_text_stroke: '0xFFFFFF',
        flg_emoji: _flg_emoji,
        flg_image: false,
        id_image: 0,
        flg_sound: _flg_sound,
        id_sound: _id_sound,
        hidden: _hidden
    }
    if (_str_comment.length > 0) {
        //console.log(data);
        socket.emit("comment", data);
    }

    createComment(_str_my_name, _str_name_to, _str_comment);
    document.querySelector('#textarea_comment').value = '';
}

function createComment(_name_from, _name_to, _comment) {
    // <div class="card mb-4">
    //         <div class="card-header">
    //             to 馬場さん <span class="small text-muted">from 竹内</span>
    //         </div>
    //         <div class="card-body">
    //             <p class="card-text">With supporting text below as a natural lead-in to additional content.</p>
    //         </div>
    //     </div>
    let card = document.createElement('div');

    card.classList = 'card mb-4';
    let card_header = document.createElement('div');
    card_header.classList = 'card-header';
    card_header.innerHTML = `to ${_name_to} `;
    let span = document.createElement('span');
    span.classList = 'small text-muted';
    span.innerHTML = `from ${_name_from}`;
    card_header.appendChild(span);
    card.appendChild(card_header);

    let card_body = document.createElement('div');
    card_body.classList = 'card-body';
    let p = document.createElement('p');
    p.classList = 'card-text';
    p.innerHTML = Autolinker.link(_comment.replaceAll('\n', '<br>'), {
        stripPrefix: true
    });
    card_body.appendChild(p);
    card.appendChild(card_body);

    document.querySelector('#comments').prepend(card);
}

function copyShareLink() {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(`${window.location.origin}/textable/index.html?room=${room}`);
    }
    let button = document.querySelector('#button_sharelink');
    button.innerHTML = "Copied";
    button.classList = "btn btn-success mb-2";
    setTimeout(function () {
        button.innerHTML = "Copy Share Link";
        button.classList = "btn btn-primary mb-2";
    }, 1000);
}
