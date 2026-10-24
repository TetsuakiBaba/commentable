import AppKit

// 部屋への接続（Electron 版の sketch.js の通信部分に相当）
// サーバーから届いたコメントをオーバーレイに表示し、アンケート・授業ログを中継する
final class RoomSession {
    let room: String
    private let hostKey: String
    private let socket: SocketIOClient
    private let overlay: OverlayGroup // 画面全体のオーバーレイと共有用ウィンドウ
    private let sounds: SoundPlayer
    private let surveys: SurveyManager
    private let archiver: LogArchiver

    // 同じ部屋名を別の配信者のアプリが使用している（なりすまし防止）
    var onJoinRejected: ((String?) -> Void)?

    init(room: String, hostKey: String, overlay: OverlayGroup, sounds: SoundPlayer, surveys: SurveyManager, archiver: LogArchiver) {
        self.room = room
        self.hostKey = hostKey
        self.overlay = overlay
        self.sounds = sounds
        self.surveys = surveys
        self.archiver = archiver
        socket = SocketIOClient(serverURL: AppConfig.serverURL)
        setupListeners()
    }

    func start() {
        NSLog("Connecting to socket server: %@", AppConfig.serverURL)
        socket.connect()
    }

    func stop() {
        socket.disconnect()
    }

    private func setupListeners() {
        socket.on("connect") { _ in NSLog("Successfully connected to server") }
        socket.on("connect_error") { error in NSLog("Connection error: %@", "\(error ?? "")") }
        socket.on("disconnect") { reason in NSLog("Disconnected from server: %@", "\(reason ?? "")") }

        socket.on("you_are_connected") { [weak self] _ in
            guard let self else { return }
            // 部屋名を指定してジョインする
            self.socket.emit("join", self.room, ["role": "overlay", "hostKey": self.hostKey])
            // 実施中のアンケートがあれば再接続後に配信し直す（回答者のブラウザ側で重複表示はされない）
            if let survey = self.surveys.activeSurvey {
                self.socket.emit("survey start", survey.payload)
            }
        }

        socket.on("join rejected") { [weak self] data in
            NSLog("Join rejected: %@", "\(data ?? "")")
            self?.socket.disconnect() // 再接続のたびに断られ続けないように止める
            self?.onJoinRejected?((data as? [String: Any])?["reason"] as? String)
        }

        socket.on("login") { [weak self] _ in
            guard let self else { return }
            NSLog("you have been connected to %@", self.room)
            // 授業ログを購読して、この Mac にも保存する（サーバーのログが消えても残るように）
            self.socket.emit("log watch")
        }

        socket.on("log snapshot") { [weak self] events in
            if let events = events as? [Any], !events.isEmpty { self?.archiver.archive(events) }
        }

        socket.on("log event") { [weak self] event in
            if let event { self?.archiver.archive([event]) }
        }

        socket.on("comment") { [weak self] data in
            if let data = data as? [String: Any] { self?.newComment(data) }
        }

        // 管理者メッセージ（ダッシュボードの「メッセージ表示」カードから）
        socket.on("admin message") { [weak self] data in
            let message = data as? [String: Any]
            let show = (message?["show"] as? Bool) ?? false
            let text = message?["text"].map { "\($0)" } ?? ""
            self?.overlay.setAdminMessage(show: show, text: text)
        }

        // アンケートの回答を集計へ
        socket.on("survey answer") { [weak self] data in
            self?.surveys.record(data)
        }
    }

    // ========== 配信者からの操作 ==========
    func surveyStarted(_ survey: SurveyManager.Survey) {
        socket.emit("survey start", survey.payload)
    }

    func surveyEnded(_ survey: SurveyManager.Survey) {
        socket.emit("survey end", ["id": survey.id])
    }

    func setCommentControl(_ unrestricted: Bool) {
        socket.emit("deactivate_comment_control", ["key": "dummy", "control": unrestricted])
    }

    // クリップボードの内容を参加者の配布資料欄に送る
    func sendCodeSnippet(_ text: String) {
        let data: [String: Any] = [
            "room_name": room,
            "my_name": "管理人",
            "comment": text,
            "flg_speech": false,
            "color_text": "#000000",
            "color_text_stroke": "#ffffff",
            "flg_image": false,
            "id_image": 0,
            "flg_sound": false,
            "id_sound": false,
            "hidden": 100,
            "origin": "host",
        ]
        socket.emit("comment", data)
        newComment(data)
        overlay.showNotification("資料スペースにクリップボードの内容を送信しました。")
    }

    // ========== コメント ==========
    private func newComment(_ data: [String: Any]) {
        // 長すぎるコメントで描画が重くならないように切り詰める（サーバーでも 300 文字に制限している）
        let comment = String((data["comment"] as? String ?? "").prefix(Self.maxCommentLength))
        let fill = NSColor(hex: data["color_text"] as? String) ?? .white
        let stroke = NSColor(hex: data["color_text_stroke"] as? String) ?? .black

        // コメントコマンド（= で始まる場合）
        if comment.hasPrefix("="), executeCommentCommand(comment, fill: fill, stroke: stroke) {
            NSLog("Comment command processed: %@", comment)
            return
        }

        let hidden = Self.number(data["hidden"])
        if hidden == 0 {
            // 隠しコマンド
            sounds.play("protofessional.mp3", volume: sounds.volume)
            overlay.showProtofessional(comment)
            return
        }

        // 通常のコメント
        if comment.isEmpty { return }
        if let hidden, hidden >= 1 { return } // 隠しコマンド（1以上）は表示しない

        // 表示に空きがあれば
        guard overlay.addComment(comment, direction: data["text_direction"] as? String, fontSize: data["font_size"] as? String,
                                 fill: fill, stroke: stroke) else { return }

        let flgSound = Self.bool(data["flg_sound"])
        // 数値でない・範囲外の値（nan や 1e300）を Int にすると強制終了するので、範囲を確かめてから変換する
        let soundID = Self.number(data["id_sound"]).flatMap { $0.isFinite && $0 >= 0 && $0 < 1000 ? Int($0) : nil }
        if flgSound && soundID == 0 { // camera
            overlay.flash()
        }
        if flgSound, let soundID, !sounds.isMuted {
            sounds.playComment(soundID: soundID)
        }
        if Self.bool(data["flg_speech"]) && !flgSound && !Self.bool(data["flg_emoji"]) && !sounds.isMuted {
            sounds.speak(comment)
        }
    }

    // =text("文字", 0.5, 0.5) の形式。許可された関数だけ実行する
    private func executeCommentCommand(_ command: String, fill: NSColor, stroke: NSColor) -> Bool {
        let body = String(command.dropFirst())
        guard let regex = try? NSRegularExpression(pattern: "([A-Za-z0-9_]+)\\(([^)]*)\\)"),
              let match = regex.firstMatch(in: body, range: NSRange(body.startIndex..., in: body)),
              let nameRange = Range(match.range(at: 1), in: body),
              let argsRange = Range(match.range(at: 2), in: body) else {
            NSLog("Invalid comment command format: %@", command)
            return false
        }
        let name = String(body[nameRange])
        let args = body[argsRange].trimmingCharacters(in: .whitespaces).components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) }

        guard name == "text" else {
            NSLog("Command not allowed: %@", name)
            return false
        }
        // 位置は画面に対する比率（0〜1）。nan や inf はレイヤーの位置にできず強制終了するので受け付けない
        if args.count >= 3, let x = Double(args[1]), let y = Double(args[2]), x.isFinite, y.isFinite {
            let text = args[0].replacingOccurrences(of: "[\"']", with: "", options: .regularExpression)
            overlay.addTextCommand(String(text.prefix(Self.maxCommentLength)), x: min(max(x, 0), 1), y: min(max(y, 0), 1), fill: fill, stroke: stroke)
        }
        return true
    }

    private static let maxCommentLength = 300

    // JSON の値を JavaScript の比較と同じように読む
    private static func number(_ value: Any?) -> Double? {
        if let number = value as? NSNumber { return number.doubleValue }
        if let text = value as? String { return Double(text) }
        return nil
    }

    private static func bool(_ value: Any?) -> Bool {
        if let number = value as? NSNumber { return number.doubleValue != 0 }
        if let text = value as? String { return !text.isEmpty }
        return false
    }
}
