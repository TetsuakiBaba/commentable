function downloadAllComments() {
  // テキストエリアより文字列を取得
  const txt = document.getElementById('textarea_comment_history').value;
  if (!txt) { return; }

  // 文字列をBlob化
  const blob = new Blob([txt], { type: 'text/plain' });

  // ダウンロード用のaタグ生成
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = ('comments.txt');
  a.click();
};

class Flash {
  constructor() {
    this.alpha = 0;
    this.status = false;
  }
  do() {
    this.status = true;
    this.alpha = 100;
  }
  draw() {
    if (this.status) {
      noStroke();
      fill(255, this.alpha);
      rect(0, 0, width, height);
      this.alpha = this.alpha / 10.0;
      if (this.alpha < 1.0) {
        this.status = false;
      }
    }
  }
}



function getDevices() {
  return navigator.mediaDevices.enumerateDevices();
}

function gotDevices(deviceInfos) {
  window.deviceInfos = deviceInfos;
  for (const deviceInfo of deviceInfos) {
    const option = document.createElement("option");
    option.value = deviceInfo.deviceId;
    if (deviceInfo.kind === "videoinput") {
      option.text = deviceInfo.label || `Camera ${videoSelect.length + 1}`;
      videoSelect.appendChild(option);
    }
  }
}

const videoSelect = document.querySelector("select#videoSource");
//audioSelect.onchange = getStream;
//videoSelect.onchange = getStream;

function getStream() {

  number_of_viewers = 0;
  if (window.stream) {
    window.stream.getTracks().forEach(track => {
      track.stop();
    });
  }
  is_streaming = false;

  const videoSource = videoSelect.value;
  const constraints = {
    audio: false,
    video: {
      deviceId: videoSource ? { exact: videoSource } : undefined,
      width: { max: 1280 }, height: { max: 720 }, frameRate: { max: 30 }
    }
  };

  return navigator.mediaDevices
    .getUserMedia(constraints)
    .then(gotStream)
    .catch(handleError);

}

function gotStream(stream) {

  window.stream = stream;
  videoSelect.selectedIndex = [...videoSelect.options].findIndex(
    option => option.text === stream.getVideoTracks()[0].label
  );
  //videoElement.srcObject = stream;
  is_streaming = false;
  //socket.emit("broadcaster");
}

function handleError(error) {
  console.error("Error: ", error);
}
