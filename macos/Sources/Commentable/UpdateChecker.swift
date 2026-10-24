import AppKit
import Security

// ========== アップデート ==========
// GitHub のリリースから macOS 版の最新バージョンを探し、新しければ裏でダウンロードしておき、
// 「再起動」でアプリを入れ替える（Electron 版の自動アップデートと同じ使い勝手）
//   - ダウンロードしたアプリは、自分と同じ署名の条件（同じバンドル ID・同じチームの Developer ID）を
//     満たすときだけ受け付ける
//   - 「あとで」を選んだときは、アプリを終了するときに入れ替える
//   - 入れ替えられないとき（書き込めない場所・ダウンロードフォルダから直接起動・開発用のビルド）は
//     ダウンロードページを案内する
final class UpdateChecker {
    private struct Release: Decodable {
        struct Asset: Decodable {
            let name: String
            let browser_download_url: String
        }
        let tag_name: String
        let html_url: String
        let draft: Bool
        let prerelease: Bool
        let assets: [Asset]

        var version: String { tag_name.hasPrefix("v") ? String(tag_name.dropFirst()) : tag_name }
        var asset: Asset? { assets.first { $0.name.contains(AppConfig.releaseAssetMarker) && $0.name.hasSuffix(".zip") } }
    }

    // ダウンロードして確認済みの新しいバージョン
    struct ReadyUpdate {
        let version: String
        let app: URL
    }

    private static let lastCheckKey = "update.lastCheck"
    private var checking = false
    private(set) var ready: ReadyUpdate?
    private var installOnQuit = false

    // 起動時に1日1回だけ確認する（新しいバージョンがあるときだけ知らせる）
    func checkInBackground() {
        let last = UserDefaults.standard.double(forKey: Self.lastCheckKey)
        guard Date().timeIntervalSince1970 - last > 24 * 60 * 60 else { return }
        check(manual: false)
    }

    // manual: メニューから確認したとき（最新でも結果を知らせる）
    // installImmediately: 確認せずに入れ替えて再起動する（--update-now で起動したとき。動作確認用）
    func check(manual: Bool, installImmediately: Bool = false) {
        if let ready {
            installImmediately ? install(ready, relaunch: true) : promptRestart(ready)
            return
        }
        guard !checking else { return }
        checking = true
        fetchLatestRelease { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure(let error):
                self.checking = false
                if manual {
                    Dialogs.message(style: .warning, title: "アップデートを確認できませんでした", detail: error.localizedDescription)
                }
            case .success(let latest):
                UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: Self.lastCheckKey)
                guard let latest, Self.compare(latest.version, AppConfig.version) > 0 else {
                    self.checking = false
                    if manual {
                        Dialogs.message(title: "最新のバージョンです", detail: "現在のバージョン: \(AppConfig.version)")
                    }
                    return
                }
                self.download(latest, manual: manual, installImmediately: installImmediately)
            }
        }
    }

    private func fetchLatestRelease(_ completion: @escaping (Result<Release?, Error>) -> Void) {
        var request = URLRequest(url: URL(string: "https://api.github.com/repos/\(AppConfig.githubRepository)/releases?per_page=30")!)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 15
        URLSession.shared.dataTask(with: request) { data, response, error in
            DispatchQueue.main.async {
                guard let data, (response as? HTTPURLResponse)?.statusCode == 200,
                      let releases = try? JSONDecoder().decode([Release].self, from: data) else {
                    completion(.failure(error ?? Self.error("GitHub に接続できませんでした。")))
                    return
                }
                // macOS 版の添付ファイルがある公開済みのリリースのうち、いちばん新しいもの
                let latest = releases
                    .filter { !$0.draft && !$0.prerelease && $0.asset != nil }
                    .max { Self.compare($0.version, $1.version) < 0 }
                completion(.success(latest))
            }
        }.resume()
    }

    // ========== ダウンロードと確認 ==========
    private func download(_ release: Release, manual: Bool, installImmediately: Bool) {
        guard let asset = release.asset, let url = URL(string: asset.browser_download_url), Self.canReplaceApp else {
            checking = false
            showDownloadPage(release)
            return
        }
        URLSession.shared.downloadTask(with: url) { [weak self] file, response, error in
            // 一時ファイルはこの中でしか使えないので、先に展開する
            let result = Result(catching: { () -> URL in
                guard let file, (response as? HTTPURLResponse)?.statusCode == 200 else {
                    throw error ?? Self.error("ダウンロードできませんでした。")
                }
                return try Self.extractAndVerify(zip: file, version: release.version)
            })
            DispatchQueue.main.async {
                guard let self else { return }
                self.checking = false
                switch result {
                case .success(let app):
                    let update = ReadyUpdate(version: release.version, app: app)
                    self.ready = update
                    installImmediately ? self.install(update, relaunch: true) : self.promptRestart(update)
                case .failure(let error):
                    NSLog("Update: %@", error.localizedDescription)
                    self.showDownloadPage(release, reason: error.localizedDescription)
                }
            }
        }.resume()
    }

    // zip を展開し、中のアプリが自分と同じ署名の条件を満たすかを確かめる
    private static func extractAndVerify(zip: URL, version: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("CommentableUpdate-\(version)-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let ditto = Process()
        ditto.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        ditto.arguments = ["-x", "-k", zip.path, dir.path]
        try ditto.run()
        ditto.waitUntilExit()
        guard ditto.terminationStatus == 0,
              let app = try FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil).first(where: { $0.pathExtension == "app" })
        else { throw error("ダウンロードしたファイルを展開できませんでした。") }

        let info = Bundle(url: app)?.infoDictionary
        guard info?["CFBundleIdentifier"] as? String == Bundle.main.bundleIdentifier,
              info?["CFBundleShortVersionString"] as? String == version else {
            throw error("ダウンロードしたアプリの内容が想定と違います。")
        }
        guard satisfiesOwnSignature(app) else {
            throw error("ダウンロードしたアプリの署名を確認できませんでした。")
        }
        return app
    }

    // 自分の署名の条件（designated requirement）を、新しいアプリが満たすか
    // 開発用のアドホック署名のビルドは条件が自分自身にしか合わないので、入れ替えは行われない
    private static func satisfiesOwnSignature(_ app: URL) -> Bool {
        var selfCode: SecCode?
        var selfStatic: SecStaticCode?
        var requirement: SecRequirement?
        var newCode: SecStaticCode?
        guard SecCodeCopySelf([], &selfCode) == errSecSuccess, let selfCode,
              SecCodeCopyStaticCode(selfCode, [], &selfStatic) == errSecSuccess, let selfStatic,
              SecCodeCopyDesignatedRequirement(selfStatic, [], &requirement) == errSecSuccess, let requirement,
              SecStaticCodeCreateWithPath(app as CFURL, [], &newCode) == errSecSuccess, let newCode else { return false }
        let flags = SecCSFlags(rawValue: kSecCSCheckAllArchitectures | kSecCSStrictValidate | kSecCSCheckNestedCode)
        return SecStaticCodeCheckValidity(newCode, flags, requirement) == errSecSuccess
    }

    // アプリを置いている場所に書き込めるか（ダウンロードしてすぐ起動したときの一時的な場所＝App Translocation は不可）
    private static var canReplaceApp: Bool {
        let app = Bundle.main.bundleURL
        guard app.pathExtension == "app", !app.path.contains("/AppTranslocation/") else { return false }
        return FileManager.default.isWritableFile(atPath: app.deletingLastPathComponent().path)
            && FileManager.default.isWritableFile(atPath: app.path)
    }

    // ========== 入れ替え ==========
    private func promptRestart(_ update: ReadyUpdate) {
        let response = Dialogs.message(title: "新しいバージョンがあります",
                                       detail: "Commentable \(update.version) をダウンロードしました（現在のバージョン: \(AppConfig.version)）。\n\n再起動すると新しいバージョンに更新されます。「あとで」を選んだときは、Commentable を終了するときに更新されます。",
                                       buttons: ["再起動", "あとで"])
        if response == 0 {
            install(update, relaunch: true)
        } else {
            installOnQuit = true
        }
    }

    // アプリの終了時に呼ぶ（「あとで」を選んでいたら入れ替える）
    func applicationWillTerminate() {
        if installOnQuit, let ready {
            startInstaller(ready, relaunch: false)
        }
    }

    private func install(_ update: ReadyUpdate, relaunch: Bool) {
        installOnQuit = false
        guard startInstaller(update, relaunch: relaunch) else {
            Dialogs.message(style: .warning, title: "アップデートできませんでした", detail: "GitHub のリリースページから新しいバージョンをダウンロードしてください。")
            NSWorkspace.shared.open(URL(string: "https://github.com/\(AppConfig.githubRepository)/releases/latest")!)
            return
        }
        ready = nil
        NSApp.terminate(nil)
    }

    // アプリが終了するのを待ってから入れ替えるスクリプトを起動する
    // （置き場所と名前はそのまま。Electron 版から移行した commentable-desktop.app もそのまま入れ替える）
    @discardableResult
    private func startInstaller(_ update: ReadyUpdate, relaunch: Bool) -> Bool {
        // ダウンロードしてから時間がたっていることがあるので、入れ替える直前にもう一度署名を確かめる
        guard Self.satisfiesOwnSignature(update.app) else {
            NSLog("Update: the downloaded app no longer satisfies the signature requirement")
            return false
        }
        let script = """
        pid="$1"; new="$2"; dest="$3"; relaunch="$4"
        while kill -0 "$pid" 2> /dev/null; do sleep 0.2; done
        backup="$dest.updating-$$"
        if mv "$dest" "$backup"; then
            if mv "$new" "$dest" || ditto "$new" "$dest"; then
                rm -rf "$backup"
            else
                rm -rf "$dest"; mv "$backup" "$dest"
            fi
        fi
        xattr -dr com.apple.quarantine "$dest" 2> /dev/null
        if [ "$relaunch" = 1 ]; then open "$dest"; fi
        """
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = ["-c", script, "commentable-updater",
                             String(ProcessInfo.processInfo.processIdentifier), update.app.path, Bundle.main.bundleURL.path, relaunch ? "1" : "0"]
        do {
            try process.run() // アプリが終了しても動き続ける
            return true
        } catch {
            NSLog("Update: cannot start installer: %@", error.localizedDescription)
            return false
        }
    }

    // 自動で入れ替えられないときは、これまでどおりダウンロードページを案内する
    private func showDownloadPage(_ release: Release, reason: String? = nil) {
        var detail = "Commentable \(release.version) が公開されています（現在のバージョン: \(AppConfig.version)）。\n\nダウンロードした zip を展開して、今お使いの \(Bundle.main.bundleURL.lastPathComponent) と入れ替えてください。"
        if let reason { detail += "\n\n（自動で更新できませんでした: \(reason)）" }
        let response = Dialogs.message(title: "新しいバージョンがあります", detail: detail, buttons: ["ダウンロードページを開く", "あとで"])
        if response == 0, let url = URL(string: release.html_url) {
            NSWorkspace.shared.open(url)
        }
    }

    private static func error(_ message: String) -> Error {
        NSError(domain: "Update", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    // "1.10.0" と "1.9.2" のような数字の並びを比べる
    static func compare(_ a: String, _ b: String) -> Int {
        let x = a.split(separator: ".").map { Int($0) ?? 0 }
        let y = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(x.count, y.count) {
            let l = i < x.count ? x[i] : 0, r = i < y.count ? y[i] : 0
            if l != r { return l < r ? -1 : 1 }
        }
        return 0
    }
}
