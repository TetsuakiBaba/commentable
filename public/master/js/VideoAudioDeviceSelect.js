

function attachVideoDevicesToSelect(_id) {
    //navigator.mediaDevices.enumerateDevices().then(gotDevices);
    navigator.mediaDevices.enumerateDevices()
        .then(function (deviceInfos) {
            const videoSelect = document.querySelector(_id);
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
        );
}



function attachAudioDevicesToSelect(_id) {
    //navigator.mediaDevices.enumerateDevices().then(gotDevices);
    navigator.mediaDevices.enumerateDevices()
        .then(function (deviceInfos) {
            const audioSelect = document.querySelector(_id);
            window.deviceInfos = deviceInfos;
            for (const deviceInfo of deviceInfos) {
                const option = document.createElement("option");
                option.value = deviceInfo.deviceId;
                if (deviceInfo.kind === "audioinput") {
                    option.text = deviceInfo.label || `Audio ${audioSelect.length + 1}`;
                    audioSelect.appendChild(option);
                }
            }
        }
        );
}
