import AppKit

// コメントやエフェクトを、画面全体のオーバーレイと共有用ウィンドウの両方に表示する
// 共有用ウィンドウを開いたときは、表示中の設定（QR コード・時計・管理者メッセージ・カメラ）を合わせる
final class OverlayGroup {
    let main: OverlayView
    private var extras: [OverlayView] = []
    private var all: [OverlayView] { [main] + extras }

    private var qr: (position: QRPosition, text: String) = (.none, "")
    private var clock = false
    private var adminMessage: (show: Bool, text: String) = (false, "")
    private var cameraFrame: CameraFrame?
    private var caption: (committed: String, volatile: String) = ("", "")
    private var starred = Set<String>() // スターを付けたコメントの ID
    var showNames = true // コメントに参加者の表示名を付けるか

    var cameraPosition: CameraPosition = .topRight {
        didSet { all.forEach { $0.cameraPosition = cameraPosition } }
    }
    var cameraScale: CGFloat = 0.15 {
        didSet { all.forEach { $0.cameraScale = cameraScale } }
    }
    var captionStyle: CaptionStyle = .streaming {
        didSet { all.forEach { $0.captionStyle = captionStyle } }
    }

    init(main: OverlayView) {
        self.main = main
    }

    func attach(_ overlay: OverlayView) {
        extras.append(overlay)
        overlay.cameraPosition = cameraPosition
        overlay.cameraScale = cameraScale
        overlay.captionStyle = captionStyle
        overlay.setQR(position: qr.position, text: qr.text)
        overlay.setClock(clock)
        overlay.setAdminMessage(show: adminMessage.show, text: adminMessage.text)
        overlay.setCameraFrame(cameraFrame)
        overlay.setCaption(committed: caption.committed, volatile: caption.volatile)
    }

    func detach(_ overlay: OverlayView) {
        extras.removeAll { $0 === overlay }
    }

    // 表示できたら true（同時に表示できる数は画面全体のオーバーレイで判断する）
    @discardableResult
    func addComment(_ text: String, name: String?, id: String?, direction: String?, fontSize: String?, fill: NSColor, stroke: NSColor) -> Bool {
        let isStarred = id.map(starred.contains) ?? false
        let name = showNames ? name : nil
        guard main.addComment(text, name: name, id: id, starred: isStarred, direction: direction, fontSize: fontSize, fill: fill, stroke: stroke) else { return false }
        extras.forEach { $0.addComment(text, name: name, id: id, starred: isStarred, direction: direction, fontSize: fontSize, fill: fill, stroke: stroke) }
        return true
    }

    func isStarred(_ commentID: String) -> Bool {
        starred.contains(commentID)
    }

    func setStar(commentID: String, starred isStarred: Bool) {
        if isStarred { starred.insert(commentID) } else { starred.remove(commentID) }
        all.forEach { $0.setStar(commentID: commentID, starred: isStarred) }
    }

    func addTextCommand(_ text: String, x: CGFloat, y: CGFloat, fill: NSColor, stroke: NSColor) {
        all.forEach { $0.addTextCommand(text, x: x, y: y, fill: fill, stroke: stroke) }
    }

    func showProtofessional(_ text: String) {
        all.forEach { $0.showProtofessional(text) }
    }

    func flash() {
        all.forEach { $0.flash() }
    }

    func clearComments() {
        all.forEach { $0.clearComments() }
    }

    func setAdminMessage(show: Bool, text: String) {
        adminMessage = (show, text)
        all.forEach { $0.setAdminMessage(show: show, text: text) }
    }

    func setQR(position: QRPosition, text: String) {
        qr = (position, text)
        all.forEach { $0.setQR(position: position, text: text) }
    }

    func setClock(_ enabled: Bool) {
        clock = enabled
        all.forEach { $0.setClock(enabled) }
    }

    func setCaption(committed: String, volatile: String) {
        caption = (committed, volatile)
        all.forEach { $0.setCaption(committed: committed, volatile: volatile) }
    }

    func setCameraFrame(_ frame: CameraFrame?) {
        cameraFrame = frame
        all.forEach { $0.setCameraFrame(frame) }
    }

    // 配信者向けの通知（資料欄に送信しました など）は画面全体のオーバーレイにだけ出す
    func showNotification(_ text: String) {
        main.showNotification(text)
    }
}
