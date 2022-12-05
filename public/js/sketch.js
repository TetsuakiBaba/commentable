var api_key;
var socket;
var flg_sound_mute = true;
var sound;
var sound_chime;

var flg_chime;
var flg_clock;
var flg_noDraw;
var time_start;
var time_start_hour;
var time_start_minute;
var time_end;
var time_end_hour;
var time_end_minute;
var is_streaming = false;

var timestamp_last_send

var p5_captures;
var flg_speech;
var flg_deactivate_comment_control;
let peerConnection;
const config = {
  iceServers: [{
    urls: ["stun:stun.l.google.com:19302"]
  }]
};


var color_text;
var color_text_stroke;
var capture;
var capture_screen;
var volume = 0.1;
var flash;

var speech;

function setup() {

  textFont("Noto Sans JP");
  flg_deactivate_comment_control = false;
  color_text = document.getElementById("color_text").value;
  color_text_stroke = document.getElementById("color_text_stroke").value;

  //socket = io.connect('http://localhost');
  //socket = io.connect('https://commentable.lolipop.io')
  socket = io.connect(window.location.origin);

  // 誰かがコメント送信してきた場合
  socket.on('comment', newComment);

  // 接続確認のメッセージがきた場合
  socket.on('you_are_connected', function () {
    // 部屋名を指定してジョインする．部屋名が指定されていない場合はalertを出す
    let params = getURLParams();
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
      var room = decodeURIComponent(params.room);
      socket.emit('join', room);
    } else {
      var room = prompt("部屋名を入力してください", 'test_room');
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

  socket.on("offer", (id, description) => {

    peerConnection = new RTCPeerConnection(config);
    peerConnection
      .setRemoteDescription(description)
      .then(() => peerConnection.createAnswer())
      .then(sdp => peerConnection.setLocalDescription(sdp))
      .then(() => {
        socket.emit("answer", id, peerConnection.localDescription);
      });

    peerConnection.ontrack = event => { };
    peerConnection.onicecandidate = event => {
      if (event.candidate) {
        socket.emit("candidate", id, event.candidate);
      }
    };

  });

  socket.on("candidate", (id, candidate) => {
    peerConnection
      .addIceCandidate(new RTCIceCandidate(candidate))
      .catch(e => console.error(e));
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


  select("#button_send").mouseClicked(pushedSendButton);
  select("#button_send_letter").mouseClicked(pushedSendLetterButton);
  select("#checkbox_speech").mouseClicked(toggleSpeech);
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

  timestamp_last_send = millis();
  console.log(timestamp_last_send);
  noCanvas();
}


var count_comment = 0;

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
  var psconsole = $('#textarea_comment_history');
  psconsole.scrollTop(
    psconsole[0].scrollHeight - psconsole.height()
  );

}

function pushedSendButton() {
  sendComment(
    document.getElementById("text_comment").value, false,
    document.getElementById("text_my_name").value,
    false, 0,
    false, 0, -1);
}

function pushedSendLetterButton() {
  sendLetter(
    document.getElementById("text_letter").value,
    document.getElementById("text_my_name").value
  );
}


// _hidden: 隠しコマンド、-1のときはなし、0以上がコマンドのidとなる。
function sendComment(_str_comment, _flg_emoji, _str_my_name, _flg_img, _id_img, _flg_sound, _id_sound, _hidden) {

  if ((millis() - timestamp_last_send) > 10 || flg_deactivate_comment_control == true) {
    if (_flg_img == false) {
      if (_str_comment.length <= 0) {
        return;
      }
      if (_str_comment.length > 80) {
        alert("一度に遅れる文字数は80文字までです．");
        return;
      }
      var data = {
        key: api_key,
        my_name: _str_my_name,
        comment: _str_comment,
        flg_speech: flg_speech,
        color_text: color_text,
        color_text_stroke: color_text_stroke,
        flg_emoji: _flg_emoji,
        flg_image: false,
        id_image: 0,
        flg_sound: _flg_sound,
        id_sound: _id_sound,
        hidden: _hidden
      }
      if (_str_comment.length > 0) {
        socket.emit("comment", data);
      }

      newComment(data);
      clearTextBox();
    } else {
      var data = {
        room_name: _str_room_name,
        comment: "",
        flg_speech: flg_speech,
        color_text: color_text,
        color_text_stroke: color_text_stroke,
        flg_image: true,
        id_image: 0,
        flg_sound: _flg_sound,
        id_sound: _id_sound
      }
      socket.emit("comment", data);
      newComment(data);
    }
    timestamp_last_send = millis();
  }
  else {
    alert("いつも素敵なコメントありがとうございます\n投稿まで後 " + str(5 - parseInt((millis() - timestamp_last_send) / 1000)) + " 秒お待ち下さい。\n\n注）画面上部の「繰り返し」ランプが点灯しているときは連投ができます。");
  }
}


// お手紙送信機能
function sendLetter(_str_letter, _str_my_name) {

  if (_str_letter.length <= 0) {
    return;
  }
  if (_str_letter.length > 400) {
    alert("はがきの場合、一度に遅れる文字数は400文字までです。");
    return;
  }
  var data = {
    key: api_key,
    my_name: _str_my_name,
    letter: _str_letter
  }
  if (_str_letter.length > 0) {
    let result = confirm('はがきを送る際はName設定（ペンネーム等）を推奨します。以下の内容でよければOKを押して送信します。\n\nペンネーム：' + _str_my_name + '\n内容：' + _str_letter);
    if (result) {
      socket.emit("letter", data);
      clearLetterTextBox();
    }
  }


}

var is_control_pressed = false;

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
    let hidden = -1;
    if (is_control_pressed) {
      hidden = 0;
    }

    sendComment(
      document.getElementById("text_comment").value,
      false,
      document.getElementById("text_my_name").value,
      false, 0,
      false, 0,
      hidden
    );

  } else {

  }
}

function clearTextBox() {
  document.getElementById("text_comment").value = "";
}

function clearLetterTextBox() {
  document.getElementById("text_letter").value = "";
}



function changeRoomName() {

}

function changeTextColor() {
  color_text = this.value();
}

function changeTextOutlineColor() {
  color_text_stroke = this.value();
}

function windowResized() {

}

function sendEmojiReaction() {
  sendComment(
    this.html(), true,
    document.getElementById("text_my_name").value,
    false, 0,
    false, 0, -1
  );
}

function sendSoundReaction() {
  var id_sound = this.attribute("value");
  sendComment(
    this.html(), false,
    document.getElementById("text_my_name").value,
    false, 0,
    true, id_sound, -1
  );
}


function changeVolume() {
  this.html("test", false);
  volume = this.value();
  if (volume == 0) {
    //console.log(this);
  }
}

function changeStreamVolume() {
  var element = document.getElementById("stream_video");
  element.volume = this.value();
}

function toggleSoundMute() {
  flg_sound_mute = !flg_sound_mute;
  // no sound
  if (flg_sound_mute == true) {
    this.html("&#x1f507;");
  }
  // with sound
  else {
    this.html("&#x1f508;");
  }
}

function toggleStreamMute() {
  print(this.value());
  // no sound
  if (this.value() == "true") this.value("false");
  else this.value("true");

  if (this.value() == "true") {
    this.html("&#x1f507;");
    // turn off broadcasting sound
    if (is_streaming) {
      var element = document.getElementById("stream_video");
      element.muted = true;
    }
  }
  // with sound
  else {
    this.html("&#x1f508;");
    // turn on broadcasting sound
    if (is_streaming) {
      var element = document.getElementById("stream_video");
      element.muted = false;
    }
  }
}


var flg_camera_is_opened = false;

function toggleCamera() {
  if (flg_camera_is_opened == false) {
    flg_camera_is_opened = true;
    var videoSelect = document.querySelector("select#videoSource");
    console.log(videoSelect.value);
    p5_captures.openCamera(videoSelect.value);
    this.attribute('class', "btn btn-danger btn-sm");
  } else {
    flg_camera_is_opened = false;
    p5_captures.closeCamera();
    this.attribute('class', "btn btn-outline-secondary btn-sm");
  }
  resizeCanvas(windowWidth - 30, (windowWidth - 30) * 9.0 / 16.0);
}

function toggleChime() {
  print(this.checked());
  flg_chime = this.checked();
}

function toggleClock() {
  flg_clock = this.checked();
}

function toggleSpeech() {
  flg_speech = this.checked();
  if (flg_speech == true) {
    // set red button class
    //<div class="input-group-prepend"><button id="button_send" class="btn btn-outline-primary btn-sm"></button>
    //document.getElementById('button_send').setAttribute('class', 'btn btn-outline-danger btn-sm');
  } else {
    // set normal(primary) button class
    //document.getElementById('button_send').setAttribute('class', 'btn btn-outline-primary btn-sm');
  }
}

function toggleDraw() {
  flg_noDraw = this.checked();
  let canvas_element = document.getElementById("sketch-holder");
  if (flg_noDraw) {
    //noLoop();
    canvas_element.style.display = "none";
  } else {
    //loop();
    canvas_element.style.display = "block";
  }
}


function updateStartTime() {
  time_start = this.value();
  var tmp_time = time_start.split(":");
  time_start_hour = int(tmp_time[0]);
  time_start_minute = int(tmp_time[1]);
}

function updateEndTime() {
  time_end = this.value();
  var tmp = time_end.split(":");
  time_end_hour = int(tmp[0]);
  time_end_minute = int(tmp[1]);

}

function toggleScreenCapture() {
  if (!p5_captures.screen) {
    p5_captures.openScreen();
    this.attribute('class', "btn btn-danger btn-sm");
  }

  if (p5_captures.screen.c.loadedmetadata) {
    p5_captures.closeScreen();
    this.attribute('class', "btn btn-outline-secondary btn-sm");
  }
  resizeCanvas(windowWidth - 30, (windowWidth - 30) * 10.0 / 16.0);
}