const { app, BrowserWindow, Menu, Tray } = require('electron')
const path = require('path')

//var flg_sound_mute = true;
var win;
function createWindow() {
    win = new BrowserWindow({
        width: 1280,
        height: 720,
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
        fullscreen: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js')
        }
    })

    win.loadFile('index.html')

    app.dock.hide();
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true);
    win.setFullScreenable(false);
    win.setIgnoreMouseEvents(true);
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
                win.webContents.executeJavaScript(`sessionStorage.setItem("flg_sound_mute",${sound_mute});`, true)
                    .then(result => {
                    });
                //flg_sound_mute = !flg_sound_mute;
                //console.log("hello", flg_sound_mute);
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
                    { role: 'about', label: `${app.name}について` },
                    { role: 'quit', label: `${app.name}を終了` }
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


