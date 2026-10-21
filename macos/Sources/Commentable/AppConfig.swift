import Foundation

// アプリ全体の設定値
enum AppConfig {
    static let productionServer = "https://commentable.onrender.com"
    static let localServer = "http://localhost:3000"

    // 接続先サーバー
    // 既定は本番環境。ローカルで試すときは環境変数か defaults で切り替える
    //   COMMENTABLE_SERVER_URL=http://localhost:3000 open Commentable.app
    //   defaults write com.electron.commentable-desktop serverURL http://localhost:3000
    static let serverURL: String = {
        if let env = ProcessInfo.processInfo.environment["COMMENTABLE_SERVER_URL"], !env.isEmpty {
            return trimSlash(env)
        }
        if let saved = UserDefaults.standard.string(forKey: "serverURL"), !saved.isEmpty {
            return trimSlash(saved)
        }
        return productionServer
    }()

    // バージョンは macos/VERSION で管理し、build.sh が Info.plist に書き込む
    // swift run で起動したとき（Info.plist がない）は VERSION ファイルを直接読む
    static let version: String = {
        if let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String { return version }
        let file = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("VERSION")
        return (try? String(contentsOf: file, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "0.0.0"
    }()
    static let copyrightYear: String = Bundle.main.object(forInfoDictionaryKey: "CommentableCopyrightYear") as? String
        ?? String(Calendar.current.component(.year, from: Date()))

    static let homepage = "https://tetsuakibaba.github.io/commentable/"

    // リリースを置いている GitHub のリポジトリ
    static let githubRepository = "TetsuakiBaba/commentable"
    // macOS 版のリリースの添付ファイル名（Commentable-darwin-universal-<バージョン>.zip）
    // Electron 版の自動アップデート（update.electronjs.org）は「-darwin-universal」を含む zip を
    // Apple Silicon / Intel 両方の更新として配るので、Electron 版のユーザーはこの zip で Swift 版に入れ替わる
    static let releaseAssetMarker = "-darwin-universal-"

    // Electron 版と同じデータフォルダ（~/Library/Application Support/commentable-desktop）
    // 配信者の鍵を共有するので、Electron 版と Swift 版を切り替えても同じ部屋に入れる
    static let sharedDataDirectory: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("commentable-desktop", isDirectory: true)
    }()

    // 授業ログの保存先: 書類/Commentable/logs
    static let logArchiveDirectory: URL = {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return documents.appendingPathComponent("Commentable/logs", isDirectory: true)
    }()

    private static func trimSlash(_ url: String) -> String {
        url.hasSuffix("/") ? String(url.dropLast()) : url
    }
}

// JavaScript の encodeURI と同じ文字を残す（QR コードと投稿ページの URL に使う）
extension String {
    var encodedURI: String {
        var allowed = CharacterSet.alphanumerics.intersection(CharacterSet(charactersIn: Unicode.Scalar(0)...Unicode.Scalar(127)))
        allowed.insert(charactersIn: ";,/?:@&=+$-_.!~*'()#")
        return addingPercentEncoding(withAllowedCharacters: allowed) ?? self
    }

    // encodeURIComponent 相当
    var encodedURIComponent: String {
        var allowed = CharacterSet.alphanumerics.intersection(CharacterSet(charactersIn: Unicode.Scalar(0)...Unicode.Scalar(127)))
        allowed.insert(charactersIn: "-_.!~*'()")
        return addingPercentEncoding(withAllowedCharacters: allowed) ?? self
    }
}
