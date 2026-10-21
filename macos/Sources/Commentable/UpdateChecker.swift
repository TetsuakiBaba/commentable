import AppKit

// ========== アップデートの確認 ==========
// GitHub のリリースから macOS 版の最新バージョンを探し、新しければダウンロードページを案内する
// （Electron 版のような自動ダウンロード・入れ替えはしない）
final class UpdateChecker {
    private struct Release: Decodable {
        struct Asset: Decodable {
            let name: String
        }
        let tag_name: String
        let html_url: String
        let draft: Bool
        let prerelease: Bool
        let assets: [Asset]
    }

    private static let lastCheckKey = "update.lastCheck"
    private var checking = false

    // 起動時に1日1回だけ確認する（新しいバージョンがあるときだけ知らせる）
    func checkInBackground() {
        let last = UserDefaults.standard.double(forKey: Self.lastCheckKey)
        guard Date().timeIntervalSince1970 - last > 24 * 60 * 60 else { return }
        check(manual: false)
    }

    // manual: メニューから確認したとき（最新でも結果を知らせる）
    func check(manual: Bool) {
        guard !checking else { return }
        checking = true
        var request = URLRequest(url: URL(string: "https://api.github.com/repos/\(AppConfig.githubRepository)/releases?per_page=30")!)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 15
        URLSession.shared.dataTask(with: request) { data, response, error in
            DispatchQueue.main.async {
                self.checking = false
                guard let data, (response as? HTTPURLResponse)?.statusCode == 200,
                      let releases = try? JSONDecoder().decode([Release].self, from: data) else {
                    if manual {
                        Dialogs.message(style: .warning, title: "アップデートを確認できませんでした",
                                        detail: error?.localizedDescription ?? "GitHub に接続できませんでした。")
                    }
                    return
                }
                UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: Self.lastCheckKey)
                self.handle(releases, manual: manual)
            }
        }.resume()
    }

    private func handle(_ releases: [Release], manual: Bool) {
        // macOS 版の添付ファイルがある公開済みのリリースのうち、いちばん新しいもの
        let latest = releases
            .filter { !$0.draft && !$0.prerelease && $0.assets.contains { $0.name.contains(AppConfig.releaseAssetMarker) && $0.name.hasSuffix(".zip") } }
            .max { Self.compare(Self.version(of: $0.tag_name), Self.version(of: $1.tag_name)) < 0 }

        guard let latest, Self.compare(Self.version(of: latest.tag_name), AppConfig.version) > 0 else {
            if manual {
                Dialogs.message(title: "最新のバージョンです", detail: "現在のバージョン: \(AppConfig.version)")
            }
            return
        }
        let response = Dialogs.message(title: "新しいバージョンがあります",
                                       detail: "Commentable \(Self.version(of: latest.tag_name)) が公開されています（現在のバージョン: \(AppConfig.version)）。\n\nダウンロードした zip を展開して、アプリケーションフォルダの Commentable と入れ替えてください。",
                                       buttons: ["ダウンロードページを開く", "あとで"])
        if response == 0, let url = URL(string: latest.html_url) {
            NSWorkspace.shared.open(url)
        }
    }

    private static func version(of tag: String) -> String {
        tag.hasPrefix("v") ? String(tag.dropFirst()) : tag
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
