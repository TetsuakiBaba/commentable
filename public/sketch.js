var socket;

var comments = []; //new Array(50);
var max_number_of_comment = 500;
class Comment{
  contructor(){
    this.x = random(100);
    this.y = random(100);
    this.text = "test";
    this.alpha = random(100);
    this.life = 1; // 0 - 255
    this.size = 72;
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
  update()
  {
    if( this.life > 0 ){
      this.alpha = this.life;
      this.size = abs((height/20)*sin(0.5*PI*this.life/255.0));
      this.life = this.life - 1;            
    }
    return;
  }
  draw(){
    textSize(this.size);
    text(this.text,this.x,this.y);
    return;
  }
}

var color_background;
var color_text;
var color_text_stroke;
var capture;
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
  
  frameRate(30);
  
}

function newComment(data)
{
  let my_room_name = document.getElementById("text_room_name").value;  
  if( data.room_name != my_room_name ){
    return;
  }
  let id = -1;
  if( data.comment.length > 20 ){
    alert("一度に遅れる文字数は40文字までです．");
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
  }
  
  console.log(data);
}

function draw() {
  //newComment("一般的には一秒間に30コマの静止画がある為，静止画と同じように扱うと，Processingでは処理落ちしてしまいます．");
  background(color_background);
  if(capture){
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

function sendComment()
{
  let str_comment = document.getElementById("text_comment").value;
  let str_room_name = document.getElementById("text_room_name").value;
  var data = {
    room_name:str_room_name,
    comment:str_comment,
    color_text:color_text,
    color_text_stroke:color_text_stroke
  }
  if( str_comment.length > 0 ){
    socket.emit("comment", data);
  }
  newComment(data);
  clearTextBox();
}


function keyPressed()
{
  if( key == "Enter"){
    sendComment();
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
  resizeCanvas(windowWidth-30, windowHeight/1.5);
}

function setCanvas1280x720()
{
  resizeCanvas(1280,720);
  }

function toggleCamera()
{
  if( !capture ){
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
    });  
  }
  else{
  }
}