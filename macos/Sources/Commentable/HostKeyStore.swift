import AppKit
import CryptoKit
import Foundation

// ========== 配信者の鍵 ==========
// 部屋ごとに秘密の鍵を作って保存する。最初に入室したアプリの鍵がサーバーに登録され、
// 同じ部屋名で別のアプリ（なりすまし）が配信画面として入室することを防ぐ。
// ダッシュボードには鍵から作ったトークンを渡す（サーバーの room-auth.js と同じ式）
//
// 鍵のファイルは保存場所を変えられる。Dropbox や iCloud Drive の同じフォルダを選べば、
// 別の Mac / PC でも同じ鍵を使って同じ部屋で配信できる
// ファイルの形式と既定の場所は Electron 版と同じ
enum HostKeyStore {
    struct DirectoryMissing: Error {
        let path: String
    }

    private static let appSettingsFile = AppConfig.sharedDataDirectory.appendingPathComponent("app-settings.json")
    private static let defaultKeysFile = AppConfig.sharedDataDirectory.appendingPathComponent("host-keys.json")
    private static let sharedKeysFilename = "commentable-host-keys.json"

    // ========== アプリの設定（Electron 版と共有） ==========
    private static func loadAppSettings() -> [String: Any] {
        guard let data = try? Data(contentsOf: appSettingsFile),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return object
    }

    private static func saveAppSettings(_ patch: [String: Any?]) {
        var settings = loadAppSettings()
        for (key, value) in patch {
            settings[key] = value ?? NSNull()
        }
        do {
            try FileManager.default.createDirectory(at: AppConfig.sharedDataDirectory, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: settings, options: [.prettyPrinted, .withoutEscapingSlashes])
            try data.write(to: appSettingsFile)
        } catch {
            NSLog("Error saving app settings: %@", error.localizedDescription)
        }
    }

    // 鍵の保存フォルダ（nil なら既定の場所）
    static var directory: String? {
        loadAppSettings()["hostKeysDir"] as? String
    }

    static func keysFile(in dir: String? = directory) -> URL {
        if let dir { return URL(fileURLWithPath: dir).appendingPathComponent(sharedKeysFilename) }
        return defaultKeysFile
    }

    private static func readKeys(_ file: URL) -> [String: String] {
        guard let data = try? Data(contentsOf: file),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: String] else { return [:] }
        return object
    }

    private static func writeKeys(_ file: URL, _ keys: [String: String]) throws {
        let data = try JSONSerialization.data(withJSONObject: keys, options: [.prettyPrinted, .sortedKeys])
        // 最初から本人だけが読めるファイルとして書き、置き換える（書いた直後に他の人が読める瞬間を作らない）
        let temporary = file.deletingLastPathComponent().appendingPathComponent(".\(file.lastPathComponent).\(UUID().uuidString)")
        guard FileManager.default.createFile(atPath: temporary.path, contents: data, attributes: [.posixPermissions: 0o600]) else {
            throw CocoaError(.fileWriteUnknown)
        }
        do {
            if FileManager.default.fileExists(atPath: file.path) {
                _ = try FileManager.default.replaceItemAt(file, withItemAt: temporary)
            } else {
                try FileManager.default.moveItem(at: temporary, to: file)
            }
        } catch {
            try? FileManager.default.removeItem(at: temporary)
            throw error
        }
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }

    // 部屋の鍵を返す（なければ作る）。保存先のフォルダが見つからないときは例外を投げる
    // （同期前の共有フォルダで新しい鍵を作ると、自分の部屋に入れなくなるため）
    static func key(for room: String) throws -> String {
        let dir = directory
        if let dir, !FileManager.default.fileExists(atPath: dir) {
            throw DirectoryMissing(path: dir)
        }
        let file = keysFile(in: dir)
        if let key = readKeys(file)[room] { return key }

        // 他の Mac / PC が同じファイルに書いている可能性があるので、書く直前に読み直して追記する
        var latest = readKeys(file)
        if let key = latest[room] { return key }
        let key = randomKey()
        latest[room] = key
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try writeKeys(file, latest)
        return key
    }

    // Node の crypto.randomBytes(32).toString('base64url') と同じ形式
    private static func randomKey() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func dashboardToken(for hostKey: String) -> String {
        SHA256.hash(data: Data("commentable-dashboard:\(hostKey)".utf8)).map { String(format: "%02x", $0) }.joined()
    }

    // 鍵を新しい保存場所に移す。両方に同じ部屋の鍵があるときは、移動先（共有フォルダ）の鍵を使う
    // 移した後の鍵の一覧を返す（失敗したら nil）
    @discardableResult
    static func move(to newDir: String?) -> [String: String]? {
        let fromFile = keysFile()
        let toFile = keysFile(in: newDir)
        if fromFile == toFile { return readKeys(toFile) }
        let current = FileManager.default.fileExists(atPath: fromFile.deletingLastPathComponent().path) ? readKeys(fromFile) : [:]
        let destination = readKeys(toFile)
        let conflicts = current.keys.filter { room in destination[room] != nil && destination[room] != current[room] }.sorted()
        let merged = current.merging(destination) { _, dest in dest }
        do {
            try FileManager.default.createDirectory(at: toFile.deletingLastPathComponent(), withIntermediateDirectories: true)
            try writeKeys(toFile, merged)
        } catch {
            Dialogs.message(style: .critical, title: "鍵を保存できませんでした", detail: error.localizedDescription)
            return nil
        }
        saveAppSettings(["hostKeysDir": newDir])

        var detail = "保存場所: \(toFile.path)\n部屋の鍵: \(merged.count) 件"
        if newDir != nil {
            detail += "\n\n別の Mac / PC でも同じフォルダを選ぶと、同じ部屋で配信できます。"
        }
        if !conflicts.isEmpty {
            detail += "\n\n次の部屋は、移動先にあった鍵を使います（この Mac で使っていた鍵とは別のものです）:\n" + conflicts.joined(separator: "\n")
        }
        Dialogs.message(style: .informational, title: "配信者の鍵の保存場所を変更しました", detail: detail)
        return merged
    }

    // フォルダを選んでもらって鍵を移す
    @discardableResult
    static func chooseDirectory() -> [String: String]? {
        let panel = NSOpenPanel()
        panel.title = "配信者の鍵の保存場所を選択"
        panel.message = "Dropbox や iCloud Drive のフォルダを選ぶと、別の Mac / PC と鍵を共有できます"
        panel.prompt = "このフォルダに保存"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let url = panel.url else { return nil }
        return move(to: url.path)
    }

    static func revealKeysFile() {
        let file = keysFile()
        if FileManager.default.fileExists(atPath: file.path) {
            NSWorkspace.shared.activateFileViewerSelecting([file])
        } else {
            NSWorkspace.shared.open(file.deletingLastPathComponent())
        }
    }
}
