class GlitchLine {
    constructor() {
        this.randomSet();
    }
    randomSet() {
        this.x = random(-width, width);
        this.y = random(height);
        this.w = random(width);
        this.h = random(50);
        this.noise_y = random(100);
        this.r = random(255);
        this.g = random(255);
        this.b = random(255);
    }
    draw() {
        strokeCap(SQUARE);
        strokeWeight(this.h);
        stroke(this.r, this.g, this.b);
        stroke(0);
        line(this.x, this.y + noise(this.noise_y) * 5,
            this.x + this.w, this.y + noise(this.noise_y) * 5);
        //    this.noise_y += 10.1;

        if (parseInt(random(5)) == 0) {
            this.randomSet();
        }
    }
}

class GlitchLines {
    constructor() {
        this.glitch_lines = [];
        for (let i = 0; i < 10; i++) {
            this.glitch_lines.push(new GlitchLine());
        }
    }
    draw() {
        for (let line of this.glitch_lines) {
            line.draw();
        }
    }

}