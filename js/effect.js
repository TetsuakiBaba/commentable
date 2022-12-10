class ProtofessionalEffect {
  constructor() {
    this.is_activating = false;
    this.effect_duration = 7000;
    this.sound = loadSound('./sounds/protofessional.mp3');
    this.volume = 0.5;
  }
  activate() {
    this.is_activating = true;
    this.timestamp = millis();
    if (flg_sound_mute == false) {
      this.sound.setVolume(this.volume);
      this.sound.play();
    }
  }
  setVolume(_volume) {
    this.volume = _volume;
  }
  setText(_interview_message) {
    this.interview_message = _interview_message;
  }
  draw() {
    if (this.is_activating == true &&
      (millis() - this.timestamp) < this.effect_duration) {
      let alpha = 255 * cos(radians(90 * (millis() - this.timestamp) / this.effect_duration));
      background(0, 0, 0, alpha);
      noStroke();
      fill(255, 255, 255, alpha);
      textSize(height / 20);
      textAlign(CENTER, CENTER);
      text(this.interview_message, width / 2, height / 2);

    } else {
      this.is_activating = false;
    }
  }
}
