class P5Captures {
    constructor() { }
    openCamera() {
        this.camera = createCameraCapture({
            audio: false,
            video: {
                //deviceId:'5740d2acadab60d7cbd5071039f32d9f0e4881b77ec41732add14a79b2d54f91',
                width: 1280,
                height: 720,
                //optional: [{ maxFrameRate: 10 }]
            }
        }, function () {
            console.log('capture ready');
        });
        this.camera.c.hide();
    }
    // capture = createCameraCapture(VIDEO);
    closeCamera() {
        let tracks = this.camera.element.srcObject.getTracks();
        tracks.forEach(track => track.stop());
        this.camera.element.srcObject = null;
        this.camera = null;
    }
    drawCamera(_x, _y, _w, _h) {
        imageMode(CORNER);
        image(this.camera.c, _x, _y, _w, _h);
    }


    openScreen() {
        if (this.screen = createScreenCapture(VIDEO)) {
            console.log("hello");
        }
        else {
            console.log("else");
        }

        this.screen.c.hide();
    }
    drawScreen(_x, _y, _w, _h) {
        if (this.screen.c.loadedmetadata) {
            imageMode(CORNER);
            image(this.screen.c, _x, _y, _w, _h);
        }
    }
    closeScreen() {
        if (this.screen.c.loadedmetadata) {
            let tracks = this.screen.element.srcObject.getTracks();
            tracks.forEach(track => track.stop());
        }
        this.screen.element.srcObject = null;
        this.screen = null;


    }

}
