const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
    setVolume: (value) => ipcRenderer.send('set-volume', value),
    // カメラ設定を保存
    saveCameraSetting: (deviceId) => ipcRenderer.invoke('save-camera-setting', deviceId),
    // カメラ設定を取得
    getCameraSetting: () => ipcRenderer.invoke('get-camera-setting'),
    // カメラを選択（デバイスIDを送信）
    onSelectCamera: (callback) => ipcRenderer.on('select-camera', callback),
    // カメラを停止
    onStopCamera: (callback) => ipcRenderer.on('stop-camera', callback),
    // カメラON/OFF状態を受信
    onToggleCamera: (callback) => ipcRenderer.on('toggle-camera', callback),
    // ウィンドウリサイズイベントを受信
    onWindowResized: (callback) => ipcRenderer.on('window-resized', callback),
    // メインプロセスのコンソールに出力
    log: (...args) => ipcRenderer.send('console-log', ...args),
    warn: (...args) => ipcRenderer.send('console-warn', ...args),
    error: (...args) => ipcRenderer.send('console-error', ...args)
})


window.addEventListener('DOMContentLoaded', () => {
    const replaceText = (selector, text) => {
        const element = document.getElementById(selector)
        if (element) element.innerText = text
    }

    for (const type of ['chrome', 'node', 'electron']) {
        replaceText(`${type}-version`, process.versions[type])
    }
})

