import AVFoundation
import CoreImage
import IOSurface
import Vision

// レイヤーに表示するカメラの 1 フレーム
// CGImage にすると GPU の結果を CPU 側に読み戻し、さらに Core Animation がメインスレッドで色変換をやり直す。
// IOSurface ならそのまま GPU で合成されるので、どちらも起きない
struct CameraFrame {
    let pixelBuffer: CVPixelBuffer // 表示している間はバッファを再利用されないように持っておく
    let surface: IOSurfaceRef
    var size: CGSize { CGSize(width: CVPixelBufferGetWidth(pixelBuffer), height: CVPixelBufferGetHeight(pixelBuffer)) }

    init?(pixelBuffer: CVPixelBuffer) {
        guard let surface = CVPixelBufferGetIOSurface(pixelBuffer)?.takeUnretainedValue() else { return nil }
        self.pixelBuffer = pixelBuffer
        self.surface = surface
    }
}

// 人物の切り抜き方。fast / balanced / accurate は Vision で人物を見つける（その品質）。
// chromaKey は人物を探さず、単色の背景を透過する
// （もとは品質だけだったので、保存するときの名前は segmentationQuality のまま）
enum SegmentationMethod: String, CaseIterable {
    case fast
    case balanced
    case accurate
    case chromaKey

    var label: String {
        switch self {
        case .fast: return "高速"
        case .balanced: return "標準"
        case .accurate: return "高精度"
        case .chromaKey: return "背景の色を透過（クロマキー）"
        }
    }

    // Vision を使わない方法なら nil
    var visionLevel: VNGeneratePersonSegmentationRequest.QualityLevel? {
        switch self {
        case .fast: return .fast
        case .balanced: return .balanced
        case .accurate: return .accurate
        case .chromaKey: return nil
        }
    }
}

// カメラから取り込む解像度。下げると軽くなるのは映像の変換と合成（主に GPU）で、
// 人物切り抜きの推論は入力を決まった大きさに縮めてから行われるので、ほとんど変わらない
enum CameraResolution: String, CaseIterable {
    case hd720
    case vga480

    var label: String {
        switch self {
        case .hd720: return "720p（標準）"
        case .vga480: return "480p（軽い）"
        }
    }

    var preset: AVCaptureSession.Preset {
        switch self {
        case .hd720: return .hd1280x720
        case .vga480: return .vga640x480
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
    static var segmentationMethod: SegmentationMethod {
        get { SegmentationMethod(rawValue: defaults.string(forKey: "camera.segmentationQuality") ?? "") ?? .balanced }
        set { defaults.set(newValue.rawValue, forKey: "camera.segmentationQuality") }
    }
    static var resolution: CameraResolution {
        get { CameraResolution(rawValue: defaults.string(forKey: "camera.resolution") ?? "") ?? .hd720 }
        set { defaults.set(newValue.rawValue, forKey: "camera.resolution") }
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
    var onFrame: ((CameraFrame?) -> Void)?

    private let session = AVCaptureSession()
    // フレームごとに autorelease pool を空にする（既定では空にされず、Vision や Core Image が作った
    // 映像サイズの IOSurface がたまり続けて、何 GB にもなっていた）
    private let queue = DispatchQueue(label: "commentable.camera", autoreleaseFrequency: .workItem)
    private let ciContext = CIContext(options: [.cacheIntermediates: false])
    private let outputColorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
    private lazy var outputColorSpaceData = outputColorSpace.copyPropertyList()
    private var outputPool: CVPixelBufferPool? // 切り抜いた映像の描き込み先（queue 上で使う）
    private var outputPoolSize: CGSize = .zero

    // メインスレッドにまだ渡していないフレーム（いちばん新しいものだけ。メインスレッドが詰まっても
    // フレームが積み上がらないようにする）
    private let pendingLock = NSLock()
    private var pendingFrame: (frame: CameraFrame, generation: Int)?
    private var generation = 0 // 停止・切り替え後に古いフレームを表示しないため

    // 以下は queue 上で読み書きする
    private var activeGeneration: Int? // 動いているセッションの世代（停止中は nil）
    private var segmentationEnabled = false
    private var method: SegmentationMethod = .balanced
    private let chromaKey = ChromaKey()
    private var sequenceHandler = VNSequenceRequestHandler()
    private var segmentationRequest: VNGeneratePersonSegmentationRequest?

    private(set) var isRunning = false

    func setSegmentation(enabled: Bool, method: SegmentationMethod) {
        queue.async {
            if self.method != method || !enabled {
                self.resetSegmentation()
            }
            self.segmentationEnabled = enabled
            self.method = method
        }
    }

    // queue 上で呼ぶ
    private func resetSegmentation() {
        segmentationRequest = nil
        sequenceHandler = VNSequenceRequestHandler()
        chromaKey.reset()
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

    func start(deviceID: String, resolution: CameraResolution) {
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
            self.queue.async { self.configure(device: device, resolution: resolution, generation: currentGeneration) }
        }
    }

    private func configure(device: AVCaptureDevice, resolution: CameraResolution, generation: Int) {
        session.beginConfiguration()
        session.inputs.forEach { session.removeInput($0) }
        session.outputs.forEach { session.removeOutput($0) }
        do {
            let input = try AVCaptureDeviceInput(device: device)
            if session.canAddInput(input) { session.addInput(input) }
        } catch {
            NSLog("Error starting camera: %@", error.localizedDescription)
            session.commitConfiguration()
            return
        }
        // カメラをつないでから選ぶ（つなぐ前だと、そのカメラが対応していない解像度でも選べてしまう）
        // 対応していなければ 720p、それも無理ならカメラ任せにする
        if let preset = [resolution.preset, .hd1280x720].first(where: session.canSetSessionPreset) {
            session.sessionPreset = preset
        }
        let output = AVCaptureVideoDataOutput()
        // カメラに近い YUV の形式で受け取る（BGRA を指定すると、カメラの処理の中で CPU を使って変換される）
        // RGB への変換は、表示用のバッファに描くときに GPU で行う
        let yuv = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        let format = output.availableVideoPixelFormatTypes.contains(yuv) ? yuv : kCVPixelFormatType_32BGRA
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: format]
        output.alwaysDiscardsLateVideoFrames = true // 切り抜きが追いつかないときは古いフレームを捨てる
        output.setSampleBufferDelegate(self, queue: queue)
        if session.canAddOutput(output) { session.addOutput(output) }
        session.commitConfiguration()
        resetSegmentation()
        activeGeneration = generation
        session.startRunning()
        DispatchQueue.main.async {
            if generation == self.generation { self.isRunning = true }
        }
    }

    func stop() {
        generation += 1
        isRunning = false
        queue.async {
            self.activeGeneration = nil
            if self.session.isRunning { self.session.stopRunning() }
        }
        onFrame?(nil)
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        // 世代は queue 上の値を使う。main の generation をここで読むと、停止直後に処理していたフレームが
        // 新しい世代として渡り、onFrame(nil) の後に表示されて最後のフレームが残ってしまう
        guard let currentGeneration = activeGeneration,
              let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        autoreleasepool {
            guard let frame = makeFrame(from: pixelBuffer) else { return }
            deliver(frame, generation: currentGeneration)
        }
    }

    private func makeFrame(from pixelBuffer: CVPixelBuffer) -> CameraFrame? {
        let image = CIImage(cvPixelBuffer: pixelBuffer)
        guard segmentationEnabled else {
            // BGRA ならカメラのバッファをそのまま表示する（コピーも変換もしない）
            if CVPixelBufferGetPixelFormatType(pixelBuffer) == kCVPixelFormatType_32BGRA,
               let frame = CameraFrame(pixelBuffer: pixelBuffer) { return frame }
            return render(image)
        }
        guard let visionLevel = method.visionLevel else {
            return render(chromaKey.apply(to: image, context: ciContext))
        }

        // 動画用に VNSequenceRequestHandler を使い回す（フレーム間で結果が安定する）
        let request: VNGeneratePersonSegmentationRequest
        if let existing = segmentationRequest {
            request = existing
        } else {
            request = VNGeneratePersonSegmentationRequest()
            request.qualityLevel = visionLevel
            request.outputPixelFormat = kCVPixelFormatType_OneComponent8
            segmentationRequest = request
        }
        do {
            try sequenceHandler.perform([request], on: pixelBuffer, orientation: .up)
        } catch {
            NSLog("Segmentation error: %@", error.localizedDescription)
            return nil
        }
        guard let maskBuffer = request.results?.first?.pixelBuffer else { return nil }
        // マスクは低解像度なので映像の大きさに拡大して（補間されるので輪郭が滑らかになる）背景を透過する
        var mask = CIImage(cvPixelBuffer: maskBuffer)
        mask = mask.transformed(by: CGAffineTransform(scaleX: image.extent.width / mask.extent.width,
                                                      y: image.extent.height / mask.extent.height))
        return render(image.applyingFilter("CIBlendWithMask", parameters: [
            kCIInputBackgroundImageKey: CIImage.empty(),
            kCIInputMaskImageKey: mask,
        ]))
    }

    // GPU 上で IOSurface のバッファに描く（CPU には読み戻さない）
    private func render(_ image: CIImage) -> CameraFrame? {
        let size = image.extent.size
        if outputPool == nil || outputPoolSize != size {
            let attributes: [String: Any] = [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String: Int(size.width),
                kCVPixelBufferHeightKey as String: Int(size.height),
                kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
                kCVPixelBufferMetalCompatibilityKey as String: true,
            ]
            var pool: CVPixelBufferPool?
            CVPixelBufferPoolCreate(nil, nil, attributes as CFDictionary, &pool)
            outputPool = pool
            outputPoolSize = size
        }
        var buffer: CVPixelBuffer?
        guard let outputPool,
              CVPixelBufferPoolCreatePixelBuffer(nil, outputPool, &buffer) == kCVReturnSuccess,
              let buffer else { return nil }
        ciContext.render(image, to: buffer, bounds: image.extent, colorSpace: outputColorSpace)
        guard let frame = CameraFrame(pixelBuffer: buffer) else { return nil }
        // 色空間を IOSurface に書いておく（Core Animation が画面の色空間に正しく合わせられるように）
        if let outputColorSpaceData {
            IOSurfaceSetValue(frame.surface, kIOSurfaceColorSpace, outputColorSpaceData)
        }
        return frame
    }

    private func deliver(_ frame: CameraFrame, generation: Int) {
        pendingLock.lock()
        let alreadyScheduled = pendingFrame != nil
        pendingFrame = (frame, generation)
        pendingLock.unlock()
        guard !alreadyScheduled else { return } // 前のフレームを渡す前なら差し替えるだけ
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.pendingLock.lock()
            let pending = self.pendingFrame
            self.pendingFrame = nil
            self.pendingLock.unlock()
            guard let pending, pending.generation == self.generation else { return }
            self.onFrame?(pending.frame)
        }
    }
}
