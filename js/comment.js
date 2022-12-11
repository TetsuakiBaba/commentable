class Comment {
  constructor() {
    this.x = random(100);
    this.y = random(100);
    this.text = "test";
    this.alpha = random(100);
    this.life = 1; // 0 - 255
    this.size = 72.0;
    this.flg_img = false;
    this.volume = 0.1;
  }

  setColor(_color_text, _color_text_stroke) {
    this.color_text = _color_text;
    this.color_text_stroke = _color_text_stroke;
  }

  setLife(_life) {
    this.life = _life;
  }

  getLife() {
    return this.life;
  }

  setText(_text) {
    this.text = _text;
    return;
  }

  setX(_x) {
    this.x = _x;
  }

  setY(_y) {
    this.y = _y;
  }

  useImage(_id) {
    this.flg_img = true;
  }

  setVolume(_volume) {
    this.volume = _volume;
  }

  playSound() {
    if (sound[this.id_sound].length > 1) {
      let number = int(random(sound[this.id_sound].length));
      sound[this.id_sound][number].setVolume(this.volume);
      sound[this.id_sound][number].play();
    } else {
      sound[this.id_sound].setVolume(this.volume);
      sound[this.id_sound].play();
    }
  }

  update() {
    if (this.life > 0) {
      this.alpha = this.life;
      this.size = abs((height / 20) * sin(0.5 * PI * this.life / 255.0));
      this.life = this.life - 1; // 0 - 255
      if (this.life == 0) {
        this.flg_img = false;
      }
    }
    return;
  }

  draw() {
    if (this.flg_img == false) {
      textSize(this.size);
      strokeWeight(5.0 * this.alpha / 255.0);
      stroke(this.color_text_stroke + str(hex(this.alpha, 2)));
      fill(this.color_text + str(hex(this.alpha, 2)));
      text(this.text, this.x, this.y);
    } else {
      //imageMode(CENTER);
      //image(this.img[0],this.x, this.y, this.img[0].width*this.alpha/255, this.img[0].height*this.alpha/255);
    }
    return;
  }
}
