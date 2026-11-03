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

    // 部屋名を入力するか、前に入った部屋（recentRooms。最後に入った順）から選んでもらう（キャンセルなら nil）
    static func askRoomName(recentRooms: [String] = []) -> String? {
        let alert = NSAlert()
        alert.messageText = "Commentable"
        alert.informativeText = recentRooms.isEmpty
            ? "部屋名を入力して入室してください"
            : "前に入った部屋を一覧から選ぶか、新しい部屋名を入力して入室してください。\n前に入った部屋は、前回の設定で始まります。"
        alert.addButton(withTitle: "入室")
        alert.addButton(withTitle: "やめる")
        alert.addButton(withTitle: "新しい部屋名")
        if let icon = NSImage(named: "AppIcon") ?? Resources.image("icon.app.png") {
            alert.icon = icon
        }

        let field = NSComboBox(frame: NSRect(x: 0, y: 0, width: 300, height: 26))
        field.addItems(withObjectValues: recentRooms)
        field.numberOfVisibleItems = min(max(recentRooms.count, 1), 12)
        field.completes = true
        field.stringValue = recentRooms.first ?? generateRoomName()
        alert.accessoryView = field
        alert.window.initialFirstResponder = field
        alert.window.level = .modalPanel

        NSApp.activate(ignoringOtherApps: true)
        while true {
            switch alert.runModal() {
            case .alertFirstButtonReturn:
                let room = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
                if !room.isEmpty { return room }
                NSSound.beep()
            case .alertThirdButtonReturn:
                field.stringValue = generateRoomName()
            default:
                return nil
            }
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
