var socket;

var flg_sound_mute = true;
var comments = []; //new Array(50);
var max_number_of_comment = 100;
class Comment{
  constructor(){
    this.x = random(100);
    this.y = random(100);
    this.text = "test";
    this.alpha = random(100);
    this.life = 1; // 0 - 255
    this.size = 72;
    this.img = [loadImage('assets/logo_shisakunoyaiba.png')];
    this.flg_img = false;
    this.sound = [loadSound('assets/camera-shutter1.mp3'), loadSound('assets/he.wav'),loadSound('assets/chottomatte.wav'),loadSound('assets/OK.wav')];
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
    this.sound[this.id_sound].setVolume(this.volume);
    this.sound[this.id_sound].play();
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
      text(this.text,this.x,this.y);
    }
    else{
      imageMode(CENTER);
      image(this.img[0],this.x, this.y, this.img[0].width*this.alpha/255, this.img[0].height*this.alpha/255);
    }
    return;
  }
}

var color_background;
var color_text;
var color_text_stroke;
var capture;
var volume = 0.1;
function setup() {
  
  var canvas = createCanvas(windowWidth-30, windowHeight/1.5);
  canvas.parent('sketch-holder');
  color_background = document.getElementById("color_background").value;
  color_text = document.getElementById("color_text").value;
  color_text_stroke = document.getElementById("color_text_stroke").value;
  for( var i = 0; i < max_number_of_comment; i++ ){
    comments[i] = new Comment();
    comments[i].setLife(0);
  }
  
  stroke(0);
  strokeWeight(1);
  textAlign(CENTER);
  textSize(32);
  textStyle(BOLD);
  background(100);
  //socket = io.connect('http://125.100.98.172:3000');
  //socket = io.connect('http://localhost:3000');
  socket = io.connect('https://commentable.lolipop.io')
  socket.on('comment', newComment);
  select("#button_send").mouseClicked(sendComment);
  select("#color_background").changed(changeBackgroundColor);
  select("#color_text").changed(changeTextColor);
  select("#color_text_stroke").changed(changeTextOutlineColor);
  select("#button_1280x720").mouseClicked(setCanvas1280x720);
  select("#button_camera").mouseClicked(toggleCamera);
  //select("#button_image_reaction_01").mouseClicked(sendImageReaction01);
  select("#button_emoji_reaction_01").mouseClicked(sendEmojiReaction);
  select("#button_emoji_reaction_02").mouseClicked(sendEmojiReaction);
  select("#button_emoji_reaction_03").mouseClicked(sendEmojiReaction);
  
  select("#button_sound_reaction_00").mouseClicked(sendSoundReaction);
  select("#button_sound_reaction_01").mouseClicked(sendSoundReaction);
  select("#button_sound_reaction_02").mouseClicked(sendSoundReaction);
  select("#button_sound_reaction_03").mouseClicked(sendSoundReaction);
  select("#slider_volume").changed(changeVolume);
  select("#button_sound_mute").mouseClicked(toggleSoundMute);
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

      if( data.flg_sound == true && flg_sound_mute == false){
        comments[id].setVolume(volume);
        comments[id].playSound();
      }
    }
  
    let comment_format = "["+nf(year(),4)+":"+nf(month(),2)+":"+nf(day(),2)+":"+nf(hour(),2)+":"+nf(minute(),2)+":"+nf(second(),2)+"] "+data.comment+"\n";
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
  console.log(data);
}

function draw() {
  //newComment("一般的には一秒間に30コマの静止画がある為，静止画と同じように扱うと，Processingでは処理落ちしてしまいます．");
  background(color_background);
  if(flg_camera_is_opened){
    imageMode(CORNER);
    image(capture, 0,0, width, height);
  }
  
  for( var i = 0; i < max_number_of_comment; i++ ){
    
    if( comments[i].getLife() > 0 ){
      comments[i].update();
      strokeWeight(5.0*comments[i].alpha/255.0);
      stroke(comments[i].color_text_stroke+str(hex(comments[i].alpha,2)));
      fill(comments[i].color_text+str(hex(comments[i].alpha,2)));
      //stroke(color_text_stroke);
      //fill(color_text);
      comments[i].draw();      
    }
    
  }
  /*
  fill(255);
  textSize(10);
  text((int)(frameRate()),20,20);
  */
}

function sendComment(_str_comment, _str_room_name, _flg_img, _id_img, _flg_sound, _id_sound)
{
  if( _flg_img == false ){
    if( _str_comment.length <= 0 ){
      return;
    }
    if( _str_comment.length > 50 ){
      alert("一度に遅れる文字数は50文字までです．");
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
  if( flg_camera_is_opened ){
  //  resizeCanvas(windowWidth-30, windowHeight/1.5);
  }
  resizeCanvas(windowWidth-30,(windowWidth-30)*(9.0/16.0));
}

function setCanvas1280x720()
{
  resizeCanvas(1280,720);
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

  //var id_sound = document.getElementById("button_sound_reaction_00").getAttribute("value");
  var id_sound = this.attribute("value");
  //console.log(this.attribute("value"));
  sendComment(
    this.html(),
    document.getElementById("text_room_name").value,
    false,0,
    true,id_sound
    );  
}

function changeVolume()
{
  console.log(this.value())
  volume = this.value();
  if( volume == 0 ){
    
  }
}

function toggleSoundMute()
{
  flg_sound_mute = !flg_sound_mute;
  if( flg_sound_mute == true ){
    this.html("Sound:OFF");
  }
  else{
    this.html("Sound:ON");    
  }
}

var flg_camera_is_opened = false;
function toggleCamera()
{
  if( flg_camera_is_opened == false ){
    flg_camera_is_opened = true;
    capture = createCapture({
    audio:false,
    video:{
      //deviceId:'5740d2acadab60d7cbd5071039f32d9f0e4881b77ec41732add14a79b2d54f91',
      width:1280,
      height:720,
      //optional: [{ maxFrameRate: 10 }]
    }
    },function(){
        console.log('capture ready');
        capture.hide();
        document.getElementById("button_camera").html("Stop Camera");
    });
    windowResized();
  }
  else{
    flg_camera_is_opened = false;
    capture.stop();
  }
}