// カメラ効果音（id_sound == 0）のときに画面を白く光らせる
class Flash {
  constructor() {
    this.alpha = 0;
    this.status = false;
  }
  do() {
    this.status = true;
    this.alpha = 55;
  }
  draw() {
    if (this.status) {
      noStroke();
      fill(255, this.alpha);
      rect(0, 0, width, height);
      this.alpha = this.alpha * 0.85;
      if (this.alpha < 1.0) {
        this.status = false;
      }
    }
  }
}
