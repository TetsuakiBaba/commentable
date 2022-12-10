let api_key;
let socket;
let sound;
let flg_deactivate_comment_control;
let color_text;
let color_text_stroke;

class Param {
  constructor() {
    this.str_comment = '';
    this.flg_emoji = false;
    this.str_my_name = '';
    this.flg_sound = false;
    this.id_sound = 0;
  }
}

function setup() {
  textFont("Noto Sans JP");
  flg_deactivate_comment_control = false;
  color_text = document.getElementById("color_text").value;
  color_text_stroke = document.getElementById("color_text_stroke").value;
  socket = io.connect(window.location.origin);

  // 誰かがコメント送信してきた場合
  socket.on('comment', newComment);

  // 接続確認のメッセージがきた場合
  socket.on('you_are_connected', function () {
    // 部屋名を指定してジョインする．部屋名が指定されていない場合はalertを出す
    let params = getURLParams();
    if (params.room) {
      let room = decodeURIComponent(params.room);
      socket.emit('join', room);
    } else {
      while ((room = prompt("部屋名を入力してください", 'test_room')) == '');
      //let room = prompt("部屋名を入力してください", 'test_room');
      socket.emit('join', room);
    }
  });

  socket.on('disconnect', () => {
    log('you have been disconnected');
  });
  // Whenever the server emits 'user joined', log it in the chat body
  socket.on('user joined', (data) => {
    log(data.username + ' joined');
    document.getElementById('text_number_of_joined').value = str(data.numUsers);
  });
  // Whenever the server emits 'user left', log it in the chat body
  socket.on('user left', (data) => {
    log(data.username + ' left');
    document.getElementById('text_number_of_joined').value = str(data.numUsers);
  });
  socket.on('reconnect', () => {
    log('you have been reconnected');
    // 部屋名を指定してジョインする．部屋名が指定されていない場合はalertを出す
    let params = getURLParams();
    if (params.room) {
      let room = decodeURIComponent(params.room);
      socket.emit('join', room);
    } else {
      let room = prompt("部屋名を入力してください", 'test_room');
      socket.emit('join', room);
    }
  });
  socket.on('login', (data) => {
    document.getElementById('text_number_of_joined').value = str(data.numUsers);
    flg_deactivate_comment_control = data.deactivate_comment_control;
    document.getElementById('checkbox_deactivate_comment_control').checked = flg_deactivate_comment_control;
  });
  socket.on('deactivate_comment_control', (data) => {
    document.getElementById('checkbox_deactivate_comment_control').checked = data.control;
    flg_deactivate_comment_control = data.control;
  });

  socket.on("connect", () => {
    socket.emit("watcher", socket.id);
  });

  socket.on("broadcaster", () => {
    socket.emit("watcher", socket.id);
  });

  socket.on("stop streaming", () => {

  });

  window.onunload = window.onbeforeunload = () => {
    socket.close();
  };

  select("#button_send").mouseClicked(pushedSendButton);
  select("#color_text").changed(changeTextColor);
  select("#color_text_stroke").changed(changeTextOutlineColor);

  select("#button_emoji_reaction_01").mouseClicked(sendEmojiReaction);
  select("#button_emoji_reaction_02").mouseClicked(sendEmojiReaction);
  select("#button_emoji_reaction_03").mouseClicked(sendEmojiReaction);
  select("#button_emoji_reaction_04").mouseClicked(sendEmojiReaction);
  select("#button_emoji_reaction_05").mouseClicked(sendEmojiReaction);

  select("#button_sound_reaction_00").mouseClicked(sendSoundReaction);
  select("#button_sound_reaction_01").mouseClicked(sendSoundReaction);
  select("#button_sound_reaction_02").mouseClicked(sendSoundReaction);
  select("#button_sound_reaction_03").mouseClicked(sendSoundReaction);
  select("#button_sound_reaction_04").mouseClicked(sendSoundReaction);
  select("#button_sound_reaction_05").mouseClicked(sendSoundReaction);
  select("#button_sound_reaction_06").mouseClicked(sendSoundReaction);
  select("#button_sound_reaction_07").mouseClicked(sendSoundReaction);
  select("#button_sound_reaction_08").mouseClicked(sendSoundReaction);
  select("#button_sound_reaction_09").mouseClicked(sendSoundReaction);

  select("#download_all_comments").mouseClicked(downloadAllComments);

  noCanvas();
}

let count_comment = 0;
function newComment(data) {
  count_comment++;
  let comment_format = "[" + nf(year(), 4) + ":" + nf(month(), 2) + ":" + nf(day(), 2) + ":" + nf(hour(), 2) + ":" + nf(minute(), 2) + ":" + nf(second(), 2) + "-" + nf(count_comment, 4) + "] ";
  comment_format += data.comment;
  if (data.flg_sound == true) {
    comment_format += " [sound]";
  }

  comment_format += "[" + data.my_name + "]" + "\n";
  //here
  select("#textarea_comment_history").html(comment_format, true);
  let psconsole = $('#textarea_comment_history');
  psconsole.scrollTop(
    psconsole[0].scrollHeight - psconsole.height()
  );
}

function pushedSendButton() {
  let param = new Param();
  param.str_comment = document.getElementById("text_comment").value;
  param.flg_emoji = false;
  param.str_my_name = document.getElementById("text_my_name").value;
  param.flg_sound = false;
  param.id_sound = 0;

  sendComment(param);
}

function sendComment(param) {
  const _str_comment = param.str_comment;
  const _flg_emoji = param.flg_emoji;
  const _str_my_name = param.str_my_name;
  const _flg_sound = param.flg_sound;
  const _id_sound = param.id_sound;

  if (_str_comment.length <= 0) {
    return;
  }

  if (_str_comment.length > 80) {
    alert("一度に送れる文字数は80文字までです．");
    return;
  }

  let data = {
    key: api_key,
    my_name: _str_my_name,
    comment: _str_comment,
    color_text: color_text,
    color_text_stroke: color_text_stroke,
    flg_emoji: _flg_emoji,
    flg_image: false,
    id_image: 0,
    flg_sound: _flg_sound,
    id_sound: _id_sound,
  }
  if (_str_comment.length > 0) {
    socket.emit("comment", data);
  }
  newComment(data);
  clearTextBox();

}

let is_control_pressed = false;
function keyReleased() {
  if (keyCode == CONTROL) {
    is_control_pressed = false;
  }
}

function keyPressed() {
  if (keyCode == CONTROL) {
    is_control_pressed = true;
  }
  if (key == "Enter") {
    let param = new Param();
    param.str_comment = document.getElementById("text_comment").value;
    param.flg_emoji = false;
    param.str_my_name = document.getElementById("text_my_name").value;
    param.flg_sound = false;
    param.id_sound = 0;

    sendComment(param);
  }
}

function clearTextBox() {
  document.getElementById("text_comment").value = "";
}

function changeTextColor() {
  color_text = this.value();
}

function changeTextOutlineColor() {
  color_text_stroke = this.value();
}

function sendEmojiReaction() {
  let param = new Param();
  param.str_comment = this.html();
  param.flg_emoji = true;
  param.str_my_name = document.getElementById("text_my_name").value;
  param.flg_sound = false;
  param.id_sound = 0;

  sendComment(param);
}

function sendSoundReaction() {
  let id_sound = this.attribute("value");
  let param = new Param();
  param.str_comment = this.html();
  param.flg_emoji = false;
  param.str_my_name = document.getElementById("text_my_name").value;
  param.flg_sound = true;
  param.id_sound = id_sound;

  sendComment(param);
}
