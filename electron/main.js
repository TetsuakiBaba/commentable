require('update-electron-app')()

const { app, BrowserWindow, Menu, Tray, screen, MenuItem, shell, clipboard, globalShortcut } = require('electron')
const { ipcMain } = require('electron');
const fs = require('fs');

const prompt = require('electron-prompt');

const packageJson = require('./package.json');
const version = packageJson.version;
const copyrightYear = packageJson.year;

const is_windows = process.platform === 'win32'
const is_mac = process.platform === 'darwin'
const is_linux = process.platform === 'linux'

const path = require('path');

// グローバルエラーハンドリング - サンドボックス関連のエラーを無視
process.on('uncaughtException', (error) => {
    // サンドボックス関連のエラーは無視
    if (error.message && error.message.includes('sandbox')) {
        console.log('Sandbox warning (ignored):', error.message);
        return;
    }
    console.error('Uncaught Exception:', error);
});

// サーバー切り替えフラグ（true: ローカル開発, false: 本番環境）
const USE_LOCAL_SERVER = false;
// const USE_LOCAL_SERVER = true;

// デバッグモードフラグ（true: DevTools表示 + マウス操作可能, false: DevTools非表示 + マウス操作不可）
const DEBUG_MODE = false;

// ベースURL設定
function getBaseUrl() {
    if (USE_LOCAL_SERVER) {
        console.log('Using local development server');
        return 'http://localhost:3000';
    } else {
        console.log('Using production server');
        // return 'https://bbcommentable.herokuapp.com';
        return 'https://commentable.onrender.com';
    }
}

// 現在のベースURL（手動切り替え可能）
let currentBaseUrl = getBaseUrl();
console.log(`Commentable will use server: ${currentBaseUrl}`);

// サーバーURL切り替え関数
function switchServerUrl(newUrl) {
    currentBaseUrl = newUrl;
    console.log(`Server URL switched to: ${currentBaseUrl}`);
}

var admin_message = "15:00から再開します";
var win;
var contextMenu; // グローバル変数として定義
var g_room; // 部屋名をグローバルに保存
var tray; // trayをグローバルに保存
var cameraEnabled = false; // カメラのON/OFF状態

const settingsPath = path.join(app.getPath('userData'), 'camera-settings.json');

// カメラ設定を保存
function saveCameraSettings(settings) {
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        console.log('Camera settings saved:', settings);
    } catch (error) {
        console.error('Error saving camera settings:', error);
    }
}

// カメラ位置を保存
function saveCameraPosition(position) {
    const settings = loadCameraSettings();
    settings.position = position;
    saveCameraSettings(settings);
}

// カメラサイズを保存
function saveCameraSize(size) {
    const settings = loadCameraSettings();
    settings.size = size;
    saveCameraSettings(settings);
}

// カメラ設定を読み込み
function loadCameraSettings() {
    try {
        if (fs.existsSync(settingsPath)) {
            const data = fs.readFileSync(settingsPath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading camera settings:', error);
    }
    return {
        deviceId: null,
        enabled: false,
        position: 'top-right',
        size: 'small'
    };
}

// カメラON/OFF切り替え
function toggleCamera(enabled) {
    console.log('Toggle camera:', enabled);

    if (enabled) {
        const settings = loadCameraSettings();
        if (settings.deviceId) {
            // 保存されたカメラデバイスIDで起動
            win.webContents.send('select-camera', settings.deviceId);

            // 保存された位置とサイズを適用
            if (settings.position) {
                win.webContents.executeJavaScript(`setCameraPosition('${settings.position}');`)
                    .catch(console.error);
            }
            if (settings.size) {
                win.webContents.executeJavaScript(`setCameraSize('${settings.size}');`)
                    .catch(console.error);
            }
        } else {
            // デバイスIDがない場合は設定画面を開く
            openCameraSettings();
        }
    } else {
        // カメラを停止
        win.webContents.send('stop-camera');
    }
}

// カメラ設定ウィンドウを開く
function openCameraSettings() {
    const mainWindowSize = win.getSize();
    const mainWindowPos = win.getPosition();

    const settingsWindowWidth = 600;
    const settingsWindowHeight = 500;

    const settingsWindowPosX = mainWindowPos[0] + (mainWindowSize[0] - settingsWindowWidth) / 2;
    const settingsWindowPosY = mainWindowPos[1] + (mainWindowSize[1] - settingsWindowHeight) / 2;

    const settingsWindow = new BrowserWindow({
        title: "カメラ設定",
        width: settingsWindowWidth,
        height: settingsWindowHeight,
        x: settingsWindowPosX,
        y: settingsWindowPosY,
        hasShadow: true,
        alwaysOnTop: true,
        resizable: false,
        frame: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    settingsWindow.loadFile(path.join(__dirname, 'camera-settings.html'));

    // 設定ウィンドウが閉じられた時の処理
    settingsWindow.on('closed', () => {
        console.log('Camera settings window closed');
        // カメラがONの場合、設定を再読み込みして適用
        if (cameraEnabled) {
            const settings = loadCameraSettings();
            if (settings.deviceId) {
                win.webContents.send('select-camera', settings.deviceId);
            }
        }
    });
}

function createWindow() {

    console.log(screen.getAllDisplays());
    //let active_screen = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    let active_screen = screen.getPrimaryDisplay();
    console.log("active_screen", active_screen);
    let { width, height } = active_screen.workAreaSize
    const x = active_screen.workArea.x;
    const y = active_screen.workArea.y;
    //width = 1200;
    //height = 800;
    //console.log(x, y);
    win = new BrowserWindow({
        title: "commentable-desktop",
        width: width,
        height: height,
        x: x,
        y: y,
        // nodeIntegration: false,
        // contextIsolation: true,
        hasShadow: false,
        transparent: true,
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        //focusable: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: process.env.NODE_ENV === 'production' // 開発環境ではwebSecurityを無効化
        }
    })

    // レンダラープロセスのエラーを抑制（サンドボックス関連）
    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
        // サンドボックス関連のエラーは無視
        if (message.includes('sandbox') || message.includes('Script failed to execute')) {
            return;
        }
        // カメラ関連のログは表示
        if (message.includes('camera') || message.includes('Camera') ||
            message.includes('MediaPipe') || message.includes('Segmentation')) {
            console.log(`[Renderer] ${message}`);
        }
    });

    // クラッシュハンドリング
    win.webContents.on('render-process-gone', (event, details) => {
        console.log('Render process gone:', details);
    });

    // デバッグモードのログ出力
    if (DEBUG_MODE) {
        console.log('DEBUG_MODE: DevTools will open after page load, mouse events enabled');
    } else {
        console.log('DEBUG_MODE: DevTools disabled, mouse events disabled');
    }

}



function capFirst(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min)) + min;
}

function generateName() {
    var name1 = ["computer", "design", "art", "human", "410", "interface", "tmu"];
    var name2 = ["room", "class", "conference", "event", "area", "place"];
    var name = capFirst(name1[getRandomInt(0, name1.length)]) + '_' + capFirst(name2[getRandomInt(0, name2.length)]);
    return name;
}

// In main process.
// trayとg_roomはグローバルで既に宣言済み

// IPCハンドラーを設定
ipcMain.handle('save-camera-setting', async (event, deviceId) => {
    const settings = { deviceId, enabled: cameraEnabled };
    saveCameraSettings(settings);
    return true;
});

ipcMain.handle('get-camera-setting', async () => {
    const settings = loadCameraSettings();
    return settings.deviceId;
});

app.whenReady().then(() => {

    // 開発環境では証明書エラーを無視（SSL/TLSエラー回避）
    if (process.defaultApp ||
        /[\\/]electron[\\/]/.test(process.execPath) ||
        process.env.NODE_ENV === 'development') {
        console.log('Development mode: Ignoring certificate errors');
        app.commandLine.appendSwitch('--ignore-certificate-errors');
        app.commandLine.appendSwitch('--ignore-ssl-errors');
        app.commandLine.appendSwitch('--allow-running-insecure-content');
    }

    // macOS特有のInput Methodエラーを抑制
    if (is_mac) {
        app.commandLine.appendSwitch('--disable-features', 'IOSurfaceCapturer');
    }

    if (process.platform === 'darwin') {
        app.dock.hide();
    }

    createWindow()

    let menu = Menu.buildFromTemplate(
        [
            {
                label: app.name,
                submenu: [
                    { role: 'quit', label: `${app.name} を終了` }
                ]
            }
        ]);
    Menu.setApplicationMenu(menu);

    // グローバルショートカットの登録
    const ret = globalShortcut.register('Alt+CommandOrControl+V', () => {
        // console.log('Shift+CommandOrControl+V is pressed');
        sendClipText2CodeSnippet();
    });
    if (!ret) {
        console.log('registration failed');
    }
    // ショートカットが登録されているか確認
    console.log(globalShortcut.isRegistered('Alt+CommandOrControl+V'));


    prompt({
        title: 'Commentable',
        alwaysOnTop: true,
        label: '部屋名を入力して入室してください',
        value: generateName(),
        menuBarVisible: true,
        buttonLabels: {
            ok: '入室',
            cancel: 'やめる'
        },
        inputAttrs: {
            type: 'text',
            required: true
        },
        type: 'input',
        //resizable: true,
        customStylesheet: path.join(__dirname, '/css/prompt.css')
    })
        .then((r) => {
            //win.setAlwaysOnTop(true, 'floating');
            win.setVisibleOnAllWorkspaces(true, {
                visibleOnFullScreen: true
            });
            win.setFullScreenable(false);
            win.setAlwaysOnTop(true, "screen-saver")

            // デバッグモードでない場合はマウスイベントを無視
            if (!DEBUG_MODE) {
                win.setIgnoreMouseEvents(true);
            }

            //win.webContents.openDevTools();
            win.loadFile('index.html')

            var room = "";
            if (r === null) {
                console.log('user cancelled');
                room = "";
                app.quit();
            } else {
                console.log('result', r);
                room = r;
            }
            g_room = room;
            if (is_windows) tray = new Tray(`${__dirname}/images/icon.ico`);
            else if (is_mac) tray = new Tray(`${__dirname}/images/icon.png`);

            win.webContents.executeJavaScript(`setVersion("${version}");`, true)
                .then(result => {

                }).catch(console.error)

            // サーバーURLをレンダラープロセスに渡す
            win.webContents.executeJavaScript(`window.SOCKET_SERVER_URL = "${currentBaseUrl}";`, true)
                .then(result => {
                    console.log('Server URL set in renderer process:', currentBaseUrl);
                }).catch(console.error)

            // 部屋名をレンダラープロセスに渡す
            win.webContents.executeJavaScript(`window.ROOM_NAME = "${room}";`, true)
                .then(result => {
                    console.log('Room name set in renderer process:', room);
                }).catch(console.error)

            // 保存された設定を読み込む
            const savedSettings = loadCameraSettings();
            const savedPosition = savedSettings.position || 'top-right';
            const savedSize = savedSettings.size || 'small';

            contextMenu = Menu.buildFromTemplate([
                {
                    label: "投稿ページを開く", click: async () => {
                        try {
                            const { shell } = require('electron')
                            await shell.openExternal(`${currentBaseUrl}/?room=${g_room}&v=${version}`);
                        } catch (error) {
                            console.error('Error opening post page:', error);
                        }
                    }
                },
                {
                    label: '投稿ページURLをコピー',
                    click(item, focusedWindows) {
                        clipboard.writeText(`${currentBaseUrl}/?room=${g_room}&v=${version}`);
                        console.log(`${currentBaseUrl}/?room=${g_room}&v=${version}`);
                    }
                },

                {
                    type: 'separator',
                },
                {
                    label: `サーバー: ${currentBaseUrl}`,
                    enabled: false, // 表示のみ、クリック不可
                },
                {
                    type: 'separator',
                },
                {
                    label: "QR Code表示",
                    submenu: [
                        {
                            label: '非表示', type: 'radio',
                            click(item, focusedWindow) {
                                console.log(item, focusedWindow);
                                win.webContents.executeJavaScript(`toggleQR(${item.checked}, "none", "${g_room}");`, true)
                                    .then(result => {
                                    }).catch(console.error);
                            }
                        },
                        {
                            label: 'QR Code [CENTER]', type: 'radio',
                            click(item, focusedWindow) {
                                console.log(item, focusedWindow);
                                win.webContents.executeJavaScript(`toggleQR(${item.checked}, "center", "${g_room}");`, true)
                                    .then(result => {
                                    }).catch(console.error);
                            }
                        },
                        {
                            label: 'QR Code [TOP RIGHT]', type: 'radio', checked: true,
                            click(item, focusedWindow) {
                                console.log(item, focusedWindow);
                                win.webContents.executeJavaScript(`toggleQR(${item.checked}, "top_right", "${g_room}");`, true)
                                    .then(result => {
                                    }).catch(console.error);
                            }
                        },
                    ]
                },
                {
                    type: 'separator',
                },
                {
                    label: '投稿制限解除', type: 'checkbox',
                    click(item, focusedWindow) {
                        win.webContents.executeJavaScript(`toggleCommentControl(${item.checked});`, true)
                            .then(result => {
                            }).catch(console.error);
                    }
                },
                {
                    label: 'サウンドコメントのミュート', type: 'checkbox',
                    click(item, focusedWindow) {
                        win.webContents.executeJavaScript(`toggleSoundMute();`, true)
                            .then(result => {
                            }).catch(console.error);
                    }
                },
                {
                    label: 'メッセージ表示', type: 'checkbox',
                    click(item, focusedWindow) {
                        if (item.checked == true) {
                            prompt({
                                title: 'Commentable',
                                alwaysOnTop: true,
                                label: '表示テキストを入力してください',
                                value: admin_message,
                                menuBarVisible: true,
                                buttonLabels: {
                                    ok: '表示する',
                                    cancel: 'キャンセル'
                                },
                                inputAttrs: {
                                    type: 'text',
                                    required: true
                                },
                                type: 'input',
                                //resizable: true,
                                customStylesheet: path.join(__dirname, '/css/prompt.css')
                            })
                                .then((r) => {
                                    if (r === null) {
                                        //console.log('user cancelled');
                                        item.checked = false;
                                        return;
                                    } else {
                                        admin_message = r;
                                        win.webContents.executeJavaScript(`toggleMessage(${item.checked},'${r}');`, true)
                                            .then(result => {

                                            }).catch(console.error)

                                    }
                                }).catch(console.error);
                        }
                        else {
                            win.webContents.executeJavaScript(`toggleMessage(${item.checked},'');`, true)
                                .then(result => {

                                }).catch(console.error)
                        }
                    }
                },
                {
                    label: '時刻表示', type: 'checkbox',
                    click(item, focusedWindow) {

                        win.webContents.executeJavaScript(`toggleClock(${item.checked});`, true)
                            .then(result => {
                            }).catch(console.error)

                    }
                },

                {
                    label: 'クリップボード内容を配布資料欄に送信',
                    accelerator: process.platform === 'darwin' ? 'Command+Alt+V' : 'Control+Alt+V',
                    click: () => {
                        sendClipText2CodeSnippet();
                    }

                },
                {
                    label: "ツール",
                    submenu: [
                        {
                            label: '効果音セット',
                            click: () => {
                                //mainWindow.loadFile(path.join(__dirname, 'about.html'));
                                const mainWindowSize = win.getSize();
                                const mainWindowPos = win.getPosition();

                                const aboutWindowWidth = 400;
                                const aboutWindowHeight = 900;

                                const aboutWindowPosX = mainWindowPos[0] + (mainWindowSize[0] - aboutWindowWidth) / 2;
                                const aboutWindowPosY = mainWindowPos[1] + (mainWindowSize[1] - aboutWindowHeight) / 2;

                                let win_sepad = new BrowserWindow({
                                    title: "効果音",
                                    width: aboutWindowWidth,
                                    height: aboutWindowHeight,
                                    x: aboutWindowPosX,
                                    y: aboutWindowPosY,
                                    hasShadow: true,
                                    alwaysOnTop: false,
                                    resizable: false,
                                    frame: true,
                                    webPreferences: {
                                        preload: path.join(__dirname, 'preload.js'),
                                        nodeIntegration: false,
                                        contextIsolation: true
                                    }
                                });
                                win_sepad.loadFile(path.join(__dirname, `sepad.html`)).then(() => {
                                    win_sepad.webContents.executeJavaScript(`setVersion("${version}");`, true)
                                        .then(result => {
                                        }).catch(console.error);

                                    ipcMain.on('set-volume', (event, value) => {
                                        // arg には 'yourVariableHere' が格納されています。
                                        console.log(value, win_sepad);
                                        win.webContents.executeJavaScript(`setVolume("${value}");`, true)
                                            .then(result => {
                                            }).catch(console.error);
                                    });
                                });

                            }
                        },
                        {
                            label: "AIアシスタント", click: async () => {
                                try {
                                    console.log(`${currentBaseUrl}/assistant/?room=${g_room}&v=${version}`);
                                    const { shell } = require('electron')
                                    await shell.openExternal(`${currentBaseUrl}/assistant/?room=${g_room}&v=${version}`);
                                } catch (error) {
                                    console.error('Error opening AI assistant:', error);
                                }
                            }
                        },
                        {
                            label: "チャレンジブル", click: async () => {
                                try {
                                    const { shell } = require('electron')
                                    await shell.openExternal(`https://tetsuakibaba.github.io/challengeable/`);
                                } catch (error) {
                                    console.error('Error opening challengeable:', error);
                                }
                            }
                        },
                        {
                            label: "アクセシブルスピーチトレーニング", click: async () => {
                                try {
                                    const { shell } = require('electron')
                                    await shell.openExternal(`https://tetsuakibaba.github.io/AccessibleSpeechTraining/`);
                                } catch (error) {
                                    console.error('Error opening speech training:', error);
                                }
                            }
                        },

                    ]
                },
                {
                    label: 'カメラ',
                    submenu: [
                        {
                            label: 'カメラON/OFF',
                            type: 'checkbox',
                            checked: false,
                            click: (menuItem) => {
                                cameraEnabled = menuItem.checked;
                                toggleCamera(menuItem.checked);
                                // 設定を保存
                                const settings = loadCameraSettings();
                                settings.enabled = cameraEnabled;
                                saveCameraSettings(settings);
                            }
                        },
                        {
                            type: 'separator'
                        },
                        {
                            label: 'カメラ設定...',
                            click: () => {
                                openCameraSettings();
                            }
                        },
                        {
                            type: 'separator'
                        },
                        {
                            label: '表示位置',
                            submenu: [
                                {
                                    label: '左上',
                                    type: 'radio',
                                    checked: savedPosition === 'top-left',
                                    click: () => {
                                        win.webContents.executeJavaScript(`setCameraPosition('top-left');`)
                                            .catch(console.error);
                                        saveCameraPosition('top-left');
                                    }
                                },
                                {
                                    label: '右上',
                                    type: 'radio',
                                    checked: savedPosition === 'top-right',
                                    click: () => {
                                        win.webContents.executeJavaScript(`setCameraPosition('top-right');`)
                                            .catch(console.error);
                                        saveCameraPosition('top-right');
                                    }
                                },
                                {
                                    label: '左下',
                                    type: 'radio',
                                    checked: savedPosition === 'bottom-left',
                                    click: () => {
                                        win.webContents.executeJavaScript(`setCameraPosition('bottom-left');`)
                                            .catch(console.error);
                                        saveCameraPosition('bottom-left');
                                    }
                                },
                                {
                                    label: '右下',
                                    type: 'radio',
                                    checked: savedPosition === 'bottom-right',
                                    click: () => {
                                        win.webContents.executeJavaScript(`setCameraPosition('bottom-right');`)
                                            .catch(console.error);
                                        saveCameraPosition('bottom-right');
                                    }
                                },
                                {
                                    label: '中央',
                                    type: 'radio',
                                    checked: savedPosition === 'center',
                                    click: () => {
                                        win.webContents.executeJavaScript(`setCameraPosition('center');`)
                                            .catch(console.error);
                                        saveCameraPosition('center');
                                    }
                                }
                            ]
                        },
                        {
                            label: 'サイズ',
                            submenu: [
                                {
                                    label: '小',
                                    type: 'radio',
                                    checked: savedSize === 'small',
                                    click: () => {
                                        win.webContents.executeJavaScript(`setCameraSize('small');`)
                                            .catch(console.error);
                                        saveCameraSize('small');
                                    }
                                },
                                {
                                    label: '中',
                                    type: 'radio',
                                    checked: savedSize === 'medium',
                                    click: () => {
                                        win.webContents.executeJavaScript(`setCameraSize('medium');`)
                                            .catch(console.error);
                                        saveCameraSize('medium');
                                    }
                                },
                                {
                                    label: '大',
                                    type: 'radio',
                                    checked: savedSize === 'large',
                                    click: () => {
                                        win.webContents.executeJavaScript(`setCameraSize('large');`)
                                            .catch(console.error);
                                        saveCameraSize('large');
                                    }
                                }
                            ]
                        }
                    ]
                },
                {
                    type: 'separator',
                },


                {
                    label: 'About',
                    click: () => {
                        //mainWindow.loadFile(path.join(__dirname, 'about.html'));
                        const mainWindowSize = win.getSize();
                        const mainWindowPos = win.getPosition();

                        const aboutWindowWidth = 300;
                        const aboutWindowHeight = 300;

                        const aboutWindowPosX = mainWindowPos[0] + (mainWindowSize[0] - aboutWindowWidth) / 2;
                        const aboutWindowPosY = mainWindowPos[1] + (mainWindowSize[1] - aboutWindowHeight) / 2;

                        const win_about = new BrowserWindow({
                            title: "About Commentable",
                            width: aboutWindowWidth,
                            height: aboutWindowHeight,
                            x: aboutWindowPosX,
                            y: aboutWindowPosY,
                            hasShadow: false,
                            alwaysOnTop: true,
                            resizable: false,
                            frame: false,
                            webPreferences: {
                                preload: path.join(__dirname, 'preload.js'),
                            },
                            show: true,
                        });
                        win_about.loadFile(path.join(__dirname, `about.html`)).then(() => {

                            win_about.webContents.executeJavaScript(`setVersion("${version}");`, true)
                                .then(result => {

                                }).catch(console.error);

                            win_about.webContents.executeJavaScript(`setCopyrightYear("${copyrightYear}");`, true)
                                .then(result => {

                                }).catch(console.error);
                        });
                        // 以下を追加
                        win_about.webContents.setWindowOpenHandler(({ url }) => {
                            if (url.startsWith('http')) {
                                shell.openExternal(url).catch(error => {
                                    console.error('Error opening external URL:', error);
                                });
                            }
                            return { action: 'deny' }
                        })
                    }
                },

                { label: 'Quit', role: 'quit' },
            ])

            let screens = screen.getAllDisplays();

            var data_append;
            data_append = {
                label: '表示ディスプレイ選択',
                submenu: []
            }
            sc_count = 0;
            for (sc of screens) {
                data_append.submenu[sc_count] = {
                    label: 'Display-' + sc.id + " [" + sc.bounds.x + ", " + sc.bounds.y + "] " + sc.bounds.width + "x" + sc.bounds.height,
                    type: 'radio',
                    x: sc.workArea.x,
                    y: sc.workArea.y,
                    w: sc.workArea.width,
                    h: sc.workArea.height,
                    click: function (item) {
                        win.setPosition(item.x, item.y, true);
                        win.setSize(item.w, item.h, true);
                    }
                };
                sc_count++;
            }
            contextMenu.insert(3, new MenuItem(data_append));

            tray.setToolTip('commentable-desktop')

            tray.setContextMenu(contextMenu)

            //クリック時の操作を設定  
            tray.on('click', () => {
                // メニューを表示
                tray.popUpContextMenu(contextMenu)
            })

            // メニューを更新する関数をグローバルに定義
            global.updateTrayMenu = function () {
                if (!tray) return;

                // 現在のメニューと同じ構造でcontextMenuを再構築
                var newContextMenu = Menu.buildFromTemplate([
                    {
                        label: "投稿ページを開く", click: async () => {
                            try {
                                const { shell } = require('electron')
                                await shell.openExternal(`${currentBaseUrl}/?room=${g_room}&v=${version}`);
                            } catch (error) {
                                console.error('Error opening post page:', error);
                            }
                        }
                    },
                    {
                        label: '投稿ページURLをコピー',
                        click(item, focusedWindows) {
                            clipboard.writeText(`${currentBaseUrl}/?room=${g_room}&v=${version}`);
                            console.log(`${currentBaseUrl}/?room=${g_room}&v=${version}`);
                        }
                    },
                    {
                        type: 'separator',
                    },
                    {
                        label: `サーバー: ${currentBaseUrl}`,
                        enabled: false, // 表示のみ、クリック不可
                    },
                    {
                        type: 'separator',
                    },
                    // QRコード設定部分は省略して、重要な部分のみ再作成
                    {
                        label: "ユーティリティ",
                        submenu: [
                            {
                                label: "米太郎AIアシスタント", click: async () => {
                                    try {
                                        const { shell } = require('electron')
                                        await shell.openExternal(`${currentBaseUrl}/kometaro/?room=${g_room}&v=${version}`);
                                    } catch (error) {
                                        console.error('Error opening Kometaro AI assistant:', error);
                                    }
                                }
                            },
                            {
                                label: "チャレンジブル", click: async () => {
                                    try {
                                        const { shell } = require('electron')
                                        await shell.openExternal(`https://tetsuakibaba.github.io/challengeable/`);
                                    } catch (error) {
                                        console.error('Error opening challengeable:', error);
                                    }
                                }
                            },
                            {
                                label: "アクセシブルスピーチトレーニング", click: async () => {
                                    try {
                                        const { shell } = require('electron')
                                        await shell.openExternal(`https://bttb.sakura.ne.jp/accessibleSpeech/`);
                                    } catch (error) {
                                        console.error('Error opening speech training:', error);
                                    }
                                }
                            }
                        ]
                    },
                    {
                        type: 'separator',
                    },
                    {
                        label: 'Quit',
                        click: () => {
                            app.quit()
                        }
                    }
                ]);

                tray.setContextMenu(newContextMenu);
                console.log(`Tray menu updated with server: ${currentBaseUrl}`);
            }

            win.webContents.executeJavaScript(`startSocketConnection("${room}");`, true)
                .then(result => {
                }).catch(console.error);
        })
        .catch(console.error);


    win.webContents.on('did-finish-load', () => {
        win.show();

        // デバッグモードの場合はページ読み込み後にDevToolsを開く
        if (DEBUG_MODE) {
            win.webContents.openDevTools();
        }

        // QRコードの表示
        win.webContents.executeJavaScript(`toggleQR(true, "top_right", "${g_room}");`, true)
            .then(result => {

            }).catch(console.error);

        // 保存されたカメラ設定を読み込んで適用
        const settings = loadCameraSettings();
        cameraEnabled = settings.enabled || false;

        if (cameraEnabled && settings.deviceId) {
            console.log('Auto-starting camera with saved settings:', settings.deviceId);
            win.webContents.send('select-camera', settings.deviceId);

            // 少し待ってから位置とサイズを適用
            setTimeout(() => {
                if (settings.position) {
                    win.webContents.executeJavaScript(`setCameraPosition('${settings.position}');`)
                        .catch(console.error);
                }
                if (settings.size) {
                    win.webContents.executeJavaScript(`setCameraSize('${settings.size}');`)
                        .catch(console.error);
                }
            }, 500);
        }
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            //createWindow()
        }
    })


})

app.on('will-quit', () => {
    // アプリケーション終了前にショートカットを解除
    globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

function sendClipText2CodeSnippet() {
    const clip_text = clipboard.readText();
    // clip_text内の改行コード、コーテーションをエスケープ処理する
    const clip_text_escaped = clip_text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    //const clip_text_escaped = clip_text.replace(/\r?\n/g, '\\n');
    win.webContents.executeJavaScript(`sendCodeSnippet("${clip_text_escaped}");`, true)
        .then(result => {
        }).catch(console.error);
}

