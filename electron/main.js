require('update-electron-app')()

const { app, BrowserWindow, Menu, Tray, screen, MenuItem, shell, clipboard, globalShortcut } = require('electron')
const { ipcMain } = require('electron');

const prompt = require('electron-prompt');

const packageJson = require('./package.json');
const version = packageJson.version;

const is_windows = process.platform === 'win32'
const is_mac = process.platform === 'darwin'
const is_linux = process.platform === 'linux'

const path = require('path');

// サーバー切り替えフラグ（true: ローカル開発, false: 本番環境）
// const USE_LOCAL_SERVER = false;
const USE_LOCAL_SERVER = true;

// ベースURL設定
function getBaseUrl() {
    if (USE_LOCAL_SERVER) {
        console.log('Using local development server');
        return 'http://localhost:3000';
    } else {
        console.log('Using production server');
        return 'https://bbcommentable.herokuapp.com';
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



    // debug
    // win.webContents.openDevTools();

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
let tray = null
var g_room;
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
            win.setIgnoreMouseEvents(true);
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

            var contextMenu = Menu.buildFromTemplate([
                {
                    label: "投稿ページを開く", click: async () => {
                        const { shell } = require('electron')
                        await shell.openExternal(`${currentBaseUrl}/?room=${g_room}&v=${version}`);
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
                            label: "米太郎AIアシスタント", click: async () => {
                                const { shell } = require('electron')
                                await shell.openExternal(`${currentBaseUrl}/kometaro/?room=${g_room}&v=${version}`);
                            }
                        },
                        {
                            label: "チャレンジブル", click: async () => {
                                const { shell } = require('electron')
                                await shell.openExternal(`https://tetsuakibaba.github.io/challengeable/`);
                            }
                        },
                        {
                            label: "アクセシブルスピーチトレーニング", click: async () => {
                                const { shell } = require('electron')
                                await shell.openExternal(`https://bttb.sakura.ne.jp/accessibleSpeech/`);
                            }
                        },

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
                            title: "About QuickGPT",
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
                        });
                        // 以下を追加
                        win_about.webContents.setWindowOpenHandler(({ url }) => {
                            if (url.startsWith('http')) {
                                shell.openExternal(url)
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
                            const { shell } = require('electron')
                            await shell.openExternal(`${currentBaseUrl}/?room=${g_room}&v=${version}`);
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
                                    const { shell } = require('electron')
                                    await shell.openExternal(`${currentBaseUrl}/kometaro/?room=${g_room}&v=${version}`);
                                }
                            },
                            {
                                label: "チャレンジブル", click: async () => {
                                    const { shell } = require('electron')
                                    await shell.openExternal(`https://tetsuakibaba.github.io/challengeable/`);
                                }
                            },
                            {
                                label: "アクセシブルスピーチトレーニング", click: async () => {
                                    const { shell } = require('electron')
                                    await shell.openExternal(`https://bttb.sakura.ne.jp/accessibleSpeech/`);
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
        // QRコードの表示
        win.webContents.executeJavaScript(`toggleQR(true, "top_right", "${g_room}");`, true)
            .then(result => {

            }).catch(console.error);


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

