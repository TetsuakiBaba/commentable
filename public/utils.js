/* global is_streaming, number_of_viewers */

function downloadAllComments() {
  // textareaに表示されているテキストをそのままダウンロード
  const textarea = document.getElementById('textarea_comment_history');
  if (!textarea || !textarea.value) {
    alert('ダウンロードするコメントがありません');
    return;
  }

  const txt = textarea.value;

  // 文字列をBlob化
  const blob = new Blob([txt], { type: 'text/plain' });

  // ダウンロード用のaタグ生成
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);

  // ファイル名にルーム名を含める
  const roomName = window.currentRoom || 'comments';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  a.download = `${roomName}_${timestamp}.txt`;
  a.click();
}

async function syncCommentsFromServer(showAlert = true) {
  try {
    // ルーム名を取得（グローバル変数 currentRoom を使用）
    const roomName = window.currentRoom || currentRoom;

    if (!roomName) {
      if (showAlert) {
        alert('部屋に接続されていません。先に部屋に参加してください。');
      }
      return;
    }

    // ファイル名として安全な文字列に変換（サーバー側と同じロジック）
    const safeRoomName = roomName.replace(/[^a-zA-Z0-9_-]/g, '_');

    // サーバーからチャットログを取得（静的ファイルとして直接アクセス）
    const response = await fetch(`/chatlogs/${safeRoomName}.log`);

    if (!response.ok) {
      if (response.status === 404) {
        if (showAlert) {
          alert('まだこの部屋のログはありません。');
        }
        return;
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const logContent = await response.text();

    // JSON Lines形式をパースして、CommentApp.state.allHistoryに保存
    const lines = logContent.trim().split('\n').filter(line => line.length > 0);

    if (window.CommentApp) {
      // state.allHistoryとstate.allHistoryJSONをクリアして、サーバーから取得したログで置き換え
      window.CommentApp.state.allHistory = [];
      window.CommentApp.state.allHistoryJSON = [];

      lines.forEach((line, index) => {
        try {
          // 空行や不正な行をスキップ
          const trimmedLine = line.trim();
          if (!trimmedLine || !trimmedLine.startsWith('{')) {
            return;
          }

          const entry = JSON.parse(trimmedLine);

          // JSON形式データを保存（ダウンロード用）
          window.CommentApp.state.allHistoryJSON.push(entry);

          const timestamp = new Date(entry.timestamp).toLocaleString('ja-JP');
          const emoji = entry.emoji ? '[emoji]' : '';
          const sound = entry.sound ? '[sound]' : '';
          // CommentApp.formatTimestampと同じ形式に合わせる
          const formattedLine = `[${timestamp}] ${entry.comment}${emoji}${sound}[${entry.username}]\n`;
          window.CommentApp.state.allHistory.push(formattedLine);
        } catch (e) {
          debugError(`Skipping invalid log entry at line ${index + 1}:`, line.substring(0, 100), e.message);
        }
      });

      // 全体を再計算してランキングを更新（同期時のみ）
      window.CommentApp.calculateTop10();

      // 表示を更新
      window.CommentApp.updateHistoryDisplay();

      debugLog(`Synced ${lines.length} comments from server`);
    } else {
      debugError('CommentApp is not available');
    }

  } catch (error) {
    debugError('Error syncing comments:', error);
    if (showAlert) {
      alert('サーバーからコメントの同期に失敗しました。');
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
