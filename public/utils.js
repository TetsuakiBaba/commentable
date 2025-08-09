/* global is_streaming, number_of_viewers */

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

  window.number_of_viewers = 0;
  if (window.stream) {
    window.stream.getTracks().forEach(track => {
      track.stop();
    });
  }
  window.is_streaming = false;

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
  window.is_streaming = false;
  //socket.emit("broadcaster");
}


function handleError(error) {
  console.error("Error: ", error);
}

// ---- Minimal former p5compat helpers (only those still possibly referenced) ----
// Provided for legacy calls that might remain in other modules; safe no-op implementations.
(function () {
  if (!window.millis) {
    const __millisStart = performance.now();
    window.millis = () => performance.now() - __millisStart;
  }
  if (!window.nf) {
    window.nf = function (num, digits) {
      const n = parseInt(num, 10);
      return String(isNaN(n) ? 0 : n).padStart(digits, '0');
    };
  }
  // Date/time helpers (guard to avoid overwriting if already defined elsewhere)
  ['year', 'month', 'day', 'hour', 'minute', 'second'].forEach(fn => {
    if (window[fn]) return;
    switch (fn) {
      case 'year': window.year = () => new Date().getFullYear(); break;
      case 'month': window.month = () => new Date().getMonth() + 1; break;
      case 'day': window.day = () => new Date().getDate(); break;
      case 'hour': window.hour = () => new Date().getHours(); break;
      case 'minute': window.minute = () => new Date().getMinutes(); break;
      case 'second': window.second = () => new Date().getSeconds(); break;
    }
  });
  if (!window.int) window.int = v => parseInt(v, 10);
  if (!window.str) window.str = v => String(v);
  if (!window.getURLParams) window.getURLParams = function () {
    const params = {}; const usp = new URLSearchParams(window.location.search); usp.forEach((v, k) => params[k] = v); return params;
  };
  // Legacy no-ops
  if (!window.noCanvas) window.noCanvas = function () { };
  if (!window.textFont) window.textFont = function () { };
  if (!window.resizeCanvas) window.resizeCanvas = function () { };
})();
