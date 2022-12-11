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

class Move {
  constructor(width, height, frame) {
    this.width = width;   // 画面の横幅
    this.height = height;  // 画面の縦幅
    this.delta_x = width / frame; // 1フレームあたりの移動量
    this.delta_y = height / frame; // 1フレームあたりの移動量
    this.progress = 0; // 進捗（0〜1）
  }

  getProgress() {
    return this.progress;
  }

  // 横への移動量を計算：→　左から右へ
  moveXPlus(x) {
    return this.delta_x + x;
  }

  // 横への移動量を計算：←　右から左へ
  moveXMinus(x) {
    return x - this.delta_x;
  }

  // 縦への移動量を計算：↓　上から下へ
  moveYPuls(y) {
    return this.delta_y + y;
  }

  // 縦への移動量を計算：↑　下から上へ
  moveYMinus(y) {
    return y - this.delta_y;
  }
}
