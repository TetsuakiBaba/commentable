require('update-electron-app')()

const { app, BrowserWindow, Menu, Tray, screen, shell, clipboard, globalShortcut, ipcMain, autoUpdater, dialog } = require('electron')
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const prompt = require('electron-prompt');

const packageJson = require('./package.json');
const version = packageJson.version;
const copyrightYear = packageJson.year;

const is_windows = process.platform === 'win32'
const is_mac = process.platform === 'darwin'

const PRELOAD = path.join(__dirname, 'preload.js');
const PROMPT_STYLESHEET = path.join(__dirname, '/css/prompt.css');

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

const currentBaseUrl = USE_LOCAL_SERVER ? 'http://localhost:3000' : 'https://commentable.onrender.com';
console.log(`Commentable will use server: ${currentBaseUrl}`);

var win;
var contextMenu;
var g_room; // 部屋名
var tray;
var cameraEnabled = false; // カメラのON/OFF状態（起動時は常にOFF）

// 人物切り抜き（macOS Vision の VNGeneratePersonSegmentationRequest を使用）
let personSegmentation = null;
if (is_mac) {
    try {
        personSegmentation = require('./native/person-segmentation');
        if (!personSegmentation.isSupported()) {
            personSegmentation = null;
        }
    } catch (error) {
        console.warn('Person segmentation is not available:', error.message);
    }
}
var cameraSegmentationQuality = 'balanced'; // 'fast', 'balanced', 'accurate'

// メニューの状態管理用変数
var menuState = {
    qrCode: 'top_right', // 'none', 'center', 'top_right'
    commentControl: false,
    soundMute: false,
    clock: false
};

// ========== レンダラー呼び出し ==========
// 引数は JSON として埋め込むので、引用符や改行を含む文字列でも安全に渡せる
function runInWindow(targetWindow, fn, ...args) {
    if (!targetWindow || targetWindow.isDestroyed()) return Promise.resolve();
    const code = `${fn}(${args.map(arg => JSON.stringify(arg)).join(', ')});`;
    return targetWindow.webContents.executeJavaScript(code, true).catch(console.error);
}

function callRenderer(fn, ...args) {
    return runInWindow(win, fn, ...args);
}

// メインウィンドウの中央に子ウィンドウを開く
function openCenteredWindow(file, { width, height, ...options }) {
    const [mainWidth, mainHeight] = win.getSize();
    const [mainX, mainY] = win.getPosition();
    const child = new BrowserWindow({
        width,
        height,
        x: Math.round(mainX + (mainWidth - width) / 2),
        y: Math.round(mainY + (mainHeight - height) / 2),
        ...options,
        webPreferences: {
            preload: PRELOAD,
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    child.loadFile(path.join(__dirname, file));
    return child;
}

// ========== カメラ設定 ==========
const settingsPath = path.join(app.getPath('userData'), 'camera-settings.json');

function loadCameraSettings() {
    try {
        if (fs.existsSync(settingsPath)) {
            return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
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

function saveCameraSettings(settings) {
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    } catch (error) {
        console.error('Error saving camera settings:', error);
    }
}

// 既存の設定に一部の項目だけ上書きして保存
function updateCameraSettings(patch) {
    saveCameraSettings({ ...loadCameraSettings(), ...patch });
}

// 保存済みの表示位置・サイズ・切り抜き設定を画面に反映
function applyCameraDisplaySettings(settings) {
    if (settings.position) callRenderer('setCameraPosition', settings.position);
    if (settings.size) callRenderer('setCameraSize', settings.size);
    callRenderer('setCameraSegmentation', !!(personSegmentation && settings.segmentation));
}

function toggleCamera(enabled) {
    if (!enabled) {
        win.webContents.send('stop-camera');
        return;
    }
    const settings = loadCameraSettings();
    if (settings.deviceId) {
        win.webContents.send('select-camera', settings.deviceId);
        applyCameraDisplaySettings(settings);
    } else {
        // デバイスIDがない場合は設定画面を開く
        openCameraSettings();
    }
}

function openCameraSettings() {
    const settingsWindow = openCenteredWindow('camera-settings.html', {
        title: "カメラ設定",
        width: 600,
        height: 500,
        hasShadow: true,
        alwaysOnTop: true,
        resizable: false,
        frame: true
    });

    // 閉じたときにカメラがONなら選び直したカメラで再起動
    settingsWindow.on('closed', () => {
        if (cameraEnabled) {
            const settings = loadCameraSettings();
            if (settings.deviceId) {
                win.webContents.send('select-camera', settings.deviceId);
            }
        }
    });
}

// ========== メインウィンドウ ==========
function sendWindowMetrics() {
    if (!win || win.isDestroyed()) return;
    const { scaleFactor } = screen.getDisplayMatching(win.getBounds());
    const [width, height] = win.getContentSize();
    win.webContents.send('window-resized', {
        width,
        height,
        scaleFactor,
        physicalWidth: Math.round(width * scaleFactor),
        physicalHeight: Math.round(height * scaleFactor)
    });
}

function createWindow() {
    const activeScreen = screen.getPrimaryDisplay();
    const { x, y, width, height } = activeScreen.workArea;

    win = new BrowserWindow({
        title: "commentable-desktop",
        width,
        height,
        x,
        y,
        hasShadow: false,
        transparent: true,
        frame: false,
        resizable: true,
        alwaysOnTop: true,
        webPreferences: {
            preload: PRELOAD,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: process.env.NODE_ENV === 'production' // 開発環境ではwebSecurityを無効化
        }
    })

    // レンダラーのコンソール出力をターミナルに表示（デバッグ用）
    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
        console.log(`[Renderer] Level ${level}: ${message}`);
        if (line && sourceId) {
            console.log(`  at ${sourceId}:${line}`);
        }
    });

    win.webContents.on('render-process-gone', (event, details) => {
        console.log('Render process gone:', details);
    });

    // リサイズ時はレンダラーに論理サイズと倍率を通知
    win.on('resize', sendWindowMetrics);

    // ディスプレイ構成が変わったらウィンドウを合わせ、メニューの一覧も更新
    const onDisplayChanged = () => {
        adjustWindowToCurrentDisplay();
        rebuildTrayMenu();
    };
    screen.on('display-added', onDisplayChanged);
    screen.on('display-removed', onDisplayChanged);
    screen.on('display-metrics-changed', onDisplayChanged);

    // ウィンドウが別のディスプレイに移動した時
    win.lastDisplayId = activeScreen.id;
    win.on('move', () => {
        const currentDisplay = screen.getDisplayMatching(win.getBounds());
        if (win.lastDisplayId !== currentDisplay.id) {
            win.lastDisplayId = currentDisplay.id;
            adjustWindowToCurrentDisplay();
        }
    });
}

// 現在のディスプレイの作業領域いっぱいにウィンドウを合わせる
// （resize イベントでレンダラーに通知される）
function adjustWindowToCurrentDisplay() {
    if (!win) return;
    const currentDisplay = screen.getDisplayMatching(win.getBounds());
    win.setBounds(currentDisplay.workArea);
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
    // 配信者の重複入室を防ぐので、他の人と重なりにくいように番号を付ける
    return capFirst(name1[getRandomInt(0, name1.length)]) + '_' + capFirst(name2[getRandomInt(0, name2.length)]) + '_' + getRandomInt(100, 1000);
}

// ========== IPC ==========
ipcMain.handle('save-camera-setting', async (event, deviceId) => {
    updateCameraSettings({ deviceId, enabled: cameraEnabled });
    return true;
});

ipcMain.handle('get-camera-setting', async () => loadCameraSettings().deviceId);

// カメラフレーム（RGBA）から人物マスクを生成
ipcMain.handle('segment-person', async (event, { data, width, height }) => {
    if (!personSegmentation) {
        throw new Error('Person segmentation is not available');
    }
    return personSegmentation.segment(data, width, height, cameraSegmentationQuality);
});

// レンダラープロセスからのログをメインプロセスのコンソールに出力
ipcMain.on('console-log', (event, ...args) => console.log('[Renderer]', ...args));
ipcMain.on('console-warn', (event, ...args) => console.warn('[Renderer]', ...args));
ipcMain.on('console-error', (event, ...args) => console.error('[Renderer]', ...args));

// ========== 授業ログの保存 ==========
// サーバーの授業ログは保持期間を過ぎると消えるので、配信中に受け取ったものをこの Mac にも保存する
// 保存先: 書類/Commentable/logs/<部屋キー>/<授業回ID>.jsonl（サーバーと同じ形式）
const LOG_ARCHIVE_DIR = path.join(app.getPath('documents'), 'Commentable', 'logs');
const archivedEventIds = new Map(); // ファイル → 保存済みの event_id

// サーバーの event-log.js と同じ規則で部屋名からフォルダ名を作る
function logRoomKey(room) {
    const safe = String(room).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    if (safe === room) return safe;
    return `${safe}_${crypto.createHash('sha1').update(String(room)).digest('hex').slice(0, 8)}`;
}

function archiveLogEvents(events) {
    for (const event of Array.isArray(events) ? events : []) {
        if (!event || typeof event.room !== 'string' || !/^\d{8}-\d{6}$/.test(event.session_id || '')) continue;
        const dir = path.join(LOG_ARCHIVE_DIR, logRoomKey(event.room));
        const file = path.join(dir, `${event.session_id}.jsonl`);
        let ids = archivedEventIds.get(file);
        if (!ids) {
            // 既存のファイルに保存済みのものは書かない（再接続で同じログが届くため）
            ids = new Set();
            try {
                fs.readFileSync(file, 'utf8').split('\n').forEach(line => {
                    try { if (line) ids.add(JSON.parse(line).event_id); } catch (e) { /* 壊れた行は無視 */ }
                });
            } catch (error) { /* まだファイルがない */ }
            archivedEventIds.set(file, ids);
        }
        if (ids.has(event.event_id)) continue;
        try {
            fs.mkdirSync(dir, { recursive: true });
            fs.appendFileSync(file, JSON.stringify(event) + '\n', 'utf8');
            ids.add(event.event_id);
        } catch (error) {
            console.error('Error archiving log event:', error);
        }
    }
}

ipcMain.on('archive-log-events', (event, events) => archiveLogEvents(events));

function openLogArchiveFolder() {
    fs.mkdirSync(LOG_ARCHIVE_DIR, { recursive: true });
    shell.openPath(LOG_ARCHIVE_DIR);
}

// ========== 配信者の鍵 ==========
// 部屋ごとに秘密の鍵を作って保存する。最初に入室したアプリの鍵がサーバーに登録され、
// 同じ部屋名で別のアプリ（なりすまし）が配信画面として入室することを防ぐ。
// ダッシュボードには鍵から作ったトークンを渡す（サーバーの room-auth.js と同じ式）
//
// 鍵のファイルは保存場所を変えられる。Dropbox や iCloud Drive の同じフォルダを選べば、
// 別の Mac / PC でも同じ鍵を使って同じ部屋で配信できる
const appSettingsPath = path.join(app.getPath('userData'), 'app-settings.json');
const DEFAULT_HOST_KEYS_FILE = path.join(app.getPath('userData'), 'host-keys.json');
const SHARED_HOST_KEYS_FILENAME = 'commentable-host-keys.json';
let currentHostKey = null; // 入室中の部屋の鍵

function loadAppSettings() {
    try {
        return JSON.parse(fs.readFileSync(appSettingsPath, 'utf8')) || {};
    } catch (error) {
        return {};
    }
}

function saveAppSettings(patch) {
    try {
        fs.writeFileSync(appSettingsPath, JSON.stringify({ ...loadAppSettings(), ...patch }, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving app settings:', error);
    }
}

// 鍵の保存フォルダ（null なら既定の場所）
function hostKeysDir() {
    return loadAppSettings().hostKeysDir || null;
}

function hostKeysFile(dir = hostKeysDir()) {
    return dir ? path.join(dir, SHARED_HOST_KEYS_FILENAME) : DEFAULT_HOST_KEYS_FILE;
}

function readHostKeys(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    } catch (error) {
        return {};
    }
}

function writeHostKeys(file, keys) {
    fs.writeFileSync(file, JSON.stringify(keys, null, 2), { encoding: 'utf8', mode: 0o600 });
}

// 部屋の鍵を返す（なければ作る）。保存先のフォルダが見つからないときは例外を投げる
// （同期前の共有フォルダで新しい鍵を作ると、自分の部屋に入れなくなるため）
function getHostKey(room) {
    const dir = hostKeysDir();
    if (dir && !fs.existsSync(dir)) {
        const error = new Error(`鍵の保存場所が見つかりません: ${dir}`);
        error.code = 'HOST_KEYS_DIR_MISSING';
        throw error;
    }
    const file = hostKeysFile(dir);
    const keys = readHostKeys(file);
    if (keys[room]) return keys[room];

    // 他の Mac / PC が同じファイルに書いている可能性があるので、書く直前に読み直して追記する
    const latest = readHostKeys(file);
    if (latest[room]) return latest[room];
    latest[room] = crypto.randomBytes(32).toString('base64url');
    writeHostKeys(file, latest);
    return latest[room];
}

// 入室前に鍵を用意する。保存場所が見つからなければ、どうするかを尋ねる（終了を選んだら null）
async function ensureHostKey(room) {
    for (;;) {
        try {
            return getHostKey(room);
        } catch (error) {
            if (error.code !== 'HOST_KEYS_DIR_MISSING') {
                console.error('Error preparing host key:', error);
                return null;
            }
            const { response } = await dialog.showMessageBox({
                type: 'warning',
                title: 'Commentable',
                message: '配信者の鍵の保存場所が見つかりません',
                detail: `${hostKeysDir()}\n\nDropbox や iCloud Drive の同期が終わっているか確認してください。`,
                buttons: ['再試行', '保存場所を変更...', '既定の場所に戻す', '終了'],
                defaultId: 0,
                cancelId: 3
            });
            if (response === 1) await changeHostKeysDir();
            else if (response === 2) await resetHostKeysDir();
            else if (response === 3) return null;
        }
    }
}

// 鍵を新しい保存場所に移す。両方に同じ部屋の鍵があるときは、移動先（共有フォルダ）の鍵を使う
async function moveHostKeys(newDir) {
    const fromFile = hostKeysFile();
    const toFile = hostKeysFile(newDir);
    if (fromFile === toFile) return;
    const current = fs.existsSync(path.dirname(fromFile)) ? readHostKeys(fromFile) : {};
    const destination = readHostKeys(toFile);
    const conflicts = Object.keys(current).filter(room => destination[room] && destination[room] !== current[room]);
    const merged = { ...current, ...destination };
    try {
        fs.mkdirSync(path.dirname(toFile), { recursive: true });
        writeHostKeys(toFile, merged);
    } catch (error) {
        await dialog.showMessageBox({ type: 'error', title: 'Commentable', message: '鍵を保存できませんでした', detail: error.message });
        return;
    }
    saveAppSettings({ hostKeysDir: newDir });
    if (g_room && merged[g_room]) currentHostKey = merged[g_room];
    rebuildTrayMenu();

    let detail = `保存場所: ${toFile}\n部屋の鍵: ${Object.keys(merged).length} 件`;
    if (newDir) {
        detail += '\n\n別の Mac / PC でも同じフォルダを選ぶと、同じ部屋で配信できます。';
    }
    if (conflicts.length > 0) {
        detail += `\n\n次の部屋は、移動先にあった鍵を使います（この Mac で使っていた鍵とは別のものです）:\n${conflicts.join('\n')}`;
    }
    await dialog.showMessageBox({ type: 'info', title: 'Commentable', message: '配信者の鍵の保存場所を変更しました', detail });
}

async function changeHostKeysDir() {
    const result = await dialog.showOpenDialog({
        title: '配信者の鍵の保存場所を選択',
        message: 'Dropbox や iCloud Drive のフォルダを選ぶと、別の Mac / PC と鍵を共有できます',
        buttonLabel: 'このフォルダに保存',
        properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return;
    await moveHostKeys(result.filePaths[0]);
}

async function resetHostKeysDir() {
    await moveHostKeys(null);
}

function buildHostKeyMenu() {
    const dir = hostKeysDir();
    return {
        label: '配信者の鍵',
        submenu: [
            { label: `保存場所: ${dir || '既定（このアプリのデータフォルダ）'}`, enabled: false },
            { type: 'separator' },
            { label: '保存場所を変更...', click: changeHostKeysDir },
            { label: '既定の場所に戻す', enabled: !!dir, click: resetHostKeysDir },
            {
                label: '保存場所を開く',
                click: () => {
                    const file = hostKeysFile();
                    if (fs.existsSync(file)) shell.showItemInFolder(file);
                    else shell.openPath(path.dirname(file));
                }
            }
        ]
    };
}

function dashboardToken() {
    return crypto.createHash('sha256').update(`commentable-dashboard:${currentHostKey}`).digest('hex');
}

// ダッシュボードの URL（トークンは # 以降に付けるのでサーバーのアクセスログには残らない）
function dashboardUrl() {
    return `${currentBaseUrl}/dashboard/?room=${encodeURIComponent(g_room)}&v=${version}#token=${dashboardToken()}`;
}

// サーバーに配信画面としての入室を断られた（同じ部屋名を別の配信者が使用中）
let handlingJoinRejection = false;
ipcMain.on('join-rejected', async (event, reason) => {
    if (handlingJoinRejection) return;
    handlingJoinRejection = true;
    const { response } = await dialog.showMessageBox({
        type: 'warning',
        title: 'Commentable',
        message: `部屋「${g_room}」には入室できません`,
        detail: reason === 'host_taken'
            ? 'この部屋名は、別の配信者のアプリが使用しています。別の部屋名で入室してください。\n\n自分の別の Mac / PC で使っていた部屋なら、トレイメニュー「配信者の鍵」で、そちらと同じ保存場所（Dropbox など）を選んでから入り直してください。'
            : `サーバーに入室を断られました（${reason}）。`,
        buttons: ['別の部屋名で入室', '鍵の保存場所を変更して入り直す', '終了'],
        defaultId: 0,
        cancelId: 2
    });
    handlingJoinRejection = false;
    if (response === 1) {
        await changeHostKeysDir();
        enterRoom(g_room);
        return;
    }
    if (response !== 0) {
        app.quit();
        return;
    }
    const room = await askRoomName();
    if (room === null) {
        app.quit();
        return;
    }
    enterRoom(room);
});

// ========== アップデートの手動確認 ==========
// 定期的な確認と、ダウンロード後の再起動の確認は update-electron-app が行う。
// トレイメニューから確認したときだけ、結果をダイアログで知らせる
let manualUpdateCheck = false;

function showUpdateDialog(type, message, detail = '') {
    dialog.showMessageBox({ type, title: 'アップデートの確認', message, detail, buttons: ['OK'] });
}

function checkForUpdatesManually() {
    if (!app.isPackaged || !(is_mac || is_windows)) {
        showUpdateDialog('info', 'この環境ではアップデートを確認できません', '配布版（ビルドしたアプリ）の macOS / Windows でのみ利用できます。');
        return;
    }
    manualUpdateCheck = true;
    autoUpdater.checkForUpdates();
}

autoUpdater.on('update-available', () => {
    if (!manualUpdateCheck) return;
    manualUpdateCheck = false;
    showUpdateDialog('info', '新しいバージョンがあります', 'バックグラウンドでダウンロードしています。完了すると再起動の確認が表示されます。');
});

autoUpdater.on('update-not-available', () => {
    if (!manualUpdateCheck) return;
    manualUpdateCheck = false;
    showUpdateDialog('info', '最新のバージョンです', `現在のバージョン: ${version}`);
});

autoUpdater.on('error', (error) => {
    if (!manualUpdateCheck) return;
    manualUpdateCheck = false;
    showUpdateDialog('warning', 'アップデートを確認できませんでした', error && error.message ? error.message : String(error));
});

// ========== アンケート ==========
// 集計はメインプロセスで保持する（集計ウィンドウを閉じても結果が残る）
let surveyState = null; // { id, question, choices, multiple, counts, voters, active }
let surveyWindow = null;

function getSurveySnapshot() {
    if (!surveyState) return null;
    return {
        id: surveyState.id,
        question: surveyState.question,
        choices: surveyState.choices,
        multiple: surveyState.multiple,
        counts: surveyState.counts,
        respondents: surveyState.voters.size,
        active: surveyState.active
    };
}

function notifySurveyUpdate() {
    if (surveyWindow && !surveyWindow.isDestroyed()) {
        surveyWindow.webContents.send('survey-update', getSurveySnapshot());
    }
}

function endSurvey() {
    if (surveyState && surveyState.active) {
        surveyState.active = false;
        if (win && !win.isDestroyed()) {
            win.webContents.send('survey-end', { id: surveyState.id });
        }
        notifySurveyUpdate();
    }
}

// アンケート作成・集計ウィンドウを開く
function openSurveyWindow() {
    if (surveyWindow && !surveyWindow.isDestroyed()) {
        surveyWindow.show();
        surveyWindow.focus();
        return;
    }
    surveyWindow = openCenteredWindow('survey.html', {
        title: "アンケート",
        width: 560,
        height: 640,
        hasShadow: true,
        alwaysOnTop: true,
        resizable: true,
        frame: true
    });
    surveyWindow.on('closed', () => {
        surveyWindow = null;
    });
}

ipcMain.handle('survey-start', async (event, { question, choices, multiple }) => {
    question = String(question || '').trim();
    choices = (Array.isArray(choices) ? choices : []).map(c => String(c).trim()).filter(c => c !== '');
    if (question === '' || choices.length < 2) {
        throw new Error('質問と2つ以上の選択肢を入力してください');
    }
    endSurvey();

    surveyState = {
        id: crypto.randomUUID(),
        question,
        choices,
        multiple: !!multiple,
        counts: choices.map(() => 0),
        voters: new Set(),
        active: true
    };
    win.webContents.send('survey-start', {
        id: surveyState.id,
        question: surveyState.question,
        choices: surveyState.choices,
        multiple: surveyState.multiple
    });
    notifySurveyUpdate();
    return getSurveySnapshot();
});

ipcMain.handle('survey-end', async () => {
    endSurvey();
    return getSurveySnapshot();
});

ipcMain.handle('survey-get-state', async () => getSurveySnapshot());

// 回答を集計（サーバーでも重複は弾いているが念のためここでも確認）
ipcMain.on('survey-answer', (event, data) => {
    if (!surveyState || !surveyState.active || !data || data.id !== surveyState.id) return;
    if (surveyState.voters.has(data.voterId)) return;
    surveyState.voters.add(data.voterId);
    for (const i of data.choices || []) {
        if (Number.isInteger(i) && i >= 0 && i < surveyState.counts.length) {
            surveyState.counts[i]++;
        }
    }
    notifySurveyUpdate();
});

// ========== トレイメニュー ==========
const QR_POSITIONS = [
    ['非表示', 'none'],
    ['QR Code [CENTER]', 'center'],
    ['QR Code [TOP RIGHT]', 'top_right']
];
const CAMERA_POSITIONS = [
    ['左上', 'top-left'],
    ['右上', 'top-right'],
    ['左下', 'bottom-left'],
    ['右下', 'bottom-right'],
    ['中央', 'center']
];
const CAMERA_SIZES = [
    ['小', 'small'],
    ['中', 'medium'],
    ['大', 'large']
];
const SEGMENTATION_QUALITIES = [
    ['高速', 'fast'],
    ['標準', 'balanced'],
    ['高精度', 'accurate']
];

// [label, value] の一覧からラジオボタンのメニュー項目を作る
function radioItems(items, currentValue, onSelect) {
    return items.map(([label, value]) => ({
        label,
        type: 'radio',
        checked: currentValue === value,
        click: () => onSelect(value)
    }));
}

function postPageUrl() {
    return `${currentBaseUrl}/?room=${g_room}&v=${version}`;
}

async function openExternalUrl(url) {
    try {
        await shell.openExternal(url);
    } catch (error) {
        console.error('Error opening URL:', url, error);
    }
}

function buildDisplayMenu() {
    const currentDisplayId = win ? screen.getDisplayMatching(win.getBounds()).id : null;
    return {
        label: '表示ディスプレイ選択',
        submenu: screen.getAllDisplays().map(sc => ({
            label: `Display-${sc.id} [${sc.bounds.x}, ${sc.bounds.y}] ${sc.bounds.width}x${sc.bounds.height} (Scale: ${sc.scaleFactor})`,
            type: 'radio',
            checked: sc.id === currentDisplayId,
            click: () => {
                win.setPosition(sc.workArea.x, sc.workArea.y, true);
                win.setSize(sc.workArea.width, sc.workArea.height, true);
            }
        }))
    };
}

function buildCameraMenu() {
    const settings = loadCameraSettings();
    return {
        label: 'カメラ',
        submenu: [
            {
                label: 'カメラON/OFF',
                type: 'checkbox',
                checked: cameraEnabled,
                click: (menuItem) => {
                    cameraEnabled = menuItem.checked;
                    toggleCamera(cameraEnabled);
                    updateCameraSettings({ enabled: cameraEnabled });
                }
            },
            { type: 'separator' },
            {
                label: 'カメラ設定...',
                click: () => openCameraSettings()
            },
            {
                label: '人物切り抜き',
                visible: !!personSegmentation,
                submenu: [
                    {
                        label: '人物切り抜きON/OFF',
                        type: 'checkbox',
                        checked: !!settings.segmentation,
                        click: (menuItem) => {
                            callRenderer('setCameraSegmentation', menuItem.checked);
                            updateCameraSettings({ segmentation: menuItem.checked });
                        }
                    },
                    { type: 'separator' },
                    ...radioItems(SEGMENTATION_QUALITIES, cameraSegmentationQuality, (value) => {
                        cameraSegmentationQuality = value;
                        updateCameraSettings({ segmentationQuality: value });
                    })
                ]
            },
            { type: 'separator' },
            {
                label: '表示位置',
                submenu: radioItems(CAMERA_POSITIONS, settings.position || 'top-right', (value) => {
                    callRenderer('setCameraPosition', value);
                    updateCameraSettings({ position: value });
                })
            },
            {
                label: 'サイズ',
                submenu: radioItems(CAMERA_SIZES, settings.size || 'small', (value) => {
                    callRenderer('setCameraSize', value);
                    updateCameraSettings({ size: value });
                })
            }
        ]
    };
}

function openAboutWindow() {
    const winAbout = openCenteredWindow('about.html', {
        title: "About Commentable",
        width: 300,
        height: 300,
        hasShadow: false,
        alwaysOnTop: true,
        resizable: false,
        frame: false
    });
    winAbout.webContents.once('did-finish-load', () => {
        runInWindow(winAbout, 'setVersion', version);
        runInWindow(winAbout, 'setCopyrightYear', copyrightYear);
    });
    // リンクは外部ブラウザで開く
    winAbout.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http')) {
            openExternalUrl(url);
        }
        return { action: 'deny' }
    });
}

function buildTrayMenu() {
    return Menu.buildFromTemplate([
        {
            label: "投稿ページを開く",
            click: () => openExternalUrl(postPageUrl())
        },
        {
            label: '投稿ページURLをコピー',
            click: () => clipboard.writeText(postPageUrl())
        },
        { type: 'separator' },
        buildDisplayMenu(),
        {
            label: `サーバー: ${currentBaseUrl}`,
            enabled: false, // 表示のみ、クリック不可
        },
        { type: 'separator' },
        {
            label: "QR Code表示",
            submenu: radioItems(QR_POSITIONS, menuState.qrCode, (value) => {
                menuState.qrCode = value;
                callRenderer('toggleQR', true, value, g_room);
            })
        },
        { type: 'separator' },
        {
            label: '投稿制限解除', type: 'checkbox',
            checked: menuState.commentControl,
            click: (item) => {
                menuState.commentControl = item.checked;
                callRenderer('toggleCommentControl', item.checked);
            }
        },
        {
            label: 'サウンドコメントのミュート', type: 'checkbox',
            checked: menuState.soundMute,
            click: (item) => {
                menuState.soundMute = item.checked;
                callRenderer('toggleSoundMute');
            }
        },
        {
            label: '時刻表示', type: 'checkbox',
            checked: menuState.clock,
            click: (item) => {
                menuState.clock = item.checked;
                callRenderer('toggleClock', item.checked);
            }
        },
        {
            label: 'クリップボード内容を配布資料欄に送信',
            accelerator: is_mac ? 'Command+Alt+V' : 'Control+Alt+V',
            click: sendClipText2CodeSnippet
        },
        {
            label: 'アンケート...',
            click: openSurveyWindow
        },
        {
            label: '授業ログのフォルダを開く',
            click: openLogArchiveFolder
        },
        buildHostKeyMenu(),
        {
            label: "ダッシュボード",
            click: () => openExternalUrl(dashboardUrl())
        },
        buildCameraMenu(),
        { type: 'separator' },
        {
            label: 'アップデートを確認...',
            click: checkForUpdatesManually
        },
        {
            label: 'About',
            click: openAboutWindow
        },
        { label: 'Quit', role: 'quit' },
    ]);
}

function rebuildTrayMenu() {
    if (!tray) return;
    contextMenu = buildTrayMenu();
    // オーバーレイはメニューより手前に表示されるので、メニューを開いている間は QR コードを隠す
    contextMenu.on('menu-will-show', () => callRenderer('setQRSuppressed', true));
    contextMenu.on('menu-will-close', () => callRenderer('setQRSuppressed', false));
    tray.setContextMenu(contextMenu);
}

// ========== 起動 ==========
// 部屋に入ったらオーバーレイ表示を開始する
async function enterRoom(room) {
    const hostKey = await ensureHostKey(room);
    if (hostKey === null) {
        app.quit();
        return;
    }
    currentHostKey = hostKey;
    g_room = room;

    win.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true
    });
    win.setFullScreenable(false);
    win.setAlwaysOnTop(true, "screen-saver")

    // デバッグモードでない場合はマウスイベントを無視
    if (!DEBUG_MODE) {
        win.setIgnoreMouseEvents(true);
    }

    // 接続先・部屋名・バージョン・配信者の鍵はクエリで渡す（レンダラーの setup で接続を開始する）
    win.loadFile(path.join(__dirname, 'index.html'), {
        query: { server: currentBaseUrl, room, v: version, hostKey }
    });

    if (!tray) {
        tray = new Tray(path.join(__dirname, is_windows ? 'images/icon.ico' : 'images/icon.png'));
        tray.setToolTip('commentable-desktop')
        // クリック時にメニューを表示
        tray.on('click', () => {
            tray.popUpContextMenu(contextMenu)
        })
    }
    cameraSegmentationQuality = loadCameraSettings().segmentationQuality || 'balanced';
    rebuildTrayMenu();
}

// 部屋名を入力してもらう（キャンセルなら null）
function askRoomName() {
    return prompt({
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
        customStylesheet: PROMPT_STYLESHEET
    });
}

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
        app.dock.hide();
    }

    createWindow()

    Menu.setApplicationMenu(Menu.buildFromTemplate([
        {
            label: app.name,
            submenu: [
                { role: 'quit', label: `${app.name} を終了` }
            ]
        }
    ]));

    // グローバルショートカットの登録
    if (!globalShortcut.register('Alt+CommandOrControl+V', sendClipText2CodeSnippet)) {
        console.log('Global shortcut registration failed');
    }

    win.webContents.on('did-finish-load', () => {
        win.show();

        // デバッグモードの場合はページ読み込み後にDevToolsを開く
        if (DEBUG_MODE) {
            win.webContents.openDevTools();
        }

        // 起動時は常にカメラOFF（トレイメニューからONにする）
        cameraEnabled = false;
    });

    askRoomName()
        .then((r) => {
            if (r === null) {
                console.log('user cancelled');
                app.quit();
                return;
            }
            enterRoom(r);
        })
        .catch(console.error);
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
    callRenderer('sendCodeSnippet', clipboard.readText());
}
