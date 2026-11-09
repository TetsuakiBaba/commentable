import Foundation
import SwiftUI

// 部屋ごとの設定。入室したときに、前回その部屋で使っていたメニューの設定に戻す
// 古いバージョンで保存したものや、まだ保存していない項目も読めるように、すべて省略できる（nil なら既定値）
struct RoomSettings: Codable {
    var lastEntered: Date?
    var qrPosition: String?
    var commentControl: Bool? // 投稿制限解除（既定は制限なし）
    var clock: Bool?
    var showNames: Bool? // コメントに参加者の表示名を付ける（既定は付ける）
    var soundMuted: Bool?
    var displayID: UInt32?
    var camera: Bool?
    var cameraDeviceID: String?
    var cameraPosition: String?
    var cameraSize: String?
    var segmentation: Bool?
    var segmentationQuality: String?
    var cameraResolution: String?
    var transcription: Bool?
    var showCaptions: Bool?
    var captionStyle: String?
}

enum RoomSettingsStore {
    private static let defaultsKey = "roomSettings"
    // 一覧から削除した部屋。鍵は消さないので、部屋名を入力すればまた入れる（入ると一覧に戻る）
    private static let hiddenKey = "hiddenRooms"

    private static var hidden: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: hiddenKey) ?? []) }
        set { UserDefaults.standard.set(newValue.sorted(), forKey: hiddenKey) }
    }

    private static func all() -> [String: RoomSettings] {
        guard let data = UserDefaults.standard.data(forKey: defaultsKey),
              let settings = try? JSONDecoder().decode([String: RoomSettings].self, from: data) else { return [:] }
        return settings
    }

    static func load(_ room: String) -> RoomSettings? {
        all()[room]
    }

    static func save(_ settings: RoomSettings, for room: String) {
        if settings.lastEntered != nil, hidden.contains(room) { hidden.remove(room) }
        var stored = all()
        stored[room] = settings
        if let data = try? JSONEncoder().encode(stored) {
            UserDefaults.standard.set(data, forKey: defaultsKey)
        }
    }

    // 入室したことのある部屋（最後に入った順）。配信者の鍵がある部屋（別の Mac や Electron 版で入った部屋）も含める
    static func recentRooms() -> [String] {
        entries().map(\.room)
    }

    static func entries() -> [(room: String, lastEntered: Date?)] {
        let stored = all()
        let rooms = Set(stored.keys).union(HostKeyStore.rooms()).subtracting(hidden)
        return rooms.map { (room: $0, lastEntered: stored[$0]?.lastEntered) }.sorted { a, b in
            let dateA = a.lastEntered ?? .distantPast
            let dateB = b.lastEntered ?? .distantPast
            return dateA != dateB ? dateA > dateB : a.room.localizedStandardCompare(b.room) == .orderedAscending
        }
    }

    // 一覧から削除する（その部屋の設定も消す）
    static func remove(_ rooms: Set<String>) {
        hidden.formUnion(rooms)
        var stored = all()
        rooms.forEach { stored[$0] = nil }
        if let data = try? JSONEncoder().encode(stored) {
            UserDefaults.standard.set(data, forKey: defaultsKey)
        }
    }
}

// ========== 部屋の一覧の整理 ==========
// 入室のダイアログに出す部屋の一覧から、使っていない部屋を削除する
struct RoomListView: View {
    var currentRoom: String?
    var onClose: () -> Void

    @State private var entries = RoomSettingsStore.entries()
    @State private var selected = Set<String>()

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("部屋の一覧を整理").font(.title).bold()
            Text("入室のときに出す一覧から削除します。配信者の鍵は残すので、部屋名を入力すればまた入れます（入ると一覧に戻ります）。")
                .font(.callout).foregroundColor(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            List(entries, id: \.room) { entry in
                Toggle(isOn: binding(for: entry.room)) {
                    HStack {
                        Text(entry.room)
                        Spacer()
                        Text(entry.room == currentRoom ? "入室中"
                             : entry.lastEntered.map { "最後に入室: \(Self.dateFormatter.string(from: $0))" } ?? "このアプリで入室した記録なし")
                            .foregroundColor(.secondary)
                    }
                }
                .disabled(entry.room == currentRoom)
            }
            .frame(minHeight: 260)

            HStack {
                Button("入室の記録がない部屋を選ぶ") {
                    selected.formUnion(entries.filter { $0.lastEntered == nil && $0.room != currentRoom }.map(\.room))
                }
                Button("選択を解除") { selected.removeAll() }.disabled(selected.isEmpty)
                Spacer()
                Button("選んだ \(selected.count) 件を削除", action: remove).disabled(selected.isEmpty)
                Button("閉じる", action: onClose).keyboardShortcut(.cancelAction)
            }
        }
        .padding(24)
        .frame(width: 600, height: 520)
    }

    private func binding(for room: String) -> Binding<Bool> {
        Binding(get: { selected.contains(room) },
                set: { isOn in if isOn { selected.insert(room) } else { selected.remove(room) } })
    }

    private func remove() {
        guard Dialogs.confirm("\(selected.count) 件の部屋を一覧から削除しますか？", ok: "削除") else { return }
        RoomSettingsStore.remove(selected)
        selected.removeAll()
        entries = RoomSettingsStore.entries()
    }
}
