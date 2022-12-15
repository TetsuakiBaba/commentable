class Comment {
  constructor() {
    this.x = random(100);
    this.y = random(100);
    this.text = "test";
    this.alpha = 0;
    this.life = 1; // 0 - 255
    this.size = 72.0;
    this.flg_img = false;
    this.flg_emoji = false;
    this.volume = 0.1;
  }

  // Emoji -> true
  // Text -> false
  getFlgEmoji() {
    return this.flg_emoji;
  }

  setFlgEmoji(_flg_emoji) {
    this.flg_emoji = _flg_emoji;
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

  update(_FRAME) {
    if (this.life > 0) {
      if (this.flg_emoji) {
        // 絵文字の場合の移動
        // this.alpha = this.life;
        // this.size = abs((height / 20) * sin(0.5 * PI * this.life / _FRAME));
        this.life--; // 0 - 255
        this.y = this.y - 2;
        this.x = this.x + sin(PI * this.y * 8);
        // if (this.lift > _FRAME * 0.6) {
        // this.lift = 0;
        // }

        if (this.life == 0) {
          this.flg_img = false;
        }
      } else {
        // テキストの場合の移動
        // this.alpha = this.life;
        this.size = abs((height / 20) * sin(0.5 * PI * this.life / _FRAME));
        this.life--; // 0 - 255
        if (this.life == 0) {
          this.flg_img = false;
        }

      }
    }
    return;
  }

  draw(_FRAME) {
    if (this.flg_img == false) {
      textSize(this.size);
      strokeWeight(600.0 / _FRAME);
      stroke(this.color_text_stroke);
      fill(this.color_text);
      text(this.text, this.x, this.y);
    }
    return;
  }

  reset() {
    this.x = random(100);
    this.y = random(100);
    this.text = "test";
    this.alpha = 0;
    this.life = 1; // 0 - 255
    this.size = 72.0;
    this.flg_img = false;
    this.volume = 0.1;
    return;
  }
}
