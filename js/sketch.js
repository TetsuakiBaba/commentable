let socket;
let sound;
let sound_chime;
let flg_chime;
let flg_clock;
let flg_noDraw;
let time_start;
let time_start_hour;
let time_start_minute;
let time_end;
let time_end_hour;
let time_end_minute;
let is_streaming = false;

let timestamp_last_send
let flg_deactivate_comment_control;
let peerConnection;

let color_text;
let color_text_stroke;
let volume = 0.1;
let flash;

let mycanvas;
let max_number_of_comment = 50;

const hostname = "https://commentable.fly.dev";
// const hostname = "http://localhost:8080";

let comments = []; //new Array(50);
function whileLoading(total) {
  console.log('loaded: ', + total);
}

function preload() {
  let count_loaded = 0;
  for (let i = 0; i < max_number_of_comment; i++) {
    comments[i] = new Comment();
    comments[i].setLife(0);
  }
  // Load sound files
  sound_chime = loadSound('./sounds/chime.mp3', readyLoading(++count_loaded), null, whileLoading);
  sound = [
    [loadSound('./sounds/camera1.mp3', readyLoading(++count_loaded)),
    loadSound('./sounds/camera2.mp3', readyLoading(++count_loaded)),
    loadSound('./sounds/camera3.mp3', readyLoading(++count_loaded))],
    [loadSound('./sounds/clap1.mp3', readyLoading(++count_loaded)),
    loadSound('./sounds/clap2.mp3', readyLoading(++count_loaded)),
    loadSound('./sounds/clap3.mp3', readyLoading(++count_loaded)),
    loadSound('./sounds/clap4.mp3', readyLoading(++count_loaded)),
    loadSound('./sounds/clap5.mp3', readyLoading(++count_loaded)),
    loadSound('./sounds/clap6.mp3', readyLoading(++count_loaded)),
    loadSound('./sounds/clap7.mp3', readyLoading(++count_loaded)),
    loadSound('./sounds/clap8.mp3', readyLoading(++count_loaded))],
    loadSound('./sounds/cracker.mp3', readyLoading(++count_loaded)),
    loadSound('./sounds/kansei.mp3', readyLoading(++count_loaded)),
    loadSound('./sounds/he.wav', readyLoading(++count_loaded)),
    loadSound('./sounds/chottomatte.wav', readyLoading(++count_loaded)),
    loadSound('./sounds/OK.wav', readyLoading(++count_loaded)),
    loadSound('./sounds/punch.mp3', readyLoading(++count_loaded)),
    loadSound('./sounds/laugh3.mp3', readyLoading(++count_loaded)),
    [loadSound('./sounds/kusa00.mp3', readyLoading(++count_loaded)),
    loadSound('./sounds/kusa01.mp3', readyLoading(++count_loaded)),
    loadSound('./sounds/kusa02.mp3', readyLoading(++count_loaded)),
    loadSound('./sounds/kusa03.mp3', readyLoading(++count_loaded)),
    loadSound('./sounds/kusa04.mp3', readyLoading(++count_loaded)),
    loadSound('./sounds/kusa05.mp3', readyLoading(++count_loaded))]
  ]
  sound_dodon = loadSound('./sounds/dodon.mp3', readyLoading(++count_loaded));
  sound_drumroll = loadSound('./sounds/drumroll.mp3', readyLoading(++count_loaded));
  sound_dora = loadSound('./sounds/dora.mp3', readyLoading(++count_loaded));
  sound_deden = loadSound('./sounds/quiz.mp3', readyLoading(++count_loaded));
  sound_pingpong = loadSound('./sounds/seikai.mp3', readyLoading(++count_loaded));
  sound_chin = loadSound('./sounds/chin.mp3', readyLoading(++count_loaded));
  sound_kansei = loadSound('./sounds/kansei.mp3', readyLoading(++count_loaded));
  sound_applause = loadSound('./sounds/applause.mp3', readyLoading(++count_loaded));
}

function startSocketConnection(room) {
  socket = io.connect(hostname);
  socket.on('you_are_connected', function () {
    // 部屋名を指定してジョインする．
    socket.emit('join', room);
  });

  socket.on('comment', newComment);
  socket.on('disconnect', () => {
    log('you have been disconnected');
  });

  // Whenever the server emits 'user joined', log it in the chat body
  socket.on('user joined', (data) => {
    log(data.username + ' joined');
  });
  // Whenever the server emits 'user left', log it in the chat body
  socket.on('user left', (data) => {
    log(data.username + ' left');
  });
  socket.on('reconnect', () => {
    log('you have been reconnected');
    socket.emit('join', room);
  });
  socket.on('login', (data) => {
  });
  socket.on('deactivate_comment_control', (data) => {
  });

  socket.on("disconnectPeer", () => {
    peerConnection.close();
  });

  window.onunload = window.onbeforeunload = () => {
    socket.close();
  };
}

function setup() {
  textFont("Noto Sans JP");
  mycanvas = createCanvas(windowWidth, windowHeight);
  console.log(windowWidth, windowHeight);
  document.getElementById("canvas_placeholder").append(mycanvas.elt);

  frameRate(30);
  flg_deactivate_comment_control = false;
  let params = getURLParams();
  if (params.name) {}

  timestamp_last_send = millis();
  console.log(timestamp_last_send);
  textAlign(CENTER, CENTER);
  flg_sound_mute = false;
}

function draw() {
  clear();
  background(0, 0, 0, 0);

  for (let i = 0; i < max_number_of_comment; i++) {
    if (comments[i].getLife() > 0) {
      comments[i].update();
      comments[i].draw();
    }
  }
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


  if (data.flg_image == false) {
    let id = -1;
    if (data.comment.length <= 0) {
      return;
    }
    for (let i = 0; i < max_number_of_comment; i++) {
      if (comments[i].getLife() == 0) {
        id = i;
        i = max_number_of_comment;
      }
    }
    if (id >= 0) {
      comments[id].setLife(255);
      comments[id].setText(data.comment);
      textSize(abs((height / 20) * sin(0.5 * PI)));
      let text_width = textWidth(data.comment);
      console.log(textWidth(data.comment));
      if (text_width < width) {
        comments[id].setX(random(text_width / 2, width - text_width / 2));
      }
      else {
        comments[id].setX(text_width / 2);
      }
      comments[id].setY(random(100, height - 100));
      comments[id].setColor(data.color_text, data.color_text_stroke);
      comments[id].flg_image = data.flg_img;
      comments[id].id_image = data.id_img;
      comments[id].flg_sound = data.flg_sound;
      comments[id].id_sound = data.id_sound;

      if (data.flg_sound == true && flg_sound_mute == false) {
        comments[id].setVolume(volume);
        comments[id].playSound();
      }
    }

    let comment_format = "[" + nf(year(), 4) + ":" + nf(month(), 2) + ":" + nf(day(), 2) + ":" + nf(hour(), 2) + ":" + nf(minute(), 2) + ":" + nf(second(), 2) + "-" + nf(count_comment, 4) + "] ";
    comment_format += data.comment;
    if (data.flg_sound == true) {
      comment_format += " [sound]";
    }

    comment_format += "[" + data.my_name + "]" + "\n";
  } else { // image reaction
    for (var i = 0; i < max_number_of_comment; i++) {
      if (comments[i].getLife() == 0) {
        id = i;
        i = max_number_of_comment;
      }
    }
    if (id >= 0) {
      comments[id].setLife(255);
      comments[id].setX(random(100, width - 100));
      comments[id].setY(random(100, height - 100));
      comments[id].useImage(0);
    }
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function changeVolume() {
  this.html("test", false);
  volume = this.value();
  if (volume == 0) {
    //console.log(this);
  }
}

function toggleSoundMute() {
  flg_sound_mute = !flg_sound_mute;
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
  let tmp_time = time_start.split(":");
  time_start_hour = int(tmp_time[0]);
  time_start_minute = int(tmp_time[1]);
}

function updateEndTime() {
  time_end = this.value();
  let tmp = time_end.split(":");
  time_end_hour = int(tmp[0]);
  time_end_minute = int(tmp[1]);
}

function readyLoading(count_loaded) {
  console.log(count_loaded);
  document.getElementById('p5_loading').innerHTML = str(count_loaded) + ' files loaded.';
}

function toggleCommentControl(checked) {
  let data = {
    key: 'dummy',
    control: checked
  }
  socket.emit('deactivate_comment_control', data);
}
