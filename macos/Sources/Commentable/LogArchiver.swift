import AppKit
import CryptoKit
import Foundation

// ========== 授業ログの保存 ==========
// サーバーの授業ログは保持期間を過ぎると消えるので、配信中に受け取ったものをこの Mac にも保存する
// 保存先: 書類/Commentable/logs/<部屋キー>/<授業回ID>.jsonl（サーバーと同じ形式）
final class LogArchiver {
    private var archivedEventIDs: [URL: Set<String>] = [:] // ファイル → 保存済みの event_id
    private let sessionPattern = try! NSRegularExpression(pattern: "^\\d{8}-\\d{6}$")

    // サーバーの event-log.js と同じ規則で部屋名からフォルダ名を作る
    static func roomKey(_ room: String) -> String {
        // JavaScript の正規表現と同じく UTF-16 の単位で置き換える
        let safeUnits = room.utf16.map { unit -> Character in
            if let scalar = Unicode.Scalar(unit), scalar.isASCII,
               CharacterSet.alphanumerics.contains(scalar) || scalar == "_" || scalar == "-" {
                return Character(scalar)
            }
            return "_"
        }
        let safe = String(safeUnits.prefix(40))
        if safe == room { return safe }
        let hash = Insecure.SHA1.hash(data: Data(room.utf8)).map { String(format: "%02x", $0) }.joined()
        return "\(safe)_\(hash.prefix(8))"
    }

    func archive(_ events: [Any]) {
        for case let event as [String: Any] in events {
            guard let room = event["room"] as? String,
                  let sessionID = event["session_id"] as? String,
                  sessionPattern.firstMatch(in: sessionID, range: NSRange(sessionID.startIndex..., in: sessionID)) != nil else { continue }
            let dir = AppConfig.logArchiveDirectory.appendingPathComponent(Self.roomKey(room), isDirectory: true)
            let file = dir.appendingPathComponent("\(sessionID).jsonl")
            let eventID = event["event_id"].map { "\($0)" } ?? ""

            var ids = archivedEventIDs[file] ?? loadEventIDs(file)
            if ids.contains(eventID) { continue }
            do {
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                var line = try JSONSerialization.data(withJSONObject: event, options: [.sortedKeys, .withoutEscapingSlashes])
                line.append(0x0A)
                if let handle = try? FileHandle(forWritingTo: file) {
                    handle.seekToEndOfFile()
                    handle.write(line)
                    try handle.close()
                } else {
                    try line.write(to: file)
                }
                ids.insert(eventID)
            } catch {
                NSLog("Error archiving log event: %@", error.localizedDescription)
            }
            archivedEventIDs[file] = ids
        }
    }

    // 既存のファイルに保存済みのものは書かない（再接続で同じログが届くため）
    private func loadEventIDs(_ file: URL) -> Set<String> {
        guard let text = try? String(contentsOf: file, encoding: .utf8) else { return [] }
        var ids = Set<String>()
        for line in text.split(separator: "\n") {
            if let data = line.data(using: .utf8),
               let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let id = object["event_id"] {
                ids.insert("\(id)")
            }
        }
        return ids
    }

    static func openFolder() {
        try? FileManager.default.createDirectory(at: AppConfig.logArchiveDirectory, withIntermediateDirectories: true)
        NSWorkspace.shared.open(AppConfig.logArchiveDirectory)
    }
}
