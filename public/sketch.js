var socket;

var flg_sound_mute = true;
var comments = []; //new Array(50);
var max_number_of_comment = 50;
var sound;
var sound_chime;
var flg_chime;
var flg_clock;
var time_start;
var time_start_hour;
var time_start_minute;
var time_end;
var time_end_hour;
var time_end_minute;

class Flash{
  constructor(){
    this.alpha = 0;
    this.status = false;    
  }
  do(){
    this.status = true;
    this.alpha = 100;
  }
  draw(){
    if( this.status ){
      noStroke();
      fill(255, this.alpha);
      rect(0,0,width,height);
      this.alpha = this.alpha/10.0;
      if( this.alpha < 1.0 ){
        this.status = false;
      }
    }
  }
}
class Comment{
  constructor(){
    this.x = random(100);
    this.y = random(100);
    this.text = "test";
    this.alpha = random(100);
    this.life = 1; // 0 - 255
    this.size = 72.0;
    this.flg_img = false;
    this.volume = 0.1;
    
  }
  setColor(_color_text, _color_text_stroke)
  {
    this.color_text = _color_text;
    this.color_text_stroke = _color_text_stroke;
  }
  setLife(_life){
    this.life = _life;    
  }
  getLife(){
    return this.life;
  }
  setText(_text)
  {
    this.text = _text;
    return;
  }
  setX(_x){
    this.x = _x;
  }
  setY(_y){
    this.y = _y;
  }
  useImage(_id){
    this.flg_img = true;
  }
  setVolume(_volume){
    this.volume = _volume;
  }
  playSound(){
          
    if( sound[this.id_sound].length > 1){
      let number = int(random(sound[this.id_sound].length));
      sound[this.id_sound][number].setVolume(this.volume);
      sound[this.id_sound][number].play();
    }
    else{
      sound[this.id_sound].setVolume(this.volume);
      sound[this.id_sound].play();
    }
  }
  update()
  {
    if( this.life > 0 ){
      this.alpha = this.life;
      this.size = abs((height/20)*sin(0.5*PI*this.life/255.0));
      this.life = this.life - 1;
      if( this.life == 0 ){
        this.flg_img = false;
      }         
    }
    return;
  }
  draw(){
    
    if( this.flg_img == false){
      textSize(this.size);
      strokeWeight(5.0*this.alpha/255.0);
      stroke(this.color_text_stroke+str(hex(this.alpha,2)));      
      fill(this.color_text+str(hex(this.alpha,2)));
      text(this.text,this.x,this.y);
    }
    else{
      //imageMode(CENTER);
      //image(this.img[0],this.x, this.y, this.img[0].width*this.alpha/255, this.img[0].height*this.alpha/255);
    }
    return;
  }
}

var color_background;
var color_text;
var color_text_stroke;
var capture;
var capture_screen;
var volume = 0.1;
var flash;

function preload()
{
  for( var i = 0; i < max_number_of_comment; i++ ){
    comments[i] = new Comment();
    comments[i].setLife(0);
  }
  sound_chime = loadSound('assets/chime.mp3');
  sound = [
    [loadSound('assets/camera1.mp3'),loadSound('assets/camera2.mp3'), loadSound('assets/camera3.mp3')],
    [loadSound('assets/clap1.mp3'), loadSound('assets/clap2.mp3'), loadSound('assets/clap3.mp3'), loadSound('assets/clap4.mp3'), loadSound('assets/clap5.mp3'), loadSound('assets/clap6.mp3'), loadSound('assets/clap7.mp3'), loadSound('assets/clap8.mp3')],
    loadSound('assets/cracker.mp3'),
    loadSound('assets/he.wav'),
    loadSound('assets/chottomatte.wav'),
    loadSound('assets/OK.wav'),
    loadSound('assets/laugh1.mp3'),
    loadSound('assets/laugh2.mp3'),
    loadSound('assets/laugh3.mp3'),
    [loadSound('assets/kusa00.mp3'),loadSound('assets/kusa01.mp3'), loadSound('assets/kusa02.mp3'),loadSound('assets/kusa03.mp3'),loadSound('assets/kusa04.mp3'),loadSound('assets/kusa05.mp3')]
  ]
}


function setup() {
  
  var canvas = createCanvas(windowWidth-30,(windowWidth-30)*(9.0/16.0), P2D);
  canvas.parent('sketch-holder');
  color_background = document.getElementById("color_background").value;
  color_text = document.getElementById("color_text").value;
  color_text_stroke = document.getElementById("color_text_stroke").value;

  flash = new Flash();
  stroke(0);
  strokeWeight(1);
  textAlign(CENTER);
  textSize(32);
  textStyle(BOLD);
  background(100);
  
  //socket = io.connect('http://125.100.98.172:3000');
  //socket = io.connect('http://localhost');
  socket = io.connect('https://commentable.lolipop.io')
  socket.on('comment', newComment);
  select("#button_send").mouseClicked(pushedSendButton);
  select("#color_background").changed(changeBackgroundColor);
  select("#color_text").changed(changeTextColor);
  select("#color_text_stroke").changed(changeTextOutlineColor);
  select("#button_camera").mouseClicked(toggleCamera);
  //select("#button_image_reaction_01").mouseClicked(sendImageReaction01);
  select("#button_emoji_reaction_01").mouseClicked(sendEmojiReaction);
  select("#button_emoji_reaction_02").mouseClicked(sendEmojiReaction);
  select("#button_emoji_reaction_03").mouseClicked(sendEmojiReaction);
  
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

  select("#slider_volume").changed(changeVolume);
  select("#button_sound_mute").mouseClicked(toggleSoundMute);

  select("#checkbox_chime").mouseClicked(toggleChime);
  select("#checkbox_clock").mouseClicked(toggleClock);
  
  select("#time_start").changed(updateStartTime);
  select("#time_end").changed(updateEndTime);
  select("#button_toggle_screen_capture").mouseClicked(toggleScreenCapture);

  select("#download_all_comments").mouseClicked(downloadAllComments);
  flg_chime = document.getElementById("checkbox_chime").checked;
  flg_clock = document.getElementById("checkbox_clock").checked;
  time_start = document.getElementById("time_start").value;
  time_end = document.getElementById("time_end").value;
  sound_chime.setVolume(volume);
  document.getElementById("screen_size").value = str(int(width))+"x"+str(int(height));
  frameRate(30);
  
  
}

function touchStarted() {
  if (getAudioContext().state !== 'running') {
    getAudioContext().resume();
  }
}
function newComment(data)
{
  let my_room_name = document.getElementById("text_room_name").value;
  if( data.room_name != my_room_name ){
    return;
  }
  
  if( data.flg_image == false ){
    let id = -1;    
    if( data.comment.length <= 0 ){
      return;
    }
    for( var i = 0; i < max_number_of_comment; i++ ){
      if( comments[i].getLife() == 0 ){
        id = i;
        i = max_number_of_comment;
      }
    }
    if( id >= 0 ){
      comments[id].setLife(255);
      comments[id].setText(data.comment);
      comments[id].setX(random(100, width-100));
      comments[id].setY(random(100, height-100));
      comments[id].setColor(data.color_text, data.color_text_stroke);
      comments[id].flg_image = data.flg_img;
      comments[id].id_image = data.id_img;
      comments[id].flg_sound = data.flg_sound;
      comments[id].id_sound = data.id_sound;

      if( data.flg_sound == true && data.id_sound == 0 ){  // camera
        flash.do();
      }
      if( data.flg_sound == true && flg_sound_mute == false){
        comments[id].setVolume(volume);
        comments[id].playSound();
      }
    }
  
    let comment_format;
    if( data.flg_sound == true ){
      comment_format = "["+nf(year(),4)+":"+nf(month(),2)+":"+nf(day(),2)+":"+nf(hour(),2)+":"+nf(minute(),2)+":"+nf(second(),2)+"] "+data.comment+" [sound]\n";
    }
    else{
      comment_format = "["+nf(year(),4)+":"+nf(month(),2)+":"+nf(day(),2)+":"+nf(hour(),2)+":"+nf(minute(),2)+":"+nf(second(),2)+"] "+data.comment+"\n";
    }
    select("#textarea_comment_history").html(comment_format, true);
    var psconsole = $('#textarea_comment_history');
    psconsole.scrollTop(
        psconsole[0].scrollHeight - psconsole.height()
    );
  }
  else{  // image reaction
    for( var i = 0; i < max_number_of_comment; i++ ){
      if( comments[i].getLife() == 0 ){
        id = i;
        i = max_number_of_comment;
      }
    }
    if( id >= 0 ){
      comments[id].setLife(255);
      comments[id].setX(random(100, width-100));
      comments[id].setY(random(100, height-100));
      comments[id].useImage(0);
    }
    
    let comment_format = "["+nf(year(),4)+":"+nf(month(),2)+":"+nf(day(),2)+":"+nf(hour(),2)+":"+nf(minute(),2)+":"+nf(second(),2)+"] "+"image reaction"+"\n";
    select("#textarea_comment_history").html(comment_format, true);
    var psconsole = $('#textarea_comment_history');
    psconsole.scrollTop(
        psconsole[0].scrollHeight - psconsole.height()
    );
  }
  //console.log(data);
}

function draw() {
  //newComment("一般的には一秒間に30コマの静止画がある為，静止画と同じように扱うと，Processingでは処理落ちしてしまいます．");
  background(color_background);

  if(flg_camera_is_opened){    
    imageMode(CORNER);
    image(capture.c, 0,0, width, height);    
  }
  if( capture_screen ){
    image(capture_screen.c, 0,0, width, height);
  }

  
  for( var i = 0; i < max_number_of_comment; i++ ){
    
    if( comments[i].getLife() > 0 ){
      comments[i].update();
      comments[i].draw();      
    }
    
  }
  
  flash.draw();

  if( flg_clock ){
    fill(255);
    stroke(0);
    strokeWeight(5.0);
    textSize(32);
    text(str(nf(hour(),2))+":"+str(nf(minute(),2)), 70,40);
  }

  if( flg_chime && !sound_chime.isPlaying() ){
    let time_now = str(nf(hour(),2))+":"+str(nf(minute(),2))+":"+str(nf(second(),2));        
    if( (time_start+":00") == time_now ){
      sound_chime.play();
    }
    else if( (time_end+":00" == time_now )){
      sound_chime.play();
    }
  }
  /*
  fill(255);
  textSize(10);
  text((int)(frameRate()),20,20);
  */
  
}

function pushedSendButton()
{
  sendComment(
    document.getElementById("text_comment").value,
    document.getElementById("text_room_name").value,
    false, 0,
    false, 0);
}
function sendComment(_str_comment, _str_room_name, _flg_img, _id_img, _flg_sound, _id_sound)
{
  
  if( _flg_img == false ){
    if( _str_comment.length <= 0 ){
      return;
    }
    if( _str_comment.length > 80 ){
      alert("一度に遅れる文字数は80文字までです．");
      return;
    }
    var data = {
      room_name:_str_room_name,
      comment:_str_comment,
      color_text:color_text,
      color_text_stroke:color_text_stroke,
      flg_image:false,
      id_image:0,
      flg_sound:_flg_sound,
      id_sound:_id_sound
    }
    if( _str_comment.length > 0 ){      
      socket.emit("comment", data);    
    }
    newComment(data);

    
    clearTextBox();
  }
  else{
    var data = {
      room_name:_str_room_name,
      comment:"",
      color_text:color_text,
      color_text_stroke:color_text_stroke,
      flg_image:true,
      id_image:0,
      flg_sound:_flg_sound,
      id_sound:_id_sound
    }
    socket.emit("comment", data);
    newComment(data);
  }
  
}


function keyPressed()
{
  if( key == "Enter"){    
    sendComment(
      document.getElementById("text_comment").value,
      document.getElementById("text_room_name").value,
      false, 0,
      false, 0);
  }
  else{
    
  }
}

function clearTextBox()
{
  document.getElementById("text_comment").value = "";
}

function changeBackgroundColor()
{
  color_background = this.value();
}

function changeRoomName()
{

}

function changeTextColor()
{
  color_text = this.value();  
}

function changeTextOutlineColor()
{
  color_text_stroke = this.value();
}

function windowResized() {
  let rate = 9.0/16.0;

  if( capture ){
    rate = capture.c.height/float(capture.c.width);
    
  }
  else if( capture_screen ){
    rate = capture_screen.c.height/float(capture_screen.c.width);
  }
  else{

  }
  resizeCanvas(windowWidth-30,(windowWidth-30)*rate);
  document.getElementById("screen_size").value = str(int(width))+"x"+str(int(height));
}

function sendImageReaction01()
{
  sendComment(
    document.getElementById("text_comment").value,
    document.getElementById("text_room_name").value,
    true, 0,
    false, 0);
}

function sendEmojiReaction()
{
  sendComment(
    this.html(),
    document.getElementById("text_room_name").value,
    false,0,
    false,0
    );  
}
function sendSoundReaction()
{
  var id_sound = this.attribute("value");
  sendComment(
    this.html(),
    document.getElementById("text_room_name").value,
    false,0,
    true,id_sound
    );  
    if( id_sound == 0 ){ // Camera
      flash.do();
    }
}


function changeVolume()
{
  this.html("test",false);
  volume = this.value();
  if( volume == 0 ){
    //console.log(this);
      }
}

function toggleSoundMute()
{
  flg_sound_mute = !flg_sound_mute;
  if( flg_sound_mute == true ){
    this.html("&#x1f507;");
  }
  else{
    this.html("&#x1f508;");    
  }
}

var flg_camera_is_opened = false;
function toggleCamera()
{
  if( flg_camera_is_opened == false ){
    flg_camera_is_opened = true;

    
    capture = createCameraCapture({
    audio:false,
    video:{
      //deviceId:'5740d2acadab60d7cbd5071039f32d9f0e4881b77ec41732add14a79b2d54f91',
      width:1280,
      height:720,
      //optional: [{ maxFrameRate: 10 }]
    }
    },function(){
        console.log('capture ready');
        capture.c.hide();
    });
    /*
   let constraints = {
         video: {
           mandatory: {
             minWidth: 1280,
             minHeight: 720
           },
           optional: [{ maxFrameRate: 10 }]
         },
         audio: false
       };
   capture = createCameraCapture(VIDEO);
   */
   capture.c.hide();
   this.attribute('class',"btn btn-danger btn-sm");
  }
  else{
    flg_camera_is_opened = false;
    let tracks = capture.element.srcObject.getTracks();
    tracks.forEach(track => track.stop());
    capture.element.srcObject = null;
    capture = null;
    this.attribute('class',"btn btn-outline-secondary btn-sm");
  }
  resizeCanvas(windowWidth-30,(windowWidth-30)*9.0/16.0);
}

function toggleChime()
{
  print(this.checked());
  flg_chime = this.checked();
}

function toggleClock()
{
  flg_clock = this.checked();
}

function updateStartTime()
{
  time_start = this.value();
  var tmp_time = time_start.split(":");
  time_start_hour = int(tmp_time[0]);
  time_start_minute = int(tmp_time[1]);
}

function updateEndTime()
{
  time_end = this.value();
  var tmp = time_end.split(":");
  time_end_hour = int(tmp[0]);
  time_end_minute = int(tmp[1]);
    
}

function toggleScreenCapture()
{
  if( !capture_screen ){
    capture_screen = createScreenCapture(VIDEO);
    capture_screen.c.hide();
    console.log(this.className);
    console.log(this.attribute("class"));
    this.attribute('class',"btn btn-danger btn-sm");
  }
  else{
    let tracks = capture_screen.element.srcObject.getTracks();
    tracks.forEach(track => track.stop());
    capture_screen.element.srcObject = null;
    capture_screen = null;
    this.attribute('class',"btn btn-outline-secondary btn-sm");
  }

  resizeCanvas(windowWidth-30,(windowWidth-30)*10.0/16.0);
}