var number_of_viewers = 0;
const peerConnections = {};
const config = {
  iceServers: [
    {
      urls: ["stun:stun.l.google.com:19302"]
    }
  ]
};

var is_streaming = false;
function toggleBroadcasting() {
  if (is_streaming) {
    getStream();
    number_of_viewers = 0;
    document.getElementById('text_number_of_joined').value = str(number_of_viewers);
    document.getElementById("button_toggle").innerHTML = "📺Start";
    select("#button_toggle").style("background-color", "transparent");
    is_streaming = false;
    socket.emit("stop streaming");
  }
  else {

    socket.emit("broadcaster");
    this.html("📺Stop");
    print("stop Stream()");
    select("#button_toggle").style("background-color", "red");
    is_streaming = true;
  }

}
function setup() {
  select("#button_toggle").mouseClicked(toggleBroadcasting);
  select("#camera_width").changed(getStream);
  select("#camera_height").changed(getStream);
  select("#camera_framerate").changed(getStream);
  noCanvas();
}


const socket = io.connect(window.location.origin);

socket.on("answer", (id, description) => {
  peerConnections[id].setRemoteDescription(description);
});

// Whenever the server emits 'user joined', log it in the chat body
socket.on('user joined', (data) => {
  log(data.username + ' joined');
  console.log(data);

  //  document.getElementById('text_number_of_joined').value = str(data.numUsers);
});

socket.on("watcher", (id, numUsers) => {
  if (is_streaming == false) {
    return;
  }
  number_of_viewers++;
  document.getElementById('text_number_of_joined').value = str(number_of_viewers);

  const peerConnection = new RTCPeerConnection(config);
  peerConnections[id] = peerConnection;

  let stream = videoElement.srcObject;
  stream.getTracks().forEach(track => peerConnection.addTrack(track, stream));

  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      socket.emit("candidate", id, event.candidate);
    }
  };

  peerConnection
    .createOffer()
    .then(sdp => peerConnection.setLocalDescription(sdp))
    .then(() => {
      socket.emit("offer", id, peerConnection.localDescription);
    });
});

socket.on("candidate", (id, candidate) => {
  peerConnections[id].addIceCandidate(new RTCIceCandidate(candidate));
});

socket.on("disconnectPeer", (id, numUsers) => {
  if (is_streaming == false) {
    return;
  }
  number_of_viewers--;
  document.getElementById('text_number_of_joined').value = str(number_of_viewers);
  peerConnections[id].close();
  delete peerConnections[id];
});

window.onunload = window.onbeforeunload = () => {
  socket.close();
};

// Get camera and microphone
const videoElement = document.querySelector("video");
const audioSelect = document.querySelector("select#audioSource");
const videoSelect = document.querySelector("select#videoSource");

audioSelect.onchange = getStream;
videoSelect.onchange = getStream;

getStream()
  .then(getDevices)
  .then(gotDevices);

function getDevices() {
  return navigator.mediaDevices.enumerateDevices();
}

function gotDevices(deviceInfos) {
  window.deviceInfos = deviceInfos;
  for (const deviceInfo of deviceInfos) {
    const option = document.createElement("option");
    option.value = deviceInfo.deviceId;
    if (deviceInfo.kind === "audioinput") {
      option.text = deviceInfo.label || `Microphone ${audioSelect.length + 1}`;
      audioSelect.appendChild(option);
    } else if (deviceInfo.kind === "videoinput") {
      option.text = deviceInfo.label || `Camera ${videoSelect.length + 1}`;
      videoSelect.appendChild(option);
    }
  }
}

function getStream() {
  number_of_viewers = 0;
  if (window.stream) {
    window.stream.getTracks().forEach(track => {
      track.stop();
    });
  }
  document.getElementById("button_toggle").innerHTML = "📺Start";
  document.getElementById("button_toggle").style.background = "transparent";
  is_streaming = false;

  const audioSource = audioSelect.value;
  const videoSource = videoSelect.value;
  const cameraWidth = document.getElementById("camera_width").value;
  const cameraHeight = document.getElementById("camera_height").value;
  const camera_framerate = document.getElementById("camera_framerate").value;
  const constraints = {
    audio: { deviceId: audioSource ? { exact: audioSource } : undefined },
    video: {
      deviceId: videoSource ? { exact: videoSource } : undefined,
      width: { max: cameraWidth }, height: { max: cameraHeight }, frameRate: { max: camera_framerate }
    }
  };
  return navigator.mediaDevices
    .getUserMedia(constraints)
    .then(gotStream)
    .catch(handleError);
}

function gotStream(stream) {
  window.stream = stream;
  audioSelect.selectedIndex = [...audioSelect.options].findIndex(
    option => option.text === stream.getAudioTracks()[0].label
  );
  videoSelect.selectedIndex = [...videoSelect.options].findIndex(
    option => option.text === stream.getVideoTracks()[0].label
  );
  videoElement.srcObject = stream;
  is_streaming = false;
  //socket.emit("broadcaster");
}

function handleError(error) {
  console.error("Error: ", error);
}



