import AppKit
import ScreenCaptureKit
import SwiftUI

// ========== 共有用ウィンドウ ==========
// Zoom などでアプリのウィンドウだけを共有すると、画面全体に重ねたコメントは映らない
// （共有されるのはそのウィンドウの中身だけ）。そこで対象のウィンドウ（例: PowerPoint）を
// ScreenCaptureKit で取り込み、その映像にコメントを重ねたウィンドウを作って、こちらを共有してもらう

// 画面収録の許可（なければ設定を案内する）
enum ScreenCapturePermission {
    static func ensure() -> Bool {
        if CGPreflightScreenCaptureAccess() { return true }
        if CGRequestScreenCaptureAccess() { return true } // 初回はシステムの確認が出る
        let response = Dialogs.message(style: .warning, title: "画面収録の許可が必要です",
                                       detail: "共有用ウィンドウを作るには、対象のウィンドウを取り込むために「画面収録」の許可が必要です。\n\nシステム設定 > プライバシーとセキュリティ > 画面収録 で Commentable を許可してから、Commentable を起動し直してください。",
                                       buttons: ["システム設定を開く", "閉じる"])
        if response == 0, let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") {
            NSWorkspace.shared.open(url)
        }
        return false
    }
}

// ========== ウィンドウの選択 ==========
@available(macOS 12.3, *)
final class WindowPickerModel: ObservableObject {
    struct Item: Identifiable {
        let window: SCWindow
        let appName: String
        let title: String
        var id: CGWindowID { window.windowID }
        var onScreen: Bool { window.isOnScreen }
    }

    @Published private(set) var items: [Item] = []
    @Published private(set) var loading = false
    @Published private(set) var error: String?

    func reload() {
        loading = true
        // 別のデスクトップにあるウィンドウ（全画面のスライドショーなど）も選べるようにする
        SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: false) { [weak self] content, error in
            DispatchQueue.main.async {
                guard let self else { return }
                self.loading = false
                guard let content else {
                    self.error = error?.localizedDescription ?? "ウィンドウの一覧を取得できませんでした"
                    return
                }
                self.error = nil
                let ownBundleID = Bundle.main.bundleIdentifier
                self.items = content.windows
                    .filter { window in
                        window.windowLayer == 0 // 普通のウィンドウだけ（メニューバーや Dock などを除く）
                            && window.frame.width >= 160 && window.frame.height >= 120
                            && window.owningApplication != nil
                            && window.owningApplication?.bundleIdentifier != ownBundleID
                    }
                    .map { Item(window: $0, appName: $0.owningApplication?.applicationName ?? "", title: $0.title ?? "") }
                    .sorted { a, b in
                        if a.onScreen != b.onScreen { return a.onScreen }
                        if a.appName != b.appName { return a.appName.localizedStandardCompare(b.appName) == .orderedAscending }
                        return a.title.localizedStandardCompare(b.title) == .orderedAscending
                    }
            }
        }
    }
}

@available(macOS 12.3, *)
struct WindowPickerView: View {
    @ObservedObject var model: WindowPickerModel
    var onSelect: (SCWindow) -> Void
    var onCancel: () -> Void
    @State private var selection: CGWindowID?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("共有用ウィンドウ").font(.title).bold()
            Text("コメントを重ねて共有したいウィンドウ（例: PowerPoint のスライドショー）を選んでください。選んだウィンドウにコメントを重ねた「Commentable 共有用」のウィンドウが、そのウィンドウの後ろに用意されます（画面には見えません）。Zoom などではこの「Commentable 共有用」のウィンドウを、アプリのウィンドウとして共有してください。配信者はいつもどおり、選んだウィンドウを操作してください。")
                .fixedSize(horizontal: false, vertical: true)
                .foregroundColor(.secondary)

            if let error = model.error {
                Text(error).foregroundColor(.red)
            }
            List(model.items, selection: $selection) { item in
                HStack {
                    Text(item.appName).bold()
                    Text(item.title.isEmpty ? "（タイトルなし）" : item.title)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                    Spacer()
                    if !item.onScreen {
                        Text("別のデスクトップ・最小化").font(.caption).foregroundColor(.secondary)
                    }
                    Text("\(Int(item.window.frame.width))×\(Int(item.window.frame.height))")
                        .font(.caption).foregroundColor(.secondary)
                }
            }
            .overlay(Group { if model.loading && model.items.isEmpty { ProgressView() } })

            HStack {
                Button("再読み込み") { model.reload() }
                Spacer()
                Button("キャンセル", action: onCancel)
                    .keyboardShortcut(.cancelAction)
                Button("共有用ウィンドウを開く") {
                    if let item = model.items.first(where: { $0.id == selection }) { onSelect(item.window) }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(selection == nil)
            }
        }
        .padding(20)
        .frame(minWidth: 560, minHeight: 460)
        .onAppear { model.reload() }
    }
}

// ========== 共有用ウィンドウ ==========
// 取り込んだ映像（下）とコメントのオーバーレイ（上）を重ねる
private final class ShareContentView: NSView {
    let captureLayer = CALayer()
    private let captureView = NSView()
    let overlay = OverlayView(hoverEnabled: false)

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor

        captureLayer.contentsGravity = .resizeAspect
        captureLayer.actions = ["contents": NSNull(), "bounds": NSNull(), "position": NSNull()]
        captureView.layer = captureLayer
        captureView.wantsLayer = true

        for view in [captureView, overlay] as [NSView] {
            view.frame = bounds
            view.autoresizingMask = [.width, .height]
            addSubview(view)
        }
    }

    required init?(coder: NSCoder) { fatalError() }

}

// 共有用ウィンドウは対象のウィンドウと同じ位置・同じ大きさにして、そのすぐ後ろに隠しておく
// （配信者はデスクトップ上に流れるコメントを見ながら対象のウィンドウをそのまま操作し、
//   Zoom などではこの共有用ウィンドウを共有してもらう）
// 隠れていても ScreenCaptureKit では中身を取り込める。画面の外に置いたり透明にしたりすると取り込めない
@available(macOS 12.3, *)
final class ShareWindowController: NSObject, NSWindowDelegate, SCStreamOutput, SCStreamDelegate {
    let window: NSWindow
    var onClose: (() -> Void)?

    private let target: SCWindow
    private let overlays: OverlayGroup
    private let content = ShareContentView(frame: NSRect(x: 0, y: 0, width: 960, height: 540))
    private var stream: SCStream?
    private let queue = DispatchQueue(label: "commentable.share-capture")
    private var capturedSize: CGSize // 対象のウィンドウの大きさ（ポイント）
    private var captureScale: CGFloat // 対象のウィンドウがあるディスプレイの倍率
    private var followTimer: Timer?
    private var lastOrderCheck = Date.distantPast
    private var activity: NSObjectProtocol?
    private var closing = false

    var targetDescription: String {
        let app = target.owningApplication?.applicationName ?? ""
        let title = target.title ?? ""
        return title.isEmpty ? app : "\(app): \(title)"
    }

    init(target: SCWindow, overlays: OverlayGroup) {
        self.target = target
        self.overlays = overlays
        capturedSize = target.frame.size
        captureScale = Self.screen(containing: Self.cocoaRect(fromCG: target.frame))?.backingScaleFactor ?? 2

        window = NSWindow(contentRect: Self.cocoaRect(fromCG: target.frame), styleMask: [.borderless], backing: .buffered, defer: false)
        super.init()
        // Zoom の共有の一覧ではこのタイトルで表示される（タイトルバーはないので共有先には映らない）
        window.title = "Commentable 共有用 – \(targetDescription)"
        window.contentView = content
        window.backgroundColor = .black
        window.isOpaque = true
        window.hasShadow = false
        window.ignoresMouseEvents = true // 万一見えてもクリックは下に通す
        window.isExcludedFromWindowsMenu = true
        window.animationBehavior = .none
        window.isReleasedWhenClosed = false
        window.delegate = self
        overlays.attach(content.overlay)
    }

    // ========== 座標 ==========
    // CGWindowList / ScreenCaptureKit の座標（メインディスプレイの左上が原点）を AppKit の座標（左下が原点）に
    private static func cocoaRect(fromCG rect: CGRect) -> NSRect {
        let mainHeight = NSScreen.screens.first?.frame.height ?? 0
        return NSRect(x: rect.minX, y: mainHeight - rect.maxY, width: rect.width, height: rect.height)
    }

    // いちばん大きく重なっているディスプレイ
    private static func screen(containing rect: NSRect) -> NSScreen? {
        NSScreen.screens.max { a, b in
            let x = a.frame.intersection(rect), y = b.frame.intersection(rect)
            return (x.isNull ? 0 : x.width * x.height) < (y.isNull ? 0 : y.width * y.height)
        }
    }

    // ========== 開始 ==========
    func start() {
        // 共有中はアプリが App Nap で止められないようにする
        activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated], reason: "共有用ウィンドウで共有中")

        let filter = SCContentFilter(desktopIndependentWindow: target)
        let stream = SCStream(filter: filter, configuration: makeConfiguration(), delegate: self)
        do {
            try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        } catch {
            finish("ウィンドウを取り込めませんでした: \(error.localizedDescription)")
            return
        }
        self.stream = stream
        stream.startCapture { [weak self] error in
            guard let error else { return }
            DispatchQueue.main.async { self?.finish("ウィンドウを取り込めませんでした: \(error.localizedDescription)") }
        }

        followTarget()
        // 対象のウィンドウの位置・大きさ・重なり順に合わせ続ける
        followTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in self?.followTarget() }
        overlays.showNotification("Zoom などで「Commentable 共有用」のウィンドウを共有してください")
    }

    private func makeConfiguration() -> SCStreamConfiguration {
        let configuration = SCStreamConfiguration()
        // 対象のウィンドウがあるディスプレイの解像度で取り込む（長辺は 3840 ピクセルまで）
        // 別の倍率のディスプレイで計算すると、映像が小さく（大きく）取り込まれてしまう
        let scale = min(captureScale, 3840 / max(capturedSize.width, capturedSize.height, 1))
        configuration.width = max(2, Int(capturedSize.width * scale))
        configuration.height = max(2, Int(capturedSize.height * scale))
        configuration.scalesToFit = true // 大きさがずれても、出力いっぱいに合わせる
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        configuration.colorSpaceName = CGColorSpace.sRGB
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        configuration.queueDepth = 5
        configuration.showsCursor = true // 共有先でもポインタが見えるように
        return configuration
    }

    // ========== 対象のウィンドウに合わせる ==========
    private func followTarget() {
        guard !closing else { return }
        guard let info = (CGWindowListCopyWindowInfo([.optionIncludingWindow], target.windowID) as? [[String: Any]])?.first,
              let boundsDict = info[kCGWindowBounds as String] as? NSDictionary,
              let bounds = CGRect(dictionaryRepresentation: boundsDict) else {
            finish("対象のウィンドウが閉じられたので、共有用ウィンドウでの共有を終了しました")
            return
        }
        let onScreen = (info[kCGWindowIsOnscreen as String] as? Bool) ?? false
        let frame = Self.cocoaRect(fromCG: bounds)

        // 全画面表示（専用の操作スペース）でも後ろに入れるように、そのときだけすべてのスペースに出す
        let fullScreen = NSScreen.screens.contains { $0.frame == frame }
        let behavior: NSWindow.CollectionBehavior = fullScreen
            ? [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
            : [.fullScreenAuxiliary, .transient, .ignoresCycle]
        if window.collectionBehavior != behavior { window.collectionBehavior = behavior }

        var moved = false
        if window.frame != frame {
            window.setFrame(frame, display: true)
            moved = true
        }

        // 大きさや表示するディスプレイ（倍率）が変わったら、取り込む大きさを合わせる
        let scale = Self.screen(containing: frame)?.backingScaleFactor ?? captureScale
        if abs(bounds.width - capturedSize.width) > 0.5 || abs(bounds.height - capturedSize.height) > 0.5 || scale != captureScale {
            capturedSize = bounds.size
            captureScale = scale
            stream?.updateConfiguration(makeConfiguration()) { error in
                if let error { NSLog("Share window: cannot update configuration: %@", error.localizedDescription) }
            }
        }

        // 対象のウィンドウのすぐ後ろに置く（見えていないとき＝最小化や別のスペースでは最背面に下げる）
        guard moved || Date().timeIntervalSince(lastOrderCheck) > 0.5 else { return }
        lastOrderCheck = Date()
        if onScreen {
            if !isDirectlyBelowTarget() {
                window.order(.below, relativeTo: Int(target.windowID))
            }
        } else {
            window.orderBack(nil) // 見えていないと Zoom の共有の一覧に出ないので、閉じずに最背面に置く
        }
    }

    private func isDirectlyBelowTarget() -> Bool {
        guard window.isVisible,
              let below = CGWindowListCopyWindowInfo([.optionOnScreenBelowWindow], target.windowID) as? [[String: Any]],
              let next = below.first?[kCGWindowNumber as String] as? Int else { return false }
        return next == window.windowNumber
    }

    // ========== SCStreamOutput ==========
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sampleBuffer.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let rawStatus = attachments.first?[.status] as? Int,
              SCFrameStatus(rawValue: rawStatus) == .complete, // 内容が変わっていないフレーム（idle など）は使わない
              let pixelBuffer = sampleBuffer.imageBuffer,
              let surface = CVPixelBufferGetIOSurface(pixelBuffer)?.takeUnretainedValue() else { return }
        DispatchQueue.main.async { [weak self] in
            // IOSurface をそのままレイヤーに載せる（コピーしないので軽い）
            self?.content.captureLayer.contents = surface
        }
    }

    // ========== SCStreamDelegate ==========
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        DispatchQueue.main.async { [weak self] in
            self?.finish("ウィンドウを取り込めなくなったので、共有用ウィンドウでの共有を終了しました")
        }
    }

    // ========== 終了 ==========
    // 共有用ウィンドウは見えないので、終わった理由はデスクトップの通知で知らせる
    private func finish(_ message: String) {
        guard !closing else { return }
        overlays.showNotification(message)
        close()
    }

    func windowWillClose(_ notification: Notification) {
        closing = true
        followTimer?.invalidate()
        stream?.stopCapture { _ in }
        stream = nil
        overlays.detach(content.overlay)
        if let activity { ProcessInfo.processInfo.endActivity(activity) }
        activity = nil
        onClose?()
    }

    func close() {
        window.close()
    }
}
