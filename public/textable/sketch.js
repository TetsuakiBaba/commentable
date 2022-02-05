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
        createComment(data.timestamp, data.my_name, data.name_to, data.comment, data.id_comment, false);
        //        console.log(data);
    });

    socket.on("delete comment", (data) => {
        console.log(data);
        deleteDOMCard(data.id, false);
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
            history.replaceState('', '', `?room=${room}`);

        }
        // csvチャットデータログの読み込み
        import_csv(`../chatlogs/${room}.csv`);
        document.querySelector('#name_room').innerHTML = room;
    });

    socket.on('disconnect', () => {
        //console.log('you have been disconnected');
        //window.location.reload();
        toggleModal();
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


    // localStorageから名前の入力を補完してあげる
    const name_from = localStorage.getItem('name_from');
    if (name_from) {
        document.querySelector('#name_from').value = name_from;
    }
    const name_to = localStorage.getItem('name_to');
    if (name_to) {
        document.querySelector('#name_to').value = name_to;
    }

});

// CSVの読み込み
function import_csv(csv_path) {
    fetch(csv_path)
        .then((res) => {
            if (!res.ok) {
                console.log('Warning: no chatlog, new room?');
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
        if (row.length == 5) {
            createComment(row[0], row[1], row[2], row[3], row[4], false);
        }
    }
}

function checkNameFrom(value) {
    ////console.log(value);
    if (value == '') {
        document.querySelector('#name_from').value = '匿名 さん';
    }

    localStorage.setItem('name_from', value);
}
function checkNameTo(value) {
    //console.log(value);
    if (value == '') {
        document.querySelector('#name_to').value = '全員';
    }
    localStorage.setItem('name_to', value);
}

function clickSendButton(value) {
    let comment = document.querySelector('#textarea_comment').value;
    let name_from = document.querySelector('#name_from').value;
    let name_to = document.querySelector('#name_to').value;
    let id_comment = Math.random().toString(32).substring(2);
    if (comment != '' && name_from != '' && name_to != '') {
        sendComment(
            id_comment, comment, false, name_from, 0, false, 0, false, 0, name_to
        );
        closeQuote();
    }
    else {
        alert('空欄があるので送信できません');
    }
}

// _hidden: 隠しコマンド、-1のときはなし、0以上がコマンドのidとなる。
function sendComment(
    _id_comment,
    _str_comment, _flg_emoji, _str_my_name,
    _flg_img, _id_img, _flg_sound, _id_sound, _hidden,
    _str_name_to) {


    //console.log(_str_comment);
    let name_from = _str_my_name.trim(',');
    let name_to = _str_name_to.trim(',');
    let comment = _str_comment.replaceAll('\n', '<br>');

    if (document.querySelector('#quote').hidden == false) {
        let comment_quote = '<div class="quote"><p>' + document.querySelector('#p_quote').innerHTML + '</p></div>';
        comment = comment_quote + comment.replaceAll(',', '、');
    }
    else {
        comment = comment.replaceAll(',', '、');
    }
    let today = new Date();
    var data = {
        timestamp: today.toLocaleString(),
        key: '',
        my_name: name_from,
        name_to: name_to,
        comment: comment,
        id_comment: _id_comment,
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
        console.log(data);
        socket.emit("comment", data);
    }

    createComment(today.toLocaleString(), _str_my_name, _str_name_to, comment, _id_comment, true);
    document.querySelector('#textarea_comment').value = '';
}

function createComment(_timestamp, _name_from, _name_to, _comment, _id, _is_my_comment) {
    let card = document.createElement('div');

    card.classList = 'card mb-4';
    card.value = _id;
    let card_header = document.createElement('div');
    card_header.classList = 'card-header';

    let row_card_header = document.createElement('div');
    row_card_header.classList = 'row';
    let col1_card_header = document.createElement('div');
    col1_card_header.classList = 'col-6';
    let span_to = document.createElement('span');
    span_to.innerHTML = 'to ';
    let span_name_to = document.createElement('span');
    span_name_to.id = 'card_name_to';
    span_name_to.innerHTML = `${_name_to} `;
    col1_card_header.appendChild(span_to);
    col1_card_header.appendChild(span_name_to);

    let span_from = document.createElement('span');
    span_from.classList = 'small text-muted';
    span_from.innerHTML = 'from';
    col1_card_header.appendChild(span_from);

    let span_name_from = document.createElement('span');
    span_name_from.classList = 'small text-muted';
    span_name_from.id = 'card_name_from';
    span_name_from.innerHTML = ` ${_name_from}`;
    col1_card_header.appendChild(span_name_from);



    let col2_card_header = document.createElement('div');
    col2_card_header.classList = 'col-6';
    col2_card_header.style = "text-align:right;";

    let icon_reply = document.createElement('i');
    icon_reply.classList = "bi bi-reply";
    icon_reply.style = "cursor:pointer;"
    icon_reply.value = _id;
    icon_reply.addEventListener('click', function () {
        console.log('hello');
        let cards = document.querySelectorAll('.card');
        for (card of cards) {
            if (card.value == this.value) {
                document.querySelector('#quote').hidden = false;
                document.querySelector('#p_quote').innerHTML = card.querySelector('.card-body').innerHTML;
                document.querySelector('#name_to').value = document.querySelector('#card_name_from').innerHTML;
                window.scroll({ top: 0, behavior: 'smooth' });
            }
        }
    });
    col2_card_header.appendChild(icon_reply);
    //col2_card_header.innerHTML += ' ';

    //<i class="bi bi-x-circle"></i>

    let icon_edit = document.createElement('i');
    icon_edit.classList = 'bi bi-x';
    icon_edit.style = "cursor:pointer;"
    icon_edit.value = _id;
    icon_edit.id = 'icon_edit';
    icon_edit.addEventListener('click', function () {
        deleteDOMCard(this.value, true);
        console.log(this.value);
    })
    if (_is_my_comment) icon_edit.hidden = false;
    else icon_edit.hidden = true;
    col2_card_header.appendChild(icon_edit);


    row_card_header.appendChild(col1_card_header);
    row_card_header.appendChild(col2_card_header);

    card_header.appendChild(row_card_header);
    card.appendChild(card_header);
    //console.log(card);


    let card_body = document.createElement('div');
    card_body.classList = 'card-body';
    let p = document.createElement('p');
    p.classList = 'card-text';
    p.innerHTML = Autolinker.link(_comment.replaceAll('\n', '<br>'), {
        stripPrefix: true
    });
    card_body.appendChild(p);
    card.appendChild(card_body);


    let card_footer = document.createElement('div');
    card_footer.classList = 'card-footer small text-muted';
    card_footer.style = 'text-align:right';
    card_footer.innerHTML = `${_timestamp} [${_id}]`;
    card_footer.value = _id;
    card.appendChild(card_footer);
    document.querySelector('#comments').prepend(card);
}

function deleteDOMCard(_id, _is_my_comment) {
    let cards = document.querySelectorAll('.card');
    for (card of cards) {
        let icon_edit = card.querySelector('#icon_edit');
        if (icon_edit) {
            if (icon_edit.value === _id) {
                let p = card.querySelector('p');
                if (_is_my_comment) {
                    document.querySelector('#textarea_comment').value = p.innerHTML;
                    socket.emit('delete comment', {
                        id: _id
                    });
                }
                card.remove();
            }
        }
    }
    console.log(cards);
}

function copyShareLink() {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(`${window.location.origin}/textable/index.html?room=${room}`);
    }
    let button = document.querySelector('#button_sharelink');
    button.innerHTML = "Copied";
    button.classList = "btn btn-success mb-2";
    setTimeout(function () {
        button.innerHTML = '<i class="bi bi-link-45deg"></i> Link';
        button.classList = "btn btn-secondary mb-2";
    }, 1000);
}

function commentSearch(value) {
    console.log(value);

    let cards = document.querySelectorAll('.card');

    for (card of cards) {
        console.log(card);
        let count_found = 0;
        let str = card.querySelector('.card-text').innerHTML;
        if (str.indexOf(value) >= 0) {
            count_found++;
        }
        str = card.querySelector('#card_name_from').innerHTML;
        if (str.indexOf(value) >= 0) {
            count_found++
        }

        str = card.querySelector('#card_name_to').innerHTML;
        if (str.indexOf(value) >= 0) {
            count_found++
        }

        str = card.querySelector('.card-footer').innerHTML;
        if (str.indexOf(value) >= 0) {
            count_found++
        }


        if (count_found > 0) {
            card.hidden = false;
        }
        else {
            card.hidden = true;
        }
    }
}

function closeQuote() {
    document.querySelector('#quote').hidden = true;
    document.querySelector('#p_quote').innerHTML = '';
}

function exitRoom() {
    //window.location.reload();
    //    console.log(window.location);
    let ret = confirm('退出しますか？/Are you sure to exit chat room?');
    if (ret) {
        let href = window.location.href.replace(`?room=${room}`, '');
        document.location.href = href;
    }


}

function toggleModal() {
    var myModal = new bootstrap.Modal(document.getElementById('disconnectedModal'), {
        backdrop: false,
        keyboard: false,
    })
    myModal.toggle();
}