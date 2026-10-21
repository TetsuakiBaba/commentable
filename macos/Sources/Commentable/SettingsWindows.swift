import AppKit
import AVFoundation
import SwiftUI

// ========== カメラ設定 ==========
struct CameraSettingsView: View {
    var onClose: () -> Void

    @State private var devices: [AVCaptureDevice] = []
    @State private var selectedID: String? = CameraSettings.deviceID
    @State private var loading = true
    @State private var denied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("カメラ設定").font(.title).bold()
            Text("利用可能なカメラデバイス").font(.headline)

            Group {
                if loading {
                    HStack { ProgressView().controlSize(.small); Text("カメラデバイスを読み込み中...") }
                } else if denied {
                    Text("カメラの使用が許可されていません。システム設定 > プライバシーとセキュリティ > カメラ で許可してください。")
                        .foregroundColor(.red)
                } else if devices.isEmpty {
                    Text("カメラが見つかりませんでした")
                } else {
                    List(devices, id: \.uniqueID, selection: $selectedID) { device in
                        Text(device.localizedName)
                    }
                    .frame(height: 110)
                }
            }

            Text("プレビュー").font(.headline).frame(maxWidth: .infinity)
            ZStack {
                RoundedRectangle(cornerRadius: 8).fill(Color.black.opacity(0.06))
                if let selectedID, !denied {
                    CameraPreview(deviceID: selectedID).cornerRadius(8)
                } else {
                    Text("カメラを選択するとプレビューが表示されます").foregroundColor(.secondary)
                }
            }
            .frame(height: 220)

            HStack {
                Button("設定を保存") {
                    CameraSettings.deviceID = selectedID
                    Dialogs.message(title: "カメラ設定を保存しました")
                    onClose()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(selectedID == nil)
                Button("キャンセル", action: onClose)
                    .keyboardShortcut(.cancelAction)
            }
        }
        .padding(24)
        .frame(width: 600, height: 520)
        .onAppear(perform: load)
    }

    private func load() {
        CameraController.requestAccess { granted in
            denied = !granted
            devices = granted ? CameraSettings.availableDevices() : []
            if let selected = selectedID, !devices.contains(where: { $0.uniqueID == selected }) {
                selectedID = nil
            }
            loading = false
        }
    }
}

// 選んだカメラのプレビュー（設定画面専用のセッション）
struct CameraPreview: NSViewRepresentable {
    let deviceID: String

    final class PreviewView: NSView {
        let session = AVCaptureSession()
        private let previewLayer: AVCaptureVideoPreviewLayer
        private let queue = DispatchQueue(label: "commentable.camera-preview")
        var deviceID: String? {
            didSet { if deviceID != oldValue { restart() } }
        }

        override init(frame: NSRect) {
            previewLayer = AVCaptureVideoPreviewLayer(session: session)
            super.init(frame: frame)
            wantsLayer = true
            previewLayer.videoGravity = .resizeAspect
            layer?.addSublayer(previewLayer)
        }

        required init?(coder: NSCoder) { fatalError() }

        override func layout() {
            super.layout()
            previewLayer.frame = bounds
        }

        private func restart() {
            let deviceID = deviceID
            queue.async { [session] in
                session.beginConfiguration()
                session.inputs.forEach { session.removeInput($0) }
                if let deviceID, let device = AVCaptureDevice(uniqueID: deviceID),
                   let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) {
                    session.addInput(input)
                }
                session.commitConfiguration()
                if !session.isRunning { session.startRunning() }
            }
        }

        func stop() {
            queue.async { [session] in session.stopRunning() }
        }
    }

    func makeNSView(context: Context) -> PreviewView {
        let view = PreviewView(frame: .zero)
        view.deviceID = deviceID
        return view
    }

    func updateNSView(_ view: PreviewView, context: Context) {
        view.deviceID = deviceID
    }

    static func dismantleNSView(_ view: PreviewView, coordinator: ()) {
        view.stop()
    }
}

// ========== About ==========
struct AboutView: View {
    var body: some View {
        VStack(spacing: 8) {
            if let icon = Resources.image("icon.app.png") {
                Image(nsImage: icon).resizable().frame(width: 96, height: 96)
            }
            Text("Commentable").font(.largeTitle)
            Text("Version \(AppConfig.version)（Swift ネイティブ版）").font(.caption).foregroundColor(.secondary)
            Link(AppConfig.homepage, destination: URL(string: AppConfig.homepage)!).font(.caption)
            Text("© \(AppConfig.copyrightYear) Tetsuaki Baba").font(.caption).foregroundColor(.secondary)
        }
        .padding(24)
        .frame(width: 300, height: 300)
    }
}

// SwiftUI の画面をメインウィンドウの前に出す小さなウィンドウ
final class FloatingWindow: NSWindow {
    convenience init<Content: View>(title: String, resizable: Bool, content: Content) {
        let controller = NSHostingController(rootView: content)
        self.init(contentViewController: controller)
        self.title = title
        styleMask = resizable ? [.titled, .closable, .resizable, .miniaturizable] : [.titled, .closable]
        level = .floating // alwaysOnTop
        isReleasedWhenClosed = false
        center()
    }

    func present() {
        NSApp.activate(ignoringOtherApps: true)
        makeKeyAndOrderFront(nil)
    }
}
