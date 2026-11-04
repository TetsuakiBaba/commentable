import AppKit
import QuartzCore

enum QRPosition: String {
    case none
    case center
    case topRight = "top_right"
}

enum CameraPosition: String, CaseIterable {
    case topLeft = "top-left"
    case topRight = "top-right"
    case bottomLeft = "bottom-left"
    case bottomRight = "bottom-right"
    case center
}

// 画面全体の透明なオーバーレイ
// Electron 版は p5.js のキャンバスに毎フレーム描き直していたが、ここではコメントやエフェクトを
// 1つずつレイヤーにして Core Animation で動かす（描き直しがないので CPU をほとんど使わない）
//
// 重なり順（下から）: カメラ, 時計, コメント, 隠しコマンドの演出, フラッシュ, コメントコマンド, 字幕, 管理者メッセージ, QR コード, 通知
final class OverlayView: NSView {
    static let maxComments = 50
    static let commentDuration: CFTimeInterval = 10 // コメント表示時間（秒）

    private let root = CALayer()
    private let cameraLayer = CALayer()
    private let clockLayer = CALayer()
    private let commentsLayer = CALayer()
    private let effectLayer = CALayer()
    private let flashLayer = CALayer()
    private let commandsLayer = CALayer()
    private let captionLayer = CALayer()
    private let adminLayer = CALayer()
    private let qrLayer = CALayer()
    private let notificationLayer = CALayer()

    private var clockEnabled = false
    private var clockTimer: Timer?
    private var adminMessage: String?
    private var qrPosition: QRPosition = .none
    private var qrText = ""
    private var qrSuppressed = false
    private var cameraImageSize: CGSize?
    private var hoverTimer: Timer?
    private var notificationWork: DispatchWorkItem?
    private var caption: (committed: String, volatile: String) = ("", "")
    private var captionHideWork: DispatchWorkItem?
    private var stableCaption = StableCaption()

    // 字幕の表示方法（読みやすさ優先のときは、行の区切りを覚えておいて 1 行ずつ送る）
    var captionStyle: CaptionStyle = .streaming {
        didSet {
            stableCaption = StableCaption()
            renderCaption(restartTimer: false)
        }
    }
    private var hoveredComment: CALayer? // Option を押しながらカーソルを重ねているコメント

    // Option を押しながらコメントをクリックしたとき（コメントの ID を渡す。スターを付ける・外す）
    var onCommentClick: ((String) -> Void)?

    var cameraPosition: CameraPosition = .topRight { didSet { layoutCamera() } }
    var cameraScale: CGFloat = 0.15 { didSet { layoutCamera() } } // 画面幅に対する比率

    private var scale: CGFloat { window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2 }
    private var W: CGFloat { bounds.width }
    private var H: CGFloat { bounds.height }

    // hoverEnabled: カメラ映像と QR コードをマウスを重ねたときに消す（共有用ウィンドウでは消さない）
    init(hoverEnabled: Bool = true) {
        super.init(frame: .zero)
        layer = root
        wantsLayer = true
        for sublayer in [cameraLayer, clockLayer, commentsLayer, effectLayer, flashLayer, commandsLayer, captionLayer, adminLayer, qrLayer, notificationLayer] {
            sublayer.actions = Self.noActions
            root.addSublayer(sublayer)
        }
        root.actions = Self.noActions
        cameraLayer.contentsGravity = .resize
        cameraLayer.isHidden = true
        clockLayer.anchorPoint = CGPoint(x: 0, y: 1) // 左上を基準に置く
        clockLayer.isHidden = true
        flashLayer.backgroundColor = NSColor.white.cgColor
        flashLayer.opacity = 0
        captionLayer.isHidden = true
        adminLayer.isHidden = true
        qrLayer.isHidden = true
        notificationLayer.isHidden = true

        // マウスイベントは受け取らない（ignoresMouseEvents）ので、カーソルの位置を見てホバーを判定する
        if hoverEnabled {
            hoverTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in self?.updateHover() }
        }
    }

    required init?(coder: NSCoder) { fatalError() }

    private static let noActions: [String: CAAction] = [
        "position": NSNull(), "bounds": NSNull(), "frame": NSNull(), "contents": NSNull(),
        "hidden": NSNull(), "opacity": NSNull(), "transform": NSNull(), "sublayers": NSNull(),
        "contentsScale": NSNull(), "backgroundColor": NSNull(),
    ]

    // p5 の座標（左上原点）を Core Animation の座標（左下原点）に
    private func flipY(_ y: CGFloat) -> CGFloat { H - y }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        layoutOverlay()
    }

    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        root.contentsScale = scale
        layoutOverlay()
    }

    // 画面サイズや倍率が変わったときに置き直す（流れているコメントはそのまま）
    private func layoutOverlay() {
        flashLayer.frame = bounds
        effectLayer.frame = bounds
        effectLayer.sublayers?.forEach { $0.frame = bounds; $0.sublayers?.first?.frame = bounds }
        commentsLayer.frame = bounds
        commandsLayer.frame = bounds
        renderClock()
        renderAdminMessage()
        renderCaption(restartTimer: false)
        renderQR(fadeIn: false)
        layoutCamera()
    }

    private func addImageLayer(_ rendered: (image: CGImage, size: CGSize), to parent: CALayer) -> CALayer {
        let layer = CALayer()
        layer.actions = Self.noActions
        layer.contents = rendered.image
        layer.contentsScale = scale
        layer.contentsGravity = .resize
        layer.bounds = CGRect(origin: .zero, size: rendered.size)
        parent.addSublayer(layer)
        return layer
    }

    private func remove(_ layer: CALayer, after delay: CFTimeInterval) {
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { layer.removeFromSuperlayer() }
    }

    // 不透明度を変える（途中からでも滑らかに）
    private func fade(_ layer: CALayer, to opacity: Float, duration: CFTimeInterval) {
        guard layer.opacity != opacity else { return }
        let from = layer.presentation()?.opacity ?? layer.opacity
        layer.opacity = opacity
        guard duration > 0 else {
            layer.removeAnimation(forKey: "fade")
            return
        }
        let animation = CABasicAnimation(keyPath: "opacity")
        animation.fromValue = from
        animation.toValue = opacity
        animation.duration = duration
        animation.timingFunction = CAMediaTimingFunction(name: .easeOut)
        layer.add(animation, forKey: "fade")
    }

    // ========== コメント ==========
    var activeCommentCount: Int { commentsLayer.sublayers?.count ?? 0 }

    // 表示できたら true（同時に表示できるのは maxComments 件まで）
    @discardableResult
    // name があれば、コメントの左上に表示名のバッジを付ける（コメントの色を反転させた角丸の札）
    func addComment(_ text: String, name: String?, id: String?, starred: Bool, direction: String?, fontSize: String?, fill: NSColor, stroke: NSColor) -> Bool {
        guard activeCommentCount < Self.maxComments, W > 0, H > 0 else { return false }

        let baseSize = H / 20
        let multiplier: CGFloat = fontSize == "small" ? 0.7 : fontSize == "large" ? 1.5 : 1.0
        let style = TextStyle(font: TextImage.font(size: baseSize * multiplier), fill: fill, stroke: stroke, strokeWidth: 5)
        guard let rendered = TextImage.render(text, style: style, scale: scale) else { return false }
        let size = rendered.size

        // 表示位置（p5 版と同じく標準サイズの文字幅で決める）
        let measured = TextImage.measure(text, font: TextImage.font(size: baseSize)).width
        let x = measured < W ? CGFloat.random(in: (measured / 2)...(W - measured / 2)) : measured / 2
        let y = H > 200 ? CGFloat.random(in: 100...(H - 100)) : H / 2

        let layer = addImageLayer(rendered, to: commentsLayer)
        layer.name = id // スターを付けられるコメント（参加者のコメント）だけ ID がある
        if starred { setStar(on: layer, starred: true, animated: false) }
        if let name, !name.isEmpty,
           let badge = TextImage.renderNameBadge(name, font: TextImage.font(size: baseSize * multiplier * 0.45, bold: true),
                                                 color: stroke, background: fill, scale: scale) {
            let nameLayer = addImageLayer(badge, to: layer)
            // コメントの縁取りの余白の分だけ内側に寄せる（レイヤーの座標は下が 0）
            nameLayer.position = CGPoint(x: style.strokeWidth + badge.size.width / 2,
                                         y: size.height + badge.size.height / 2)
        }
        let duration = Self.commentDuration

        switch direction {
        case "left", "right":
            // 画面の端から端まで流れる
            let startX = direction == "left" ? W : -size.width
            let endX = direction == "left" ? -size.width : W
            layer.position = CGPoint(x: endX + size.width / 2, y: flipY(y))
            let animation = CABasicAnimation(keyPath: "position.x")
            animation.fromValue = startX + size.width / 2
            animation.toValue = endX + size.width / 2
            animation.duration = duration
            layer.add(animation, forKey: "move")
        case "up", "down":
            // 文字の上端の位置で動かす
            let startY = direction == "up" ? H : -size.height
            let endY = direction == "up" ? -size.height : H
            layer.position = CGPoint(x: x, y: flipY(endY + size.height / 2))
            let animation = CABasicAnimation(keyPath: "position.y")
            animation.fromValue = flipY(startY + size.height / 2)
            animation.toValue = flipY(endY + size.height / 2)
            animation.duration = duration
            layer.add(animation, forKey: "move")
        default:
            // その場でフェードアウトしながら小さくなる
            layer.position = CGPoint(x: x, y: flipY(y))
            layer.opacity = 0
            let steps = 40
            let keyTimes = (0...steps).map { NSNumber(value: Double($0) / Double(steps)) }
            let opacity = CAKeyframeAnimation(keyPath: "opacity")
            opacity.values = keyTimes.map { 1 - $0.doubleValue }
            opacity.keyTimes = keyTimes
            let scale = CAKeyframeAnimation(keyPath: "transform.scale")
            scale.values = keyTimes.map { sin(0.5 * Double.pi * (1 - $0.doubleValue)) }
            scale.keyTimes = keyTimes
            let group = CAAnimationGroup()
            group.animations = [opacity, scale]
            group.duration = duration
            layer.add(group, forKey: "still")
            layer.transform = CATransform3DMakeScale(0.001, 0.001, 1)
        }
        remove(layer, after: duration)
        return true
    }

    // コメントコマンド =text("文字", x, y)（位置は画面に対する比率、10 秒間表示）
    func addTextCommand(_ text: String, x: CGFloat, y: CGFloat, fill: NSColor, stroke: NSColor) {
        // 同時に表示できるのは 20 件まで（大量に送られても重くならないように）
        guard (commandsLayer.sublayers?.count ?? 0) < 20 else { return }
        let style = TextStyle(font: TextImage.font(size: H / 15), fill: fill, stroke: stroke, strokeWidth: 5)
        guard let rendered = TextImage.render(text, style: style, scale: scale) else { return }
        let layer = addImageLayer(rendered, to: commandsLayer)
        layer.position = CGPoint(x: x * W, y: flipY(y * H))
        remove(layer, after: 10)
    }

    // ========== コメントのスター ==========
    // スターを付けたコメントの左に ⭐ を出す（流れているコメントと一緒に動く）
    func setStar(commentID: String, starred: Bool) {
        commentsLayer.sublayers?.filter { $0.name == commentID }.forEach { setStar(on: $0, starred: starred, animated: true) }
    }

    private func setStar(on layer: CALayer, starred: Bool, animated: Bool) {
        let existing = layer.sublayers?.first { $0.name == "star" }
        guard starred else {
            existing?.removeFromSuperlayer()
            return
        }
        guard existing == nil, let rendered = TextImage.render("⭐", style: TextStyle(font: TextImage.font(size: layer.bounds.height * 0.7), fill: .white), scale: scale)
        else { return }
        let star = addImageLayer(rendered, to: layer)
        star.name = "star"
        star.position = CGPoint(x: -rendered.size.width / 2, y: layer.bounds.midY)
        if animated {
            // ぽんと出る
            let pop = CAKeyframeAnimation(keyPath: "transform.scale")
            pop.values = [0.2, 1.4, 0.9, 1.0]
            pop.keyTimes = [0, 0.4, 0.7, 1]
            pop.duration = 0.45
            star.add(pop, forKey: "pop")
        }
    }

    // 画面上の位置にあるスターを付けられるコメント（いちばん手前のもの）
    private func starrableComment(at point: CGPoint) -> CALayer? {
        commentsLayer.sublayers?.reversed().first { layer in
            guard layer.name != nil, let shown = layer.presentation() ?? Optional(layer), shown.opacity > 0.2 else { return false }
            return shown.frame.insetBy(dx: -8, dy: -8).contains(point)
        }
    }

    // Option を押しながらコメントに重ねている間だけ、このウィンドウがクリックを受け取る
    // （それ以外のクリックは今までどおり下のアプリに通す）
    private func updateCommentHover(at point: CGPoint) {
        guard let window, onCommentClick != nil else { return }
        let hovered = NSEvent.modifierFlags.contains(.option) ? starrableComment(at: point) : nil
        if hovered !== hoveredComment {
            hoveredComment?.backgroundColor = nil
            hovered?.backgroundColor = NSColor(white: 1, alpha: 0.25).cgColor
            hovered?.cornerRadius = 8
            hoveredComment = hovered
        }
        let ignores = hovered == nil
        if window.ignoresMouseEvents != ignores { window.ignoresMouseEvents = ignores }
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        guard let id = starrableComment(at: point)?.name else { return }
        onCommentClick?(id)
    }

    func clearComments() {
        hoveredComment = nil
        commentsLayer.sublayers = nil
        commandsLayer.sublayers = nil
        effectLayer.sublayers = nil
    }

    // ========== エフェクト ==========
    // 隠しコマンド（hidden == 0）: 画面を暗くしてコメントを大きく表示する
    func showProtofessional(_ text: String) {
        effectLayer.sublayers = nil
        let container = CALayer()
        container.actions = Self.noActions
        container.frame = bounds
        let background = CALayer()
        background.actions = Self.noActions
        background.frame = bounds
        background.backgroundColor = NSColor.black.cgColor
        container.addSublayer(background)
        let style = TextStyle(font: TextImage.font(size: H / 20), fill: .white)
        if let rendered = TextImage.render(text, style: style, scale: scale) {
            addImageLayer(rendered, to: container).position = CGPoint(x: W / 2, y: H / 2)
        }
        effectLayer.addSublayer(container)

        let duration: CFTimeInterval = 10
        let steps = 40
        let keyTimes = (0...steps).map { NSNumber(value: Double($0) / Double(steps)) }
        let animation = CAKeyframeAnimation(keyPath: "opacity")
        animation.values = keyTimes.map { cos(0.5 * Double.pi * $0.doubleValue) }
        animation.keyTimes = keyTimes
        animation.duration = duration
        container.opacity = 0
        container.add(animation, forKey: "effect")
        remove(container, after: duration)
    }

    // カメラの効果音のときに画面を白く光らせる（p5 版は 60fps で毎フレーム 0.85 倍）
    func flash() {
        let frames = 25
        let animation = CAKeyframeAnimation(keyPath: "opacity")
        animation.values = (0...frames).map { $0 == frames ? 0 : 55.0 / 255.0 * pow(0.85, Double($0)) }
        animation.duration = Double(frames) / 60
        flashLayer.opacity = 0
        flashLayer.add(animation, forKey: "flash")
    }

    // ========== 時計 ==========
    func setClock(_ enabled: Bool) {
        clockEnabled = enabled
        renderClock()
    }

    private func renderClock() {
        clockTimer?.invalidate()
        clockTimer = nil
        guard clockEnabled, H > 0 else {
            clockLayer.isHidden = true
            return
        }
        let now = Date()
        let parts = Calendar.current.dateComponents([.hour, .minute, .second, .nanosecond], from: now)
        let text = String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
        // 字幕と同じ半透明の背景に載せる。数字は等幅にして、分が変わっても幅が変わらないようにする
        let font = NSFont.monospacedDigitSystemFont(ofSize: H / 20, weight: .semibold)
        if let rendered = TextImage.renderBadge(text, font: font, color: .white, background: NSColor.black.withAlphaComponent(0.6), scale: scale) {
            clockLayer.contents = rendered.image
            clockLayer.contentsScale = scale
            clockLayer.bounds = CGRect(origin: .zero, size: rendered.size)
            clockLayer.position = CGPoint(x: 20, y: flipY(20))
            clockLayer.isHidden = false
        }
        // 分が変わるときだけ描き直す
        let toNextMinute = 60 - Double(parts.second ?? 0) - Double(parts.nanosecond ?? 0) / 1e9 + 0.05
        clockTimer = Timer.scheduledTimer(withTimeInterval: toNextMinute, repeats: false) { [weak self] _ in self?.renderClock() }
    }

    // ========== 管理者メッセージ ==========
    func setAdminMessage(show: Bool, text: String) {
        adminMessage = show && !text.isEmpty ? text : nil
        renderAdminMessage()
    }

    private func renderAdminMessage() {
        guard let text = adminMessage, H > 0,
              let rendered = TextImage.render(text, style: TextStyle(font: TextImage.font(size: H / 20), fill: .white, background: .black), scale: scale)
        else {
            adminLayer.isHidden = true
            return
        }
        adminLayer.contents = rendered.image
        adminLayer.contentsScale = scale
        adminLayer.bounds = CGRect(origin: .zero, size: rendered.size)
        adminLayer.position = CGPoint(x: W / 2, y: H / 2)
        adminLayer.isHidden = false
    }

    // ========== 字幕 ==========
    // 文字起こしの字幕を画面の下に出す。確定した文は白、確定前の途中結果は薄く表示する
    func setCaption(committed: String, volatile: String) {
        caption = (committed, volatile)
        renderCaption(restartTimer: true)
    }

    private static let captionHideDelay: TimeInterval = 8 // 更新がなければ消すまでの秒数
    private static let captionBottom: CGFloat = 40 // 画面の下端から字幕までの距離

    // 字幕を置ける左右の範囲。既定は画面幅の 80% を中央に取る
    // カメラ映像が字幕の高さにあるときは、カメラを避けて広く空いている側に寄せる（狭すぎるときは避けない）
    private func captionArea(fontSize: CGFloat) -> (minX: CGFloat, maxX: CGFloat) {
        let full = (minX: W * 0.1, maxX: W * 0.9)
        guard !cameraLayer.isHidden, cameraImageSize != nil else { return full }
        // 2 行の字幕の高さ（行の高さは文字の大きさの約 1.5 倍で最後の行の行間は除く。上下の余白は 0.3 倍ずつ）
        let top = Self.captionBottom + fontSize * (1.5 + 1.0 + 0.6)
        let camera = cameraLayer.frame
        guard camera.minY < top, camera.maxY > Self.captionBottom else { return full }
        let gap: CGFloat = 20
        let left = (minX: full.minX, maxX: min(full.maxX, camera.minX - gap))
        let right = (minX: max(full.minX, camera.maxX + gap), maxX: full.maxX)
        let wider = left.maxX - left.minX >= right.maxX - right.minX ? left : right
        return wider.maxX - wider.minX >= W * 0.3 ? wider : full
    }

    private static let captionVolatileColor = NSColor(white: 1, alpha: 0.6)
    private static let captionBackground = NSColor.black.withAlphaComponent(0.65)

    private func renderCaption(restartTimer: Bool) {
        let (committed, volatile) = caption
        guard !(committed + volatile).isEmpty, W > 0, H > 0 else {
            captionHideWork?.cancel()
            captionLayer.isHidden = true
            stableCaption = StableCaption()
            return
        }
        let fontSize = H / 24
        let font = TextImage.font(size: fontSize)
        let area = captionArea(fontSize: fontSize)
        let maxWidth = area.maxX - area.minX
        let rendered: (image: CGImage, size: CGSize)?
        switch captionStyle {
        case .streaming:
            rendered = renderStreamingCaption(committed: committed, volatile: volatile, font: font, maxWidth: maxWidth)
        case .stable:
            let lines = stableCaption.update(committed: committed, volatile: volatile, font: font, width: maxWidth)
            // 背景の幅を固定し、左寄せにする（行が伸びても文字の位置が動かない）
            // 行の区切りは自分で決めているので、描画で折り返さないように幅には余裕を持たせる
            let segments = lines.enumerated().flatMap { index, line in
                (index > 0 ? [("\n", NSColor.white)] : []) + [(line.committed, NSColor.white), (line.volatile, Self.captionVolatileColor)]
            }
            rendered = TextImage.renderCaption(segments, font: font, maxWidth: maxWidth + fontSize, background: Self.captionBackground,
                                               scale: scale, alignment: .left, fixedWidth: maxWidth)
        }
        guard let rendered else { return }
        captionLayer.contents = rendered.image
        captionLayer.contentsScale = scale
        captionLayer.bounds = CGRect(origin: .zero, size: rendered.size)
        captionLayer.position = CGPoint(x: (area.minX + area.maxX) / 2, y: Self.captionBottom + rendered.size.height / 2)
        captionLayer.isHidden = false

        guard restartTimer else { return }
        fade(captionLayer, to: 1, duration: 0)
        captionHideWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.caption = ("", "")
            self.fade(self.captionLayer, to: 0, duration: 1)
        }
        captionHideWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.captionHideDelay, execute: work)
    }

    // 逐次表示：2 行に収まるように、古い方を削って末尾だけを表示する（日本語は 1 文字がほぼ文字の大きさの幅）
    private func renderStreamingCaption(committed: String, volatile: String, font: NSFont, maxWidth: CGFloat) -> (image: CGImage, size: CGSize)? {
        var (committed, volatile) = (committed, volatile)
        let limit = max(1, Int(maxWidth / font.pointSize) - 1) * 2
        let overflow = committed.count + volatile.count - limit
        if overflow > 0 {
            if overflow < committed.count {
                committed = String(committed.dropFirst(overflow))
            } else {
                committed = ""
                volatile = String(volatile.suffix(limit))
            }
        }
        return TextImage.renderCaption([(committed, .white), (volatile, Self.captionVolatileColor)],
                                       font: font, maxWidth: maxWidth, background: Self.captionBackground, scale: scale)
    }

    // ========== QR コード ==========
    func setQR(position: QRPosition, text: String) {
        qrPosition = position
        qrText = text
        renderQR(fadeIn: true)
    }

    // トレイメニューを開いている間だけ隠す（オーバーレイはメニューより手前に表示されるため）
    func setQRSuppressed(_ suppressed: Bool) {
        qrSuppressed = suppressed
        fade(qrLayer, to: suppressed ? 0 : 1, duration: 0)
    }

    private func renderQR(fadeIn: Bool) {
        guard qrPosition != .none, W > 0 else {
            qrLayer.isHidden = true
            qrLayer.contents = nil
            return
        }
        let size = qrPosition == .center ? W / 3 : W / 10
        guard let image = QRCodeRenderer.render(qrText, size: size, scale: scale) else { return }
        qrLayer.contents = image
        qrLayer.contentsScale = scale
        qrLayer.bounds = CGRect(x: 0, y: 0, width: size, height: size)
        qrLayer.position = qrPosition == .center
            ? CGPoint(x: W / 2, y: H / 2)
            : CGPoint(x: W - 20 - size / 2, y: flipY(20 + size / 2))
        qrLayer.isHidden = false
        if fadeIn && !qrSuppressed {
            qrLayer.opacity = 0
            fade(qrLayer, to: 1, duration: 2)
        }
    }

    // ========== カメラ ==========
    func setCameraFrame(_ image: CGImage?) {
        guard let image else {
            cameraLayer.contents = nil
            let wasShown = !cameraLayer.isHidden
            cameraLayer.isHidden = true
            cameraImageSize = nil
            if wasShown { renderCaption(restartTimer: false) } // 字幕をカメラのあった場所まで広げる
            return
        }
        cameraLayer.contents = image
        let size = CGSize(width: image.width, height: image.height)
        if cameraImageSize != size {
            cameraImageSize = size
            layoutCamera()
        }
        if cameraLayer.isHidden {
            cameraLayer.isHidden = false
            renderCaption(restartTimer: false) // 字幕をカメラに重ならないように寄せる
        }
    }

    private func layoutCamera() {
        guard let imageSize = cameraImageSize, imageSize.width > 0 else { return }
        let margin: CGFloat = 50
        let width = W * cameraScale
        let height = width * imageSize.height / imageSize.width
        let positions: [CameraPosition: CGPoint] = [
            .topLeft: CGPoint(x: margin + width / 2, y: margin + height / 2),
            .topRight: CGPoint(x: W - margin - width / 2, y: margin + height / 2),
            .bottomLeft: CGPoint(x: margin + width / 2, y: H - margin - height / 2),
            .bottomRight: CGPoint(x: W - margin - width / 2, y: H - margin - height / 2),
            .center: CGPoint(x: W / 2, y: H / 2),
        ]
        let center = positions[cameraPosition] ?? positions[.bottomLeft]!
        cameraLayer.bounds = CGRect(x: 0, y: 0, width: width, height: height)
        cameraLayer.position = CGPoint(x: center.x, y: flipY(center.y))
        renderCaption(restartTimer: false) // カメラの位置・大きさに合わせて字幕を置き直す
    }

    // ========== ホバー ==========
    // カメラ映像と QR コードはマウスを重ねるとふわっと消える
    private func updateHover() {
        guard let window, window.isVisible else { return }
        let point = convert(window.convertPoint(fromScreen: NSEvent.mouseLocation), from: nil)
        updateCommentHover(at: point)
        if !cameraLayer.isHidden {
            fade(cameraLayer, to: cameraLayer.frame.contains(point) ? 0 : 1, duration: 0.3)
        }
        if !qrLayer.isHidden && !qrSuppressed {
            fade(qrLayer, to: qrLayer.frame.contains(point) ? 0 : 1, duration: 0.2)
        }
    }

    // ========== 通知 ==========
    // 画面中央に緑のバッジを出して 5 秒後に消す
    func showNotification(_ text: String) {
        notificationWork?.cancel()
        notificationLayer.removeAllAnimations()
        notificationLayer.sublayers = nil

        let fontSize = max(24, min(48, W / 40))
        let style = TextStyle(font: NSFont.systemFont(ofSize: fontSize, weight: .bold), fill: .white)
        guard let rendered = TextImage.render("ⓘ \(text)", style: style, scale: scale) else { return }
        let padding = CGSize(width: fontSize * 0.65, height: fontSize * 0.35)
        notificationLayer.bounds = CGRect(x: 0, y: 0, width: rendered.size.width + padding.width * 2, height: rendered.size.height + padding.height * 2)
        notificationLayer.backgroundColor = NSColor(srgbRed: 0x19 / 255, green: 0x87 / 255, blue: 0x54 / 255, alpha: 1).cgColor
        notificationLayer.cornerRadius = fontSize * 0.25
        notificationLayer.position = CGPoint(x: W / 2, y: H / 2)
        addImageLayer(rendered, to: notificationLayer).position = CGPoint(x: notificationLayer.bounds.midX, y: notificationLayer.bounds.midY)
        notificationLayer.isHidden = false

        // 下から浮かび上がる
        let center = H / 2
        let fadeIn = CAAnimationGroup()
        let moveIn = CABasicAnimation(keyPath: "position.y")
        moveIn.fromValue = center - 100
        moveIn.toValue = center
        let opacityIn = CABasicAnimation(keyPath: "opacity")
        opacityIn.fromValue = 0
        opacityIn.toValue = 1
        fadeIn.animations = [moveIn, opacityIn]
        fadeIn.duration = 1
        fadeIn.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        notificationLayer.opacity = 1
        notificationLayer.add(fadeIn, forKey: "notification")

        // 5 秒後に下へ消える
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            let fadeOut = CAAnimationGroup()
            let moveOut = CABasicAnimation(keyPath: "position.y")
            moveOut.fromValue = center
            moveOut.toValue = center - 200
            let opacityOut = CABasicAnimation(keyPath: "opacity")
            opacityOut.fromValue = 1
            opacityOut.toValue = 0
            fadeOut.animations = [moveOut, opacityOut]
            fadeOut.duration = 1
            fadeOut.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            self.notificationLayer.opacity = 0
            self.notificationLayer.add(fadeOut, forKey: "notification")
        }
        notificationWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: work)
    }
}
