import AppKit
import AVFoundation
import ScreenCaptureKit
import SwiftUI

// アプリ本体（Electron 版の main.js に相当）
// 透明なオーバーレイのウィンドウ、メニューバーのメニュー、入室・配信者の鍵の管理を行う
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var window: NSWindow!
    private var overlay: OverlayGroup! // 画面全体のオーバーレイ（main）と共有用ウィンドウ
    private var statusItem: NSStatusItem?
    private var hotKey: GlobalHotKey?

    private var session: RoomSession?
    private var room: String?
    private var hostKey: String? // 入室中の部屋の鍵
    private var handlingJoinRejection = false

    private let sounds = SoundPlayer()
    private let surveys = SurveyManager()
    private let archiver = LogArchiver()
    private let camera = CameraController()
    private let updateChecker = UpdateChecker()
    private var cameraEnabled = false // 入室したときに、その部屋の前回の設定に合わせる
    private var transcriber: AnyObject? // LiveTranscriber（macOS 26 以降）。入室したときに、その部屋の前回の設定に合わせる
    private var transcriptionStatus = "停止中"
    private var caption = CaptionText()

    // メニューの状態
    private var qrPosition: QRPosition = .topRight
    private var commentControl = true // 投稿制限解除（既定は制限なし）
    private var clock = false
    private var displayID: CGDirectDisplayID?

    private var surveyWindow: FloatingWindow?
    private var cameraSettingsWindow: FloatingWindow?
    private var cameraSettingsObserver: NSObjectProtocol?
    private var aboutWindow: FloatingWindow?
    private var roomListWindow: FloatingWindow?
    private var sharePickerWindow: FloatingWindow?
    private var shareWindow: AnyObject? // ShareWindowController（macOS 12.3 以降）

    // ========== 起動 ==========
    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMainMenu()
        createWindow()

        hotKey = GlobalHotKey { [weak self] in self?.sendClipboardToCodeSnippet() }

        surveys.onStart = { [weak self] survey in self?.session?.surveyStarted(survey) }
        surveys.onEnd = { [weak self] survey in self?.session?.surveyEnded(survey) }
        camera.onFrame = { [weak self] image in self?.overlay.setCameraFrame(image) }

        // ディスプレイ構成が変わったらウィンドウを合わせる
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            self?.adjustWindowToCurrentDisplay()
        }

        DispatchQueue.main.async {
            // --room <部屋名> で起動したときは入室のダイアログを出さない
            guard let room = Self.roomArgument() ?? Dialogs.askRoomName(recentRooms: RoomSettingsStore.recentRooms()) else {
                NSLog("user cancelled")
                NSApp.terminate(nil)
                return
            }
            self.enterRoom(room)
        }
    }

    private static func roomArgument() -> String? {
        let args = CommandLine.arguments
        guard let index = args.firstIndex(of: "--room"), index + 1 < args.count else { return nil }
        let room = args[index + 1].trimmingCharacters(in: .whitespacesAndNewlines)
        return room.isEmpty ? nil : room
    }

    func applicationWillTerminate(_ notification: Notification) {
        saveRoomSettings() // カメラや文字起こしを止める前に、いまの状態を保存する
        stopTranscription()
        session?.stop()
        camera.stop()
        updateChecker.applicationWillTerminate() // 「あとで」を選んだアップデートを入れ替える
    }

    // 部屋に入ったらオーバーレイ表示を開始する
    private func enterRoom(_ room: String) {
        guard let key = ensureHostKey(room) else {
            NSApp.terminate(nil)
            return
        }
        saveRoomSettings() // 別の部屋に入り直すときは、それまでの部屋の設定を残す
        session?.stop()
        overlay.clearComments()
        overlay.setAdminMessage(show: false, text: "")

        self.room = room
        hostKey = key
        let session = RoomSession(room: room, hostKey: key, overlay: overlay, sounds: sounds, surveys: surveys, archiver: archiver)
        session.onJoinRejected = { [weak self] reason in
            DispatchQueue.main.async { self?.handleJoinRejected(reason) }
        }
        // 入室できた部屋だけを「前に入った部屋」として一覧の先頭に出す
        session.onJoined = { [weak self] in
            DispatchQueue.main.async { self?.saveRoomSettings(entered: true) }
        }
        self.session = session
        applyRoomSettings(RoomSettingsStore.load(room))
        session.start()

        overlay.setQR(position: qrPosition, text: qrText())
        window.orderFrontRegardless()
        setupStatusItem()
        if CommandLine.arguments.contains("--update-now") {
            // 新しいバージョンがあれば確認なしで入れ替えて再起動する（動作確認用）
            updateChecker.check(manual: true, installImmediately: true)
        } else {
            updateChecker.checkInBackground()
        }
        openShareWindowFromArguments()
        // --transcribe で起動したときは文字起こしを始める（開発・確認用）
        if CommandLine.arguments.contains("--transcribe"), !transcriptionEnabled, #available(macOS 26.0, *), TranscriptionSettings.isSupported {
            startTranscription()
        }
    }

    // --share <アプリ名> で起動したときは、そのアプリのウィンドウの共有用ウィンドウを開く（開発・確認用）
    private func openShareWindowFromArguments() {
        let args = CommandLine.arguments
        guard let index = args.firstIndex(of: "--share"), index + 1 < args.count else { return }
        let appName = args[index + 1]
        guard #available(macOS 12.3, *), ScreenCapturePermission.ensure() else { return }
        SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: true) { [weak self] content, _ in
            let target = content?.windows.first {
                $0.windowLayer == 0 && $0.frame.width >= 160 && $0.owningApplication?.applicationName == appName
            }
            DispatchQueue.main.async {
                if let target { self?.openShareWindow(target) } else { NSLog("Share window: no window of %@", appName) }
            }
        }
    }

    // ========== 部屋ごとの設定 ==========
    // 前回その部屋で使っていた設定に戻す（保存していない項目は既定値。カメラの機種や表示位置は、保存していなければ今のまま）
    private func applyRoomSettings(_ settings: RoomSettings?) {
        qrPosition = settings?.qrPosition.flatMap(QRPosition.init(rawValue:)) ?? .topRight
        commentControl = settings?.commentControl ?? true
        session?.setCommentControl(commentControl)
        clock = settings?.clock ?? false
        overlay.setClock(clock)
        sounds.isMuted = settings?.soundMuted ?? false
        if let id = settings?.displayID, let screen = NSScreen.screens.first(where: { screenID($0) == id }) {
            moveWindow(to: screen)
        }

        if let deviceID = settings?.cameraDeviceID { CameraSettings.deviceID = deviceID }
        if let position = settings?.cameraPosition.flatMap(CameraPosition.init(rawValue:)) { CameraSettings.position = position }
        if let size = settings?.cameraSize { CameraSettings.size = size }
        if let segmentation = settings?.segmentation { CameraSettings.segmentation = segmentation }
        if let quality = settings?.segmentationQuality.flatMap(SegmentationQuality.init(rawValue:)) { CameraSettings.segmentationQuality = quality }
        applyCameraDisplaySettings()
        let camera = (settings?.camera ?? false) && CameraSettings.deviceID != nil
        if camera != cameraEnabled {
            cameraEnabled = camera
            toggleCamera(camera)
        }

        if let showCaptions = settings?.showCaptions { TranscriptionSettings.showCaptions = showCaptions }
        if let style = settings?.captionStyle.flatMap(CaptionStyle.init(rawValue:)) { TranscriptionSettings.captionStyle = style }
        overlay.captionStyle = TranscriptionSettings.captionStyle
        let transcription = (settings?.transcription ?? false) && TranscriptionSettings.isSupported
        if transcription != transcriptionEnabled { toggleTranscription() }
    }

    // いまの設定を入室中の部屋に保存する（entered なら最後に入った日時も更新する）
    private func saveRoomSettings(entered: Bool = false) {
        guard let room else { return }
        var settings = RoomSettingsStore.load(room) ?? RoomSettings()
        if entered { settings.lastEntered = Date() }
        settings.qrPosition = qrPosition.rawValue
        settings.commentControl = commentControl
        settings.clock = clock
        settings.soundMuted = sounds.isMuted
        settings.displayID = displayID
        settings.camera = cameraEnabled
        settings.cameraDeviceID = CameraSettings.deviceID
        settings.cameraPosition = CameraSettings.position.rawValue
        settings.cameraSize = CameraSettings.size
        settings.segmentation = CameraSettings.segmentation
        settings.segmentationQuality = CameraSettings.segmentationQuality.rawValue
        settings.transcription = transcriptionEnabled
        settings.showCaptions = TranscriptionSettings.showCaptions
        settings.captionStyle = TranscriptionSettings.captionStyle.rawValue
        RoomSettingsStore.save(settings, for: room)
    }

    private func openRoomListWindow() {
        roomListWindow?.close()
        let window = FloatingWindow(title: "部屋の一覧", resizable: false,
                                    content: RoomListView(currentRoom: room, onClose: { [weak self] in self?.roomListWindow?.close() }))
        roomListWindow = window
        window.present()
    }

    // ========== メインウィンドウ ==========
    private func createWindow() {
        let screen = NSScreen.screens.first ?? NSScreen.main!
        // Option を押しながらコメントをクリックしたときも、このアプリが前面に出ない（スライドのアプリのキー操作を奪わない）ようにパネルにする
        let panel = NSPanel(contentRect: screen.visibleFrame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.hidesOnDeactivate = false
        window = panel
        window.title = "commentable-desktop"
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.ignoresMouseEvents = true // マウス操作は下のアプリに通す
        window.level = .screenSaver
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        window.isReleasedWhenClosed = false
        overlay = OverlayGroup(main: OverlayView())
        overlay.main.onCommentClick = { [weak self] id in self?.session?.toggleStar(commentID: id) }
        window.contentView = overlay.main
        moveWindow(to: screen)
    }

    private func screenID(_ screen: NSScreen) -> CGDirectDisplayID? {
        (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value
    }

    // ディスプレイの作業領域（メニューバーと Dock を除く）いっぱいに合わせる
    private func moveWindow(to screen: NSScreen) {
        displayID = screenID(screen)
        window.setFrame(screen.visibleFrame, display: true)
    }

    private func adjustWindowToCurrentDisplay() {
        let screen = NSScreen.screens.first { screenID($0) == displayID } ?? NSScreen.screens.first
        if let screen { moveWindow(to: screen) }
    }

    // ========== 配信者の鍵 ==========
    // 入室前に鍵を用意する。保存場所が見つからなければ、どうするかを尋ねる（終了を選んだら nil）
    private func ensureHostKey(_ room: String) -> String? {
        while true {
            do {
                return try HostKeyStore.key(for: room)
            } catch let error as HostKeyStore.DirectoryMissing {
                let response = Dialogs.message(style: .warning, title: "配信者の鍵の保存場所が見つかりません",
                                               detail: "\(error.path)\n\nDropbox や iCloud Drive の同期が終わっているか確認してください。",
                                               buttons: ["再試行", "保存場所を変更...", "既定の場所に戻す", "終了"])
                switch response {
                case 1: HostKeyStore.chooseDirectory()
                case 2: HostKeyStore.move(to: nil)
                case 3: return nil
                default: break
                }
            } catch {
                NSLog("Error preparing host key: %@", error.localizedDescription)
                Dialogs.message(style: .critical, title: "配信者の鍵を用意できませんでした", detail: error.localizedDescription)
                return nil
            }
        }
    }

    // 鍵の保存場所を変えたら、入室中の部屋の鍵（ダッシュボードのトークン）も合わせる
    private func applyMovedKeys(_ keys: [String: String]?) {
        if let room, let key = keys?[room] { hostKey = key }
    }

    // サーバーに配信画面としての入室を断られた（同じ部屋名を別の配信者が使用中）
    private func handleJoinRejected(_ reason: String?) {
        guard !handlingJoinRejection, let room else { return }
        handlingJoinRejection = true
        defer { handlingJoinRejection = false }
        let detail = reason == "host_taken"
            ? "この部屋名は、別の配信者のアプリが使用しています。別の部屋名で入室してください。\n\n自分の別の Mac / PC で使っていた部屋なら、メニュー「配信者の鍵」で、そちらと同じ保存場所（Dropbox など）を選んでから入り直してください。"
            : "サーバーに入室を断られました（\(reason ?? "unknown")）。"
        let response = Dialogs.message(style: .warning, title: "部屋「\(room)」には入室できません", detail: detail,
                                       buttons: ["別の部屋名で入室", "鍵の保存場所を変更して入り直す", "終了"])
        if response == 1 {
            HostKeyStore.chooseDirectory()
            enterRoom(room)
            return
        }
        if response != 0 {
            NSApp.terminate(nil)
            return
        }
        guard let newRoom = Dialogs.askRoomName(recentRooms: RoomSettingsStore.recentRooms().filter { $0 != room }) else {
            NSApp.terminate(nil)
            return
        }
        enterRoom(newRoom)
    }

    // ========== URL ==========
    private func postPageURL() -> URL? {
        URL(string: "\(AppConfig.serverURL)/?room=\((room ?? "").encodedURIComponent)&v=\(AppConfig.version)")
    }

    private func qrText() -> String {
        "\(AppConfig.serverURL)/?room=\((room ?? "").encodedURI)&v=\(AppConfig.version)"
    }

    // ダッシュボードの URL（トークンは # 以降に付けるのでサーバーのアクセスログには残らない）
    private func dashboardURL() -> URL? {
        guard let room, let hostKey else { return nil }
        return URL(string: "\(AppConfig.serverURL)/dashboard/?room=\(room.encodedURIComponent)&v=\(AppConfig.version)#token=\(HostKeyStore.dashboardToken(for: hostKey))")
    }

    private func open(_ url: URL?) {
        if let url { NSWorkspace.shared.open(url) }
    }

    // ========== 操作 ==========
    private func sendClipboardToCodeSnippet() {
        guard let text = NSPasteboard.general.string(forType: .string) else { return }
        session?.sendCodeSnippet(text)
    }

    private func toggleCamera(_ enabled: Bool) {
        guard enabled else {
            camera.stop()
            return
        }
        if let deviceID = CameraSettings.deviceID {
            applyCameraDisplaySettings()
            camera.start(deviceID: deviceID)
        } else {
            // デバイスが選ばれていなければ設定画面を開く
            openCameraSettings()
        }
    }

    // 保存済みの表示位置・サイズ・切り抜き設定を画面に反映
    private func applyCameraDisplaySettings() {
        overlay.cameraPosition = CameraSettings.position
        overlay.cameraScale = CameraSettings.scale(for: CameraSettings.size)
        camera.setSegmentation(enabled: CameraSettings.segmentation, quality: CameraSettings.segmentationQuality)
    }

    // ========== 文字起こし ==========
    private var transcriptionEnabled: Bool { transcriber != nil }

    private func toggleTranscription() {
        if transcriptionEnabled {
            stopTranscription()
        } else if #available(macOS 26.0, *) {
            startTranscription()
        }
    }

    @available(macOS 26.0, *)
    private func startTranscription() {
        let transcriber = LiveTranscriber()
        transcriber.isInputSuppressed = { [sounds] in sounds.isOutputActive }
        transcriber.onVolatile = { [weak self] text in
            guard let self else { return }
            self.caption.setVolatile(text)
            self.showCaption()
        }
        transcriber.onFinal = { [weak self] text in
            guard let self else { return }
            self.caption.appendFinal(text)
            self.showCaption()
            self.session?.sendSpeechTranscript(text)
        }
        transcriber.onStateChange = { [weak self, weak transcriber] state in
            guard let self, let transcriber, self.transcriber === transcriber else { return }
            switch state {
            case .idle: self.transcriptionStatus = "停止中"
            case .preparing: self.transcriptionStatus = "準備中..."
            case .downloading: self.transcriptionStatus = "音声認識モデルをダウンロード中..."
            case .running: self.transcriptionStatus = "文字起こし中（入力: \(AVCaptureDevice.default(for: .audio)?.localizedName ?? "既定のマイク")）"
            case .failed(let message):
                self.transcriber = nil
                self.transcriptionStatus = "停止中"
                Dialogs.message(style: .warning, title: "文字起こしを開始できませんでした", detail: message)
            }
        }
        self.transcriber = transcriber
        transcriber.start()
    }

    private func stopTranscription() {
        if #available(macOS 26.0, *) { (transcriber as? LiveTranscriber)?.stop() }
        transcriber = nil
        transcriptionStatus = "停止中"
        caption.clear()
        showCaption()
    }

    private func showCaption() {
        let show = TranscriptionSettings.showCaptions
        overlay.setCaption(committed: show ? caption.committed : "", volatile: show ? caption.volatile : "")
    }

    private func openCameraSettings() {
        cameraSettingsWindow?.close()
        let window = FloatingWindow(title: "カメラ設定", resizable: false,
                                    content: CameraSettingsView(onClose: { [weak self] in self?.cameraSettingsWindow?.close() }))
        // 閉じたときにカメラが ON なら選び直したカメラで再起動
        cameraSettingsObserver = NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: window, queue: .main) { [weak self] _ in
            guard let self else { return }
            if let observer = self.cameraSettingsObserver { NotificationCenter.default.removeObserver(observer) }
            self.cameraSettingsObserver = nil
            // プレビューのセッションを止めるため中身を外す
            self.cameraSettingsWindow?.contentViewController = nil
            self.cameraSettingsWindow = nil
            if self.cameraEnabled, let deviceID = CameraSettings.deviceID {
                self.applyCameraDisplaySettings()
                self.camera.start(deviceID: deviceID)
            } else {
                // カメラを選ばずに閉じたときは OFF に戻す（メニューの表示と実際を合わせる）
                self.cameraEnabled = false
            }
            self.saveRoomSettings()
        }
        cameraSettingsWindow = window
        window.present()
    }

    private func openSurveyWindow() {
        if let surveyWindow {
            surveyWindow.present()
            return
        }
        let window = FloatingWindow(title: "アンケート", resizable: true, content: SurveyView(manager: surveys))
        window.setContentSize(NSSize(width: 560, height: 640))
        window.center()
        surveyWindow = window
        window.present()
    }

    // ========== 共有用ウィンドウ ==========
    private func openSharePicker() {
        guard #available(macOS 12.3, *) else {
            Dialogs.message(style: .warning, title: "共有用ウィンドウには macOS 12.3 以降が必要です")
            return
        }
        guard ScreenCapturePermission.ensure() else { return }
        sharePickerWindow?.close()
        let picker = WindowPickerView(model: WindowPickerModel(), onSelect: { [weak self] target in
            self?.sharePickerWindow?.close()
            self?.openShareWindow(target)
        }, onCancel: { [weak self] in
            self?.sharePickerWindow?.close()
        })
        let window = FloatingWindow(title: "共有用ウィンドウ", resizable: true, content: picker)
        sharePickerWindow = window
        window.present()
    }

    @available(macOS 12.3, *)
    private func openShareWindow(_ target: SCWindow) {
        (shareWindow as? ShareWindowController)?.close()
        let controller = ShareWindowController(target: target, overlays: overlay)
        controller.onClose = { [weak self, weak controller] in
            if self?.shareWindow === controller { self?.shareWindow = nil }
        }
        shareWindow = controller
        controller.start() // 共有用ウィンドウは対象のウィンドウの後ろに置くので、前面には出さない
    }

    private func buildShareMenu() -> [NSMenuItem] {
        var items: [NSMenuItem] = [ActionMenuItem("ウィンドウを選んで開く...") { [weak self] in self?.openSharePicker() }]
        if #available(macOS 12.3, *), let controller = shareWindow as? ShareWindowController {
            items.append(.separator())
            items.append(disabled("共有中: \(controller.targetDescription)"))
            items.append(disabled("Zoom などで「Commentable 共有用」のウィンドウを共有してください"))
            items.append(ActionMenuItem("共有用ウィンドウでの共有をやめる") { controller.close() })
        }
        return items
    }

    private func openAboutWindow() {
        if aboutWindow == nil {
            aboutWindow = FloatingWindow(title: "About Commentable", resizable: false, content: AboutView())
        }
        aboutWindow?.present()
    }

    // ========== メニュー ==========
    private func setupMainMenu() {
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Commentable について", action: #selector(showAbout), keyEquivalent: "").target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Commentable を終了", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)

        // コピー・ペースト・全選択などのショートカットは編集メニュー経由で動く
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "編集")
        editMenu.addItem(withTitle: "取り消す", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "やり直す", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "カット", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "コピー", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "ペースト", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        let pastePlain = editMenu.addItem(withTitle: "ペーストしてスタイルを合わせる", action: #selector(NSTextView.pasteAsPlainText(_:)), keyEquivalent: "v")
        pastePlain.keyEquivalentModifierMask = [.command, .option, .shift]
        editMenu.addItem(withTitle: "削除", action: #selector(NSText.delete(_:)), keyEquivalent: "")
        editMenu.addItem(withTitle: "すべてを選択", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        mainMenu.addItem(editItem)

        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "ウインドウ")
        windowMenu.addItem(withTitle: "閉じる", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = windowMenu
        mainMenu.addItem(windowItem)

        NSApp.mainMenu = mainMenu
    }

    @objc private func showAbout() { openAboutWindow() }

    private func setupStatusItem() {
        guard statusItem == nil else { return }
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.image = Self.statusIcon()
        item.button?.toolTip = "commentable-desktop"
        if !AppConfig.isProductionServer {
            item.button?.title = "ローカル"
            item.button?.imagePosition = .imageLeft
            item.button?.toolTip = "commentable-desktop（\(AppConfig.serverURL) に接続）"
        }
        let menu = NSMenu()
        menu.delegate = self
        item.menu = menu
        statusItem = item
    }

    private static func statusIcon() -> NSImage? {
        let image = NSImage(size: NSSize(width: 16, height: 16))
        for name in ["icon.png", "icon@2x.png", "icon@3x.png"] {
            if let rep = Resources.url("images", name).flatMap({ NSImageRep(contentsOf: $0) }) {
                rep.size = NSSize(width: 16, height: 16)
                image.addRepresentation(rep)
            }
        }
        return image.representations.isEmpty ? nil : image
    }

    // メニューは開くたびに作り直す（ディスプレイ一覧や設定を最新にする）
    func menuNeedsUpdate(_ menu: NSMenu) {
        guard menu === statusItem?.menu else { return }
        menu.removeAllItems()
        buildStatusMenu().forEach(menu.addItem)
    }

    // オーバーレイはメニューより手前に表示されるので、メニューを開いている間は QR コードを隠す
    func menuWillOpen(_ menu: NSMenu) {
        if menu === statusItem?.menu { overlay.main.setQRSuppressed(true) }
    }

    func menuDidClose(_ menu: NSMenu) {
        guard menu === statusItem?.menu else { return }
        overlay.main.setQRSuppressed(false)
        // 選んだ項目の処理はメニューが閉じた後に動くので、その後で部屋の設定を保存する
        DispatchQueue.main.async { [weak self] in self?.saveRoomSettings() }
    }

    private func buildStatusMenu() -> [NSMenuItem] {
        var items: [NSMenuItem] = []
        if !AppConfig.isProductionServer {
            items.append(disabled("⚠︎ 本番ではないサーバー（\(AppConfig.serverURL)）に接続中"))
            items.append(.separator())
        }
        items.append(ActionMenuItem("投稿ページを開く") { [weak self] in self?.open(self?.postPageURL()) })
        items.append(ActionMenuItem("投稿ページURLをコピー") { [weak self] in
            guard let url = self?.postPageURL() else { return }
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(url.absoluteString, forType: .string)
        })
        items.append(.separator())
        items.append(submenu("表示ディスプレイ選択", buildDisplayMenu()))
        // アプリのウィンドウだけを共有するとき用（Zoom などで共有用ウィンドウを選んでもらう）
        items.append(submenu("共有用ウィンドウ（アプリの共有）", buildShareMenu()))
        items.append(disabled("サーバー: \(AppConfig.serverURL)"))
        items.append(.separator())

        let qrItems: [(String, QRPosition)] = [("非表示", .none), ("QR Code [CENTER]", .center), ("QR Code [TOP RIGHT]", .topRight)]
        items.append(submenu("QR Code表示", qrItems.map { label, value in
            ActionMenuItem(label, checked: qrPosition == value) { [weak self] in
                guard let self else { return }
                self.qrPosition = value
                self.overlay.setQR(position: value, text: self.qrText())
            }
        }))
        items.append(.separator())

        items.append(ActionMenuItem("投稿制限解除", checked: commentControl) { [weak self] in
            guard let self else { return }
            self.commentControl.toggle()
            self.session?.setCommentControl(self.commentControl)
        })
        items.append(ActionMenuItem("サウンドコメントのミュート", checked: sounds.isMuted) { [weak self] in
            self?.sounds.isMuted.toggle()
        })
        items.append(ActionMenuItem("時刻表示", checked: clock) { [weak self] in
            guard let self else { return }
            self.clock.toggle()
            self.overlay.setClock(self.clock)
        })
        let clipboard = ActionMenuItem("クリップボード内容を配布資料欄に送信") { [weak self] in self?.sendClipboardToCodeSnippet() }
        clipboard.keyEquivalent = "v"
        clipboard.keyEquivalentModifierMask = [.command, .option]
        items.append(clipboard)
        items.append(ActionMenuItem("アンケート...") { [weak self] in self?.openSurveyWindow() })
        items.append(ActionMenuItem("授業ログのフォルダを開く") { LogArchiver.openFolder() })
        items.append(submenu("配信者の鍵", buildHostKeyMenu()))
        items.append(ActionMenuItem("部屋の一覧を整理...") { [weak self] in self?.openRoomListWindow() })
        items.append(ActionMenuItem("ダッシュボード") { [weak self] in self?.open(self?.dashboardURL()) })
        // 授業ログはブラウザ内で読み込むので、トークンは渡さない
        items.append(ActionMenuItem("授業参画度") { [weak self] in
            self?.open(URL(string: "\(AppConfig.serverURL)/engagement/"))
        })
        // サブメニューを開かなくても、いまオンかオフかが分かるように見出しに状態を出す
        items.append(submenu("カメラ：\(cameraEnabled ? "ON" : "OFF")", buildCameraMenu()))
        items.append(submenu(TranscriptionSettings.isSupported ? "文字起こし（字幕）：\(transcriptionEnabled ? "ON" : "OFF")" : "文字起こし（字幕）",
                             buildTranscriptionMenu()))
        items.append(.separator())
        items.append(disabled("バージョン \(AppConfig.version)"))
        if let ready = updateChecker.ready {
            items.append(ActionMenuItem("再起動して \(ready.version) に更新") { [weak self] in self?.updateChecker.check(manual: true, installImmediately: true) })
        } else {
            items.append(ActionMenuItem("アップデートを確認...") { [weak self] in self?.updateChecker.check(manual: true) })
        }
        items.append(ActionMenuItem("About") { [weak self] in self?.openAboutWindow() })
        items.append(ActionMenuItem("Quit") { NSApp.terminate(nil) })
        return items
    }

    private func buildDisplayMenu() -> [NSMenuItem] {
        NSScreen.screens.map { screen in
            let id = screenID(screen)
            let frame = screen.frame
            let label = "\(screen.localizedName) [\(Int(frame.minX)), \(Int(frame.minY))] \(Int(frame.width))x\(Int(frame.height)) (Scale: \(screen.backingScaleFactor.formatted()))"
            return ActionMenuItem(label, checked: id == displayID) { [weak self] in self?.moveWindow(to: screen) }
        }
    }

    private func buildHostKeyMenu() -> [NSMenuItem] {
        let dir = HostKeyStore.directory
        let reset = ActionMenuItem("既定の場所に戻す") { [weak self] in self?.applyMovedKeys(HostKeyStore.move(to: nil)) }
        reset.isEnabled = dir != nil
        return [
            disabled("保存場所: \(dir ?? "既定（このアプリのデータフォルダ）")"),
            .separator(),
            ActionMenuItem("保存場所を変更...") { [weak self] in self?.applyMovedKeys(HostKeyStore.chooseDirectory()) },
            reset,
            ActionMenuItem("保存場所を開く") { HostKeyStore.revealKeysFile() },
        ]
    }

    private func buildTranscriptionMenu() -> [NSMenuItem] {
        guard TranscriptionSettings.isSupported else {
            return [disabled("macOS 26 以降で使えます")]
        }
        return [
            ActionMenuItem(transcriptionEnabled ? "文字起こしをオフにする" : "文字起こしをオンにする") { [weak self] in self?.toggleTranscription() },
            ActionMenuItem("字幕を表示", checked: TranscriptionSettings.showCaptions) { [weak self] in
                TranscriptionSettings.showCaptions.toggle()
                self?.showCaption()
            },
            submenu("字幕の表示方法", CaptionStyle.allCases.map { style in
                ActionMenuItem(style.label, checked: TranscriptionSettings.captionStyle == style) { [weak self] in
                    TranscriptionSettings.captionStyle = style
                    self?.overlay.captionStyle = style
                }
            }),
            .separator(),
            disabled(transcriptionStatus),
            disabled("音声はこの Mac の中で認識し、外部には送りません"),
            disabled("確定した文は授業ログに記録され、ダッシュボードの AI が文脈に使います"),
        ]
    }

    private func buildCameraMenu() -> [NSMenuItem] {
        let segmentationItems: [NSMenuItem] = [
            ActionMenuItem("人物切り抜きを使う", checked: CameraSettings.segmentation) { [weak self] in
                CameraSettings.segmentation.toggle()
                self?.applyCameraDisplaySettings()
            },
            .separator(),
        ] + SegmentationQuality.allCases.map { quality in
            ActionMenuItem(quality.label, checked: CameraSettings.segmentationQuality == quality) { [weak self] in
                CameraSettings.segmentationQuality = quality
                self?.applyCameraDisplaySettings()
            }
        }
        let positions: [(String, CameraPosition)] = [("左上", .topLeft), ("右上", .topRight), ("左下", .bottomLeft), ("右下", .bottomRight), ("中央", .center)]
        return [
            ActionMenuItem(cameraEnabled ? "カメラをオフにする" : "カメラをオンにする") { [weak self] in
                guard let self else { return }
                self.cameraEnabled.toggle()
                self.toggleCamera(self.cameraEnabled)
            },
            .separator(),
            ActionMenuItem("カメラ設定...") { [weak self] in self?.openCameraSettings() },
            submenu("人物切り抜き", segmentationItems),
            .separator(),
            submenu("表示位置", positions.map { label, value in
                ActionMenuItem(label, checked: CameraSettings.position == value) { [weak self] in
                    CameraSettings.position = value
                    self?.overlay.cameraPosition = value
                }
            }),
            submenu("サイズ", CameraSettings.sizes.map { size in
                ActionMenuItem(size.label, checked: CameraSettings.size == size.value) { [weak self] in
                    CameraSettings.size = size.value
                    self?.overlay.cameraScale = size.scale
                }
            }),
        ]
    }

    private func submenu(_ title: String, _ items: [NSMenuItem]) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        let menu = NSMenu(title: title)
        items.forEach(menu.addItem)
        item.submenu = menu
        return item
    }

    private func disabled(_ title: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = false
        return item
    }
}

// クロージャで動くメニュー項目
final class ActionMenuItem: NSMenuItem {
    private let handler: () -> Void

    init(_ title: String, checked: Bool = false, handler: @escaping () -> Void) {
        self.handler = handler
        super.init(title: title, action: #selector(run), keyEquivalent: "")
        target = self
        state = checked ? .on : .off
    }

    required init(coder: NSCoder) { fatalError() }

    @objc private func run() { handler() }
}
