const { app, BrowserWindow, Menu, Tray, screen, MenuItem, clipboard } = require('electron')
const prompt = require('electron-prompt');

const is_windows = process.platform === 'win32'
const is_mac = process.platform === 'darwin'
const is_linux = process.platform === 'linux'

const path = require('path');
const { exit } = require('process');

let win;

function createWindow() {
  console.log(screen.getAllDisplays());
  //let active_screen = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  let active_screen = screen.getPrimaryDisplay();
  console.log("active_screen", active_screen);
  const { width, height } = active_screen.workAreaSize
  const x = active_screen.workArea.x;
  const y = active_screen.workArea.y;
  console.log(x, y);
  win = new BrowserWindow({
    title: "Commentable-Viewer",
    width: width,
    height: height,
    x: x,
    y: y,
    nodeIntegration: false,
    contextIsolation: false,
    hasShadow: false,
    transparent: true,
    frame: false,
    resizable: true,
    //alwaysOnTop: true,
    //focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })
}

function capFirst(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

function generateName() {
  let name1 = ["computer", "design", "art", "human", "410", "interface", "tmu"];
  let name2 = ["room", "class", "conference", "event", "area", "place"];
  let name = capFirst(name1[getRandomInt(0, name1.length)]) + '_' + capFirst(name2[getRandomInt(0, name2.length)]);
  return name;
}

let tray = null
let g_room;
app.whenReady().then(() => {
  createWindow()
  let menu = Menu.buildFromTemplate(
    [{
      label: app.name,
      submenu: [
        { role: 'quit', label: `${app.name} を終了` }
      ]
    }]);
  Menu.setApplicationMenu(menu);

  prompt({
    title: 'Commentable',
    alwaysOnTop: true,
    label: '部屋名を入力して入室してください',
    value: generateName(),
    // value: "test_room",
    //menuBarVisible: true,
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
  }).then((r) => {
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true
    });
    win.setFullScreenable(false);
    win.setAlwaysOnTop(true, "screen-saver")
    win.setIgnoreMouseEvents(true);
    win.loadFile('index.html')
    //win.webContents.openDevTools();

    let room = "";
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

    const hostname = "https://commentable.fly.dev";
    // const hostname = "http://localhost:8080";
    // const hostname = proccess.env.HOSTNAME;

    let contextMenu = Menu.buildFromTemplate([
      {
        label: "投稿ページを開く", click: async () => {
          const { shell } = require('electron')
          await shell.openExternal(hostname + '/?room=' + g_room);
        }
      },
      {
        label: '投稿ページURLをコピー',
        click(item, focusedWindows) {
          clipboard.writeText(hostname + '/?room=' + g_room);
          console.log(hostname + '/?room=' + encodeURI(g_room));
        }
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
        label: '投稿制限解除', type: 'checkbox',
        click(item, focusedWindow) {
          win.webContents.executeJavaScript(`toggleCommentControl(${item.checked});`, true)
            .then(result => {
            }).catch(console.error);
        }
      },

      {
        label: 'Mute sound', type: 'checkbox',
        click(item, focusedWindow) {
          win.webContents.executeJavaScript(`toggleSoundMute();`, true)
            .then(result => {
            }).catch(console.error);
        }
      },
      {
        type: 'separator',
      },
      { label: 'Quit Commentable-Viewer', role: 'quit' },
    ])

    let screens = screen.getAllDisplays();

    let data_append;
    data_append = {
      label: '表示ディスプレイ選択',
      submenu: []
    }
    sc_count = 0;
    for (sc of screens) {
      data_append.submenu[sc_count] = {
        label: `Display-${sc.id} [${sc.bounds.x}, ${sc.bounds.y}] ${sc.bounds.width}x${sc.bounds.height}`,
        type: 'radio',
        x: sc.workArea.x,
        y: sc.workArea.y,
        w: sc.workArea.width,
        h: sc.workArea.height,
        click: function (item) {
          console.log(item);
          win.setPosition(item.x, item.y, true);
          win.setSize(item.w, item.h, true);
          console.log(item.x, item.y, item.w, item.h);
        }
      };
      sc_count++;
    }
    contextMenu.insert(3, new MenuItem(data_append));

    tray.setToolTip('commentable-viewer')

    tray.setContextMenu(contextMenu)
    //クリック時の操作を設定
    tray.on('click', () => {
      // メニューを表示
      tray.popUpContextMenu(contextMenu)
    })

    win.webContents.executeJavaScript(`startSocketConnection("${room}");`, true)
      .catch(console.error);
  }).catch(console.error);


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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
