const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
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
    // カメラフレーム（RGBA）から人物マスクを取得
    segmentPerson: (data, width, height) => ipcRenderer.invoke('segment-person', { data, width, height }),
    // アンケート（メインウィンドウ側：サーバーとの中継）
    onSurveyStart: (callback) => ipcRenderer.on('survey-start', callback),
    onSurveyEnd: (callback) => ipcRenderer.on('survey-end', callback),
    sendSurveyAnswer: (data) => ipcRenderer.send('survey-answer', data),
    // アンケート（作成・集計ウィンドウ側）
    startSurvey: (survey) => ipcRenderer.invoke('survey-start', survey),
    endSurvey: () => ipcRenderer.invoke('survey-end'),
    getSurveyState: () => ipcRenderer.invoke('survey-get-state'),
    onSurveyUpdate: (callback) => ipcRenderer.on('survey-update', callback),
    // 配信画面としての入室を断られたことをメインプロセスに知らせる
    notifyJoinRejected: (reason) => ipcRenderer.send('join-rejected', reason),
    // 授業ログをこの Mac に保存
    archiveLogEvents: (events) => ipcRenderer.send('archive-log-events', events),
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

