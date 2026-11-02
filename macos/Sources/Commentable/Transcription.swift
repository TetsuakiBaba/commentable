import AVFoundation
import Speech

// 文字起こしの設定
enum TranscriptionSettings {
    private static let defaults = UserDefaults.standard

    // 字幕を配信画面に表示する（OFF でも授業ログと AI には送る）
    static var showCaptions: Bool {
        get { defaults.object(forKey: "transcription.showCaptions") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "transcription.showCaptions") }
    }

    // この Mac で使えるか（SpeechAnalyzer は macOS 26 以降）
    static var isSupported: Bool {
        if #available(macOS 26.0, *) { return SpeechTranscriber.isAvailable }
        return false
    }
}

// マイクの音声を macOS の音声認識（SpeechAnalyzer。端末内で処理し、音声は外に出ない）で文字起こしする
// 確定前の途中結果（volatile）と確定した文（final）をメインスレッドで渡す
// 状態はメインスレッドだけで触る（音声のスレッドで動くのはマイクの tap の中だけ）
@available(macOS 26.0, *)
final class LiveTranscriber: @unchecked Sendable {
    enum State: Equatable {
        case idle
        case preparing // マイクの許可・音声認識モデルの準備中
        case downloading // 音声認識モデルのダウンロード中（初回だけ）
        case running
        case failed(String)
    }

    var onVolatile: ((String) -> Void)?
    var onFinal: ((String) -> Void)?
    var onStateChange: ((State) -> Void)?
    // true の間はマイクの音を無音にして渡す（アプリ自身の効果音・読み上げを拾わないように）。音声のスレッドから呼ばれる
    var isInputSuppressed: () -> Bool = { false }

    private(set) var state: State = .idle {
        didSet { if state != oldValue { onStateChange?(state) } }
    }

    private var engine: AVAudioEngine?
    private var analyzer: SpeechAnalyzer?
    private var input: AsyncStream<AnalyzerInput>.Continuation?
    private var startTask: Task<Void, Never>?
    private var resultsTask: Task<Void, Never>?
    private var configurationObserver: NSObjectProtocol?

    private struct Failure: LocalizedError {
        let errorDescription: String?
        init(_ message: String) { errorDescription = message }
    }

    func start() {
        guard startTask == nil, analyzer == nil else { return }
        startTask = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await self.run()
                self.state = .running
            } catch is CancellationError {
                await self.teardown() // 準備中に OFF にされた
            } catch {
                NSLog("Transcription error: %@", "\(error)")
                await self.teardown()
                self.state = .failed(error.localizedDescription)
            }
            self.startTask = nil
        }
    }

    func stop() {
        startTask?.cancel()
        startTask = nil
        // 片付け終わるまでは自分を保持する（呼び出し側はすぐに手放す）
        Task { @MainActor in
            await self.teardown()
            self.state = .idle
        }
    }

    @MainActor
    private func run() async throws {
        state = .preparing
        guard await AVCaptureDevice.requestAccess(for: .audio) else {
            throw Failure("マイクの使用が許可されていません。システム設定 > プライバシーとセキュリティ > マイク で Commentable を許可してください。")
        }
        guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: "ja-JP")) else {
            throw Failure("この Mac では日本語の音声認識を使えません。")
        }
        let transcriber = SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [.volatileResults], attributeOptions: [])

        // 音声認識モデルは OS が管理する。入っていなければダウンロードする（初回だけ）
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            state = .downloading
            try await request.downloadAndInstall()
            state = .preparing
        }
        try Task.checkCancellation()

        guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
            throw Failure("音声認識に渡す音声の形式を決められませんでした。")
        }
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let (stream, input) = AsyncStream.makeStream(of: AnalyzerInput.self)
        self.analyzer = analyzer
        self.input = input

        resultsTask = Task { @MainActor [weak self] in
            do {
                for try await result in transcriber.results {
                    let text = String(result.text.characters)
                    if result.isFinal {
                        self?.onVolatile?("")
                        if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { self?.onFinal?(text) }
                    } else {
                        self?.onVolatile?(text)
                    }
                }
            } catch {
                NSLog("Transcription results error: %@", "\(error)")
            }
        }
        try await analyzer.start(inputSequence: stream)
        try Task.checkCancellation()
        try startMicrophone(to: input, format: format)
    }

    // マイクの音声を音声認識の形式に変換して渡す（入力は OS の既定のマイク）
    @MainActor
    private func startMicrophone(to input: AsyncStream<AnalyzerInput>.Continuation, format: AVAudioFormat) throws {
        let engine = AVAudioEngine()
        let node = engine.inputNode
        let micFormat = node.outputFormat(forBus: 0)
        guard micFormat.sampleRate > 0, let converter = AVAudioConverter(from: micFormat, to: format) else {
            throw Failure("マイクが見つかりませんでした。")
        }
        node.installTap(onBus: 0, bufferSize: 4096, format: micFormat) { [weak self] buffer, _ in
            guard let self, let converted = Self.convert(buffer, with: converter, to: format) else { return }
            if self.isInputSuppressed() { Self.silence(converted) }
            input.yield(AnalyzerInput(buffer: converted))
        }
        engine.prepare()
        try engine.start()
        self.engine = engine

        // 既定のマイクが変わる（ヘッドセットを挿すなど）と止まるので、入れ直して続ける
        configurationObserver = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            guard let self else { return }
            NSLog("Audio input changed. Restarting transcription")
            Task { @MainActor in
                await self.teardown()
                self.start()
            }
        }
    }

    @MainActor
    private func teardown() async {
        if let configurationObserver { NotificationCenter.default.removeObserver(configurationObserver) }
        configurationObserver = nil
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        engine = nil
        input?.finish()
        input = nil
        if let analyzer {
            self.analyzer = nil
            try? await analyzer.finalizeAndFinishThroughEndOfInput() // 話している途中の文も確定させる
        }
        resultsTask?.cancel()
        resultsTask = nil
        onVolatile?("")
    }

    private static func convert(_ buffer: AVAudioPCMBuffer, with converter: AVAudioConverter, to format: AVAudioFormat) -> AVAudioPCMBuffer? {
        let capacity = AVAudioFrameCount((Double(buffer.frameLength) * format.sampleRate / buffer.format.sampleRate).rounded(.up)) + 1
        guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return nil }
        var consumed = false
        var error: NSError?
        converter.convert(to: output, error: &error) { _, status in
            if consumed {
                status.pointee = .noDataNow
                return nil
            }
            consumed = true
            status.pointee = .haveData
            return buffer
        }
        return error == nil && output.frameLength > 0 ? output : nil
    }

    private static func silence(_ buffer: AVAudioPCMBuffer) {
        for audio in UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList) {
            if let data = audio.mData { memset(data, 0, Int(audio.mDataByteSize)) }
        }
    }
}

// 字幕に出す文字列（確定した文の続きに途中結果を付ける）
struct CaptionText {
    private(set) var committed = ""
    private(set) var volatile = ""
    private var lastFinalAt = Date.distantPast

    // しばらく話が途切れたら、前の文は消して新しく始める
    private static let pauseToClear: TimeInterval = 10
    private static let maxCommitted = 200

    mutating func setVolatile(_ text: String) {
        clearIfPaused()
        volatile = text
    }

    mutating func appendFinal(_ text: String) {
        clearIfPaused()
        committed = String((committed + text).suffix(Self.maxCommitted))
        volatile = ""
        lastFinalAt = Date()
    }

    mutating func clear() {
        committed = ""
        volatile = ""
    }

    private mutating func clearIfPaused() {
        if Date().timeIntervalSince(lastFinalAt) > Self.pauseToClear { committed = "" }
    }
}
