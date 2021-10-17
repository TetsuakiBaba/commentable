const { app, BrowserWindow, Menu, Tray, screen } = require('electron')
const path = require('path')

//var flg_sound_mute = true;
var win;
function createWindow() {

    const { width, height } = screen.getPrimaryDisplay().workAreaSize
    win = new BrowserWindow({
        title: "Commentable-Viewer",
        width: width,
        height: height,
        x: 0,
        y: 0,
        nodeIntegration: true,
        contextIsolation: false,
        hasShadow: false,
        transparent: true,
        frame: false,
        resizable: true,
        alwaysOnTop: true,
        focusable: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js')
        }
    })


    app.dock.hide();

    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true
    });
    win.setVisibleOnAllWo
    win.setFullScreenable(false);
    win.setAlwaysOnTop(true, "screen-saver")
    win.setIgnoreMouseEvents(true);
    //win.setSimpleFullScreen(true);
    win.loadFile('index.html')
    //win.webContents.openDevTools();
    app.dock.show();

}

// In main process.


let tray = null
let flg_sound_mute = false;
let sound_mute = "false";
app.whenReady().then(() => {

    createWindow()
    win.webContents.executeJavaScript(`sessionStorage.setItem("flg_sound_mute",${sound_mute});`, true)
        .then(result => {
        });
    tray = new Tray(`${__dirname}/images/icon.png`);
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show QR Code [CENTER]', role: 'quit' },
        {
            label: "test", type: 'normal',
            click(item, focusedWindow) {
                alert("hello");
            }
        },
        {
            label: 'Mute sound', type: 'checkbox',
            click(item, focusedWindow) {
                if (sound_mute == "false") {
                    sound_mute = "true";
                }
                else {
                    sound_mute = "false";
                }

                console.log(sound_mute);
                win.webContents.executeJavaScript(`sessionStorage.setItem("flg_sound_mute", ${sound_mute}); `, true)
                    .then(result => {
                    });
            }
        },
        { label: 'Quit Commentable-Viewer', role: 'quit' },
    ])
    tray.setToolTip('commentable-viewer')
    tray.setContextMenu(contextMenu)




    let menu = Menu.buildFromTemplate(
        [
            {
                label: app.name,
                submenu: [
                    { role: 'about', label: `${app.name} について` },
                    { role: 'quit', label: `${app.name} を終了` }
                ]
            }
        ]);
    Menu.setApplicationMenu(menu);


    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow()
        }
    })


})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})


