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
            Text("コメントを重ねて共有したいウィンドウ（例: PowerPoint のスライドショー）を選んでください。選んだウィンドウにコメントを重ねた「共有用ウィンドウ」が開くので、Zoom などではこの共有用ウィンドウを、アプリのウィンドウとして共有してください。")
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
    let messageLabel = NSTextField(wrappingLabelWithString: "")

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor

        captureLayer.contentsGravity = .resizeAspect
        captureLayer.actions = ["contents": NSNull(), "bounds": NSNull(), "position": NSNull()]
        captureView.layer = captureLayer
        captureView.wantsLayer = true

        messageLabel.textColor = .white
        messageLabel.alignment = .center
        messageLabel.font = .systemFont(ofSize: 15)
        messageLabel.isHidden = true

        for view in [captureView, overlay, messageLabel] as [NSView] {
            view.frame = bounds
            view.autoresizingMask = [.width, .height]
            addSubview(view)
        }
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layout() {
        super.layout()
        messageLabel.frame = bounds.insetBy(dx: 24, dy: bounds.height / 2 - 40)
    }

    func showMessage(_ text: String?) {
        messageLabel.stringValue = text ?? ""
        messageLabel.isHidden = text == nil
    }
}

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
    private var sizeTimer: Timer?
    private var activity: NSObjectProtocol?

    var targetDescription: String {
        let app = target.owningApplication?.applicationName ?? ""
        let title = target.title ?? ""
        return title.isEmpty ? app : "\(app): \(title)"
    }

    init(target: SCWindow, overlays: OverlayGroup) {
        self.target = target
        self.overlays = overlays
        capturedSize = target.frame.size

        window = NSWindow(contentRect: NSRect(origin: .zero, size: Self.initialSize(for: target.frame.size)),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        super.init()
        // Zoom の共有の一覧ではこのタイトルで表示される
        window.title = "Commentable 共有用 – \(targetDescription)"
        window.contentView = content
        window.contentAspectRatio = capturedSize
        window.backgroundColor = .black
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.center()
        overlays.attach(content.overlay)
    }

    // 画面の 7 割に収まる大きさ
    private static func initialSize(for size: CGSize) -> CGSize {
        let visible = NSScreen.main?.visibleFrame.size ?? CGSize(width: 1440, height: 900)
        let scale = min(1, visible.width * 0.7 / max(size.width, 1), visible.height * 0.7 / max(size.height, 1))
        return CGSize(width: round(size.width * scale), height: round(size.height * scale))
    }

    func start() {
        // 共有中はアプリが App Nap で止められないようにする
        activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated], reason: "共有用ウィンドウを表示中")

        let filter = SCContentFilter(desktopIndependentWindow: target)
        let stream = SCStream(filter: filter, configuration: makeConfiguration(), delegate: self)
        do {
            try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        } catch {
            content.showMessage("ウィンドウを取り込めませんでした: \(error.localizedDescription)")
            return
        }
        self.stream = stream
        stream.startCapture { [weak self] error in
            guard let error else { return }
            DispatchQueue.main.async { self?.content.showMessage("ウィンドウを取り込めませんでした: \(error.localizedDescription)") }
        }

        // 対象のウィンドウの大きさが変わったら、取り込む大きさと共有用ウィンドウの縦横比を合わせる
        sizeTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.followTargetSize() }
    }

    private func makeConfiguration() -> SCStreamConfiguration {
        let configuration = SCStreamConfiguration()
        // Retina の解像度で取り込む（長辺は 3840 ピクセルまで）
        let backingScale = NSScreen.screens.map(\.backingScaleFactor).max() ?? 2
        let scale = min(backingScale, 3840 / max(capturedSize.width, capturedSize.height, 1))
        configuration.width = max(2, Int(capturedSize.width * scale))
        configuration.height = max(2, Int(capturedSize.height * scale))
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        configuration.colorSpaceName = CGColorSpace.sRGB
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        configuration.queueDepth = 5
        configuration.showsCursor = true // 共有先でもポインタが見えるように
        return configuration
    }

    private func followTargetSize() {
        guard let info = (CGWindowListCopyWindowInfo([.optionIncludingWindow], target.windowID) as? [[String: Any]])?.first,
              let boundsDict = info[kCGWindowBounds as String] as? NSDictionary,
              let bounds = CGRect(dictionaryRepresentation: boundsDict) else { return }
        let size = bounds.size
        guard abs(size.width - capturedSize.width) > 1 || abs(size.height - capturedSize.height) > 1, size.width > 1, size.height > 1 else { return }
        capturedSize = size
        window.contentAspectRatio = size
        // 幅はそのままで縦横比を合わせる
        var frame = window.frame
        let contentWidth = window.contentRect(forFrameRect: frame).width
        let newContent = window.frameRect(forContentRect: NSRect(x: 0, y: 0, width: contentWidth, height: round(contentWidth * size.height / size.width)))
        frame.origin.y += frame.height - newContent.height
        frame.size.height = newContent.height
        window.setFrame(frame, display: true)
        stream?.updateConfiguration(makeConfiguration()) { error in
            if let error { NSLog("Share window: cannot update configuration: %@", error.localizedDescription) }
        }
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
            guard let self else { return }
            // IOSurface をそのままレイヤーに載せる（コピーしないので軽い）
            self.content.captureLayer.contents = surface
            self.content.showMessage(nil)
        }
    }

    // ========== SCStreamDelegate ==========
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        DispatchQueue.main.async { [weak self] in
            self?.sizeTimer?.invalidate()
            self?.content.showMessage("ウィンドウを取り込めなくなりました（ウィンドウが閉じられた可能性があります）。\nメニューの「共有用ウィンドウ...」から選び直してください。")
        }
    }

    // ========== NSWindowDelegate ==========
    func windowWillClose(_ notification: Notification) {
        sizeTimer?.invalidate()
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
