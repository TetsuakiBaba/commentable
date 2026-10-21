import AppKit

// .app に同梱した効果音・画像を探す
// swift run で直接起動したときは macos/Resources のファイルを使う
enum Resources {
    private static let fallbackRoot: URL = {
        // .../macos/Sources/Commentable/Resources.swift → .../macos/Resources
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Resources", isDirectory: true)
    }()

    static func url(_ subdirectory: String, _ name: String) -> URL? {
        if let resourceURL = Bundle.main.resourceURL {
            let url = resourceURL.appendingPathComponent(subdirectory).appendingPathComponent(name)
            if FileManager.default.fileExists(atPath: url.path) { return url }
        }
        let url = fallbackRoot.appendingPathComponent(subdirectory).appendingPathComponent(name)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    static func sound(_ name: String) -> URL? { url("sounds", name) }

    static func image(_ name: String) -> NSImage? {
        url("images", name).flatMap { NSImage(contentsOf: $0) }
    }
}
