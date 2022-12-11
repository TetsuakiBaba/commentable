// アニメーション用のクラス
class Position {
  constructor() {
    this.x = 0;
    this.y = 0;
  }

  setPosition(x, y) {
    this.x = x;
    this.y = y;
  }

  getPosition() {
    return [this.x, this.y];
  }
}

class Animetion {
  constructor(fps) {
    this.position = Position(); // 現在の位置
    this.size = height / 20; // 現在のサイズ
    this.time = 5000;  // 移動にかかるトータル時間(ms)
    this.frame = fps * this.time / 1000; // 移動にかかるフレーム数
  }

  setSize(size) {
    this.size = size;
  }

  setPosition(x, y) {
    this.position.setPosition(x, y);
  }

  getPosition() {
    return this.position.getPosition();
  }

  print() {
    console.log(this.position.getPosition());
  }
}
