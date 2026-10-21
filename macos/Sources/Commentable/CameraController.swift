import AVFoundation
import CoreImage
import Vision

enum SegmentationQuality: String, CaseIterable {
    case fast
    case balanced
    case accurate

    var label: String {
        switch self {
        case .fast: return "高速"
        case .balanced: return "標準"
        case .accurate: return "高精度"
        }
    }

    var visionLevel: VNGeneratePersonSegmentationRequest.QualityLevel {
        switch self {
        case .fast: return .fast
        case .balanced: return .balanced
        case .accurate: return .accurate
        }
    }
}

// カメラの設定（Electron 版の camera-settings.json に相当。デバイス ID の形式が違うので別に保存する）
enum CameraSettings {
    private static let defaults = UserDefaults.standard

    static var deviceID: String? {
        get { defaults.string(forKey: "camera.deviceID") }
        set { defaults.set(newValue, forKey: "camera.deviceID") }
    }
    static var position: CameraPosition {
        get { CameraPosition(rawValue: defaults.string(forKey: "camera.position") ?? "") ?? .topRight }
        set { defaults.set(newValue.rawValue, forKey: "camera.position") }
    }
    static var size: String {
        get { defaults.string(forKey: "camera.size") ?? "small" }
        set { defaults.set(newValue, forKey: "camera.size") }
    }
    static var segmentation: Bool {
        get { defaults.bool(forKey: "camera.segmentation") }
        set { defaults.set(newValue, forKey: "camera.segmentation") }
    }
    static var segmentationQuality: SegmentationQuality {
        get { SegmentationQuality(rawValue: defaults.string(forKey: "camera.segmentationQuality") ?? "") ?? .balanced }
        set { defaults.set(newValue.rawValue, forKey: "camera.segmentationQuality") }
    }

    static let sizes: [(label: String, value: String, scale: CGFloat)] = [
        ("小", "small", 0.15),
        ("中", "medium", 0.25),
        ("大", "large", 0.40),
    ]

    static func scale(for size: String) -> CGFloat {
        sizes.first { $0.value == size }?.scale ?? 0.15
    }

    static func availableDevices() -> [AVCaptureDevice] {
        var types: [AVCaptureDevice.DeviceType] = [.builtInWideAngleCamera]
        if #available(macOS 14.0, *) {
            types += [.external, .continuityCamera, .deskViewCamera]
        } else {
            types += [.externalUnknown]
        }
        return AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .unspecified).devices
    }
}

// カメラ映像を取り込み、必要なら人物だけを切り抜いて画像として渡す
final class CameraController: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    // メインスレッドで呼ばれる（nil はカメラ停止）
    var onFrame: ((CGImage?) -> Void)?

    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "commentable.camera")
    private let ciContext = CIContext(options: [.cacheIntermediates: false])
    private var generation = 0 // 停止・切り替え後に古いフレームを表示しないため

    // 以下は queue 上で読み書きする
    private var segmentationEnabled = false
    private var quality: SegmentationQuality = .balanced
    private var sequenceHandler = VNSequenceRequestHandler()
    private var segmentationRequest: VNGeneratePersonSegmentationRequest?

    private(set) var isRunning = false

    func setSegmentation(enabled: Bool, quality: SegmentationQuality) {
        queue.async {
            if self.quality != quality || !enabled {
                self.segmentationRequest = nil
                self.sequenceHandler = VNSequenceRequestHandler()
            }
            self.segmentationEnabled = enabled
            self.quality = quality
        }
    }

    static func requestAccess(_ completion: @escaping (Bool) -> Void) {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            completion(true)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in DispatchQueue.main.async { completion(granted) } }
        default:
            completion(false)
        }
    }

    func start(deviceID: String) {
        stop()
        generation += 1
        let currentGeneration = generation
        Self.requestAccess { [weak self] granted in
            guard let self, granted, currentGeneration == self.generation else {
                if !granted {
                    Dialogs.message(style: .warning, title: "カメラを使用できません",
                                    detail: "システム設定 > プライバシーとセキュリティ > カメラ で Commentable を許可してください。")
                }
                return
            }
            guard let device = AVCaptureDevice(uniqueID: deviceID) ?? AVCaptureDevice.default(for: .video) else {
                Dialogs.message(style: .warning, title: "カメラが見つかりません", detail: "カメラ設定でカメラを選び直してください。")
                return
            }
            self.queue.async { self.configure(device: device, generation: currentGeneration) }
        }
    }

    private func configure(device: AVCaptureDevice, generation: Int) {
        session.beginConfiguration()
        session.inputs.forEach { session.removeInput($0) }
        session.outputs.forEach { session.removeOutput($0) }
        if session.canSetSessionPreset(.hd1280x720) {
            session.sessionPreset = .hd1280x720
        }
        do {
            let input = try AVCaptureDeviceInput(device: device)
            if session.canAddInput(input) { session.addInput(input) }
        } catch {
            NSLog("Error starting camera: %@", error.localizedDescription)
            session.commitConfiguration()
            return
        }
        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        output.alwaysDiscardsLateVideoFrames = true // 切り抜きが追いつかないときは古いフレームを捨てる
        output.setSampleBufferDelegate(self, queue: queue)
        if session.canAddOutput(output) { session.addOutput(output) }
        session.commitConfiguration()
        session.startRunning()
        DispatchQueue.main.async {
            if generation == self.generation { self.isRunning = true }
        }
    }

    func stop() {
        generation += 1
        isRunning = false
        queue.async {
            if self.session.isRunning { self.session.stopRunning() }
        }
        onFrame?(nil)
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        var image = CIImage(cvPixelBuffer: pixelBuffer)

        if segmentationEnabled {
            // 動画用に VNSequenceRequestHandler を使い回す（フレーム間で結果が安定する）
            let request: VNGeneratePersonSegmentationRequest
            if let existing = segmentationRequest {
                request = existing
            } else {
                request = VNGeneratePersonSegmentationRequest()
                request.qualityLevel = quality.visionLevel
                request.outputPixelFormat = kCVPixelFormatType_OneComponent8
                segmentationRequest = request
            }
            do {
                try sequenceHandler.perform([request], on: pixelBuffer, orientation: .up)
                guard let maskBuffer = request.results?.first?.pixelBuffer else { return }
                // マスクは低解像度なので映像の大きさに拡大して（補間されるので輪郭が滑らかになる）背景を透過する
                var mask = CIImage(cvPixelBuffer: maskBuffer)
                mask = mask.transformed(by: CGAffineTransform(scaleX: image.extent.width / mask.extent.width,
                                                              y: image.extent.height / mask.extent.height))
                image = image.applyingFilter("CIBlendWithMask", parameters: [
                    kCIInputBackgroundImageKey: CIImage.empty(),
                    kCIInputMaskImageKey: mask,
                ])
            } catch {
                NSLog("Segmentation error: %@", error.localizedDescription)
                return
            }
        }

        guard let cgImage = ciContext.createCGImage(image, from: CGRect(origin: .zero, size: CVImageBufferGetDisplaySize(pixelBuffer))) else { return }
        let currentGeneration = generation
        DispatchQueue.main.async { [weak self] in
            guard let self, currentGeneration == self.generation else { return }
            self.onFrame?(cgImage)
        }
    }
}
