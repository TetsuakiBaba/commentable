import AppKit

// ダイアログ（NSAlert）のまとめ
enum Dialogs {
    @discardableResult
    static func message(style: NSAlert.Style = .informational, title: String, detail: String = "", buttons: [String] = ["OK"]) -> Int {
        let alert = NSAlert()
        alert.alertStyle = style
        alert.messageText = title
        alert.informativeText = detail
        buttons.forEach { alert.addButton(withTitle: $0) }
        NSApp.activate(ignoringOtherApps: true)
        alert.window.level = .modalPanel
        // 押されたボタンの番号（0 始まり）
        return alert.runModal().rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue
    }

    static func confirm(_ title: String, detail: String = "", ok: String = "OK") -> Bool {
        message(style: .warning, title: title, detail: detail, buttons: [ok, "キャンセル"]) == 0
    }

    // 部屋名を入力してもらう（キャンセルなら nil）
    static func askRoomName() -> String? {
        let alert = NSAlert()
        alert.messageText = "Commentable"
        alert.informativeText = "部屋名を入力して入室してください"
        alert.addButton(withTitle: "入室")
        alert.addButton(withTitle: "やめる")
        if let icon = NSImage(named: "AppIcon") ?? Resources.image("icon.app.png") {
            alert.icon = icon
        }

        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
        field.stringValue = generateRoomName()
        alert.accessoryView = field
        alert.window.initialFirstResponder = field
        alert.window.level = .modalPanel

        NSApp.activate(ignoringOtherApps: true)
        while true {
            guard alert.runModal() == .alertFirstButtonReturn else { return nil }
            let room = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if !room.isEmpty { return room }
            NSSound.beep()
        }
    }

    // 配信者の重複入室を防ぐので、他の人と重なりにくいように番号を付ける
    static func generateRoomName() -> String {
        let name1 = ["computer", "design", "art", "human", "410", "interface", "tmu"]
        let name2 = ["room", "class", "conference", "event", "area", "place"]
        return "\(name1.randomElement()!.capitalizedFirst)_\(name2.randomElement()!.capitalizedFirst)_\(Int.random(in: 100..<1000))"
    }
}

private extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}
