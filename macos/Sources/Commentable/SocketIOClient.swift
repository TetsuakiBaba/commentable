import Foundation

// Socket.IO v4（Engine.IO v4）の最小限のクライアント
// WebSocket だけで接続し、イベントの送受信・ping への応答・自動再接続を行う
// （ack とバイナリのイベントは配信画面では使わないので扱わない）
final class SocketIOClient: NSObject {
    typealias Handler = (Any?) -> Void

    private let endpoint: URL
    private var session: URLSession!
    private var task: URLSessionWebSocketTask?
    private var handlers: [String: [Handler]] = [:]

    private var shouldReconnect = true
    private var reconnectAttempts = 0
    private var reconnectWork: DispatchWorkItem?
    private var heartbeatWork: DispatchWorkItem?
    private var pingInterval: TimeInterval = 25
    private var pingTimeout: TimeInterval = 20

    private(set) var isConnected = false

    init(serverURL: String) {
        var components = URLComponents(string: serverURL) ?? URLComponents(string: AppConfig.productionServer)!
        components.scheme = components.scheme == "http" ? "ws" : "wss"
        components.path = (components.path.hasSuffix("/") ? components.path : components.path + "/") + "socket.io/"
        components.queryItems = [
            URLQueryItem(name: "EIO", value: "4"),
            URLQueryItem(name: "transport", value: "websocket"),
        ]
        endpoint = components.url!
        super.init()
        session = URLSession(configuration: .default, delegate: nil, delegateQueue: .main)
    }

    // ========== イベント ==========
    // 受け取るイベントの引数は1つだけ（配信画面で使うイベントはすべてそう）
    func on(_ event: String, _ handler: @escaping Handler) {
        handlers[event, default: []].append(handler)
    }

    func emit(_ event: String, _ items: Any...) {
        guard isConnected else { return }
        let payload: [Any] = [event] + items
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload, options: [.withoutEscapingSlashes]),
              let json = String(data: data, encoding: .utf8) else {
            NSLog("[socket] cannot encode event: %@", event)
            return
        }
        send("42" + json)
    }

    private func fire(_ event: String, _ argument: Any? = nil) {
        handlers[event]?.forEach { $0(argument) }
    }

    // ========== 接続 ==========
    func connect() {
        shouldReconnect = true
        open()
    }

    // 再接続もしない
    func disconnect() {
        shouldReconnect = false
        reconnectWork?.cancel()
        heartbeatWork?.cancel()
        if isConnected { send("41") }
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        if isConnected {
            isConnected = false
            fire("disconnect", "io client disconnect")
        }
    }

    private func open() {
        reconnectWork?.cancel()
        task?.cancel(with: .goingAway, reason: nil)
        let task = session.webSocketTask(with: endpoint)
        task.maximumMessageSize = 64 * 1024 * 1024 // 授業ログのスナップショットは大きくなることがある
        self.task = task
        task.resume()
        receive(on: task)
        // ハンドシェイクが来なければ切って再接続
        resetHeartbeat(timeout: 20)
    }

    private func send(_ text: String) {
        task?.send(.string(text)) { error in
            if let error { NSLog("[socket] send error: %@", error.localizedDescription) }
        }
    }

    private func receive(on task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            DispatchQueue.main.async {
                guard let self, task === self.task else { return }
                switch result {
                case .success(.string(let text)):
                    self.handleEnginePacket(text)
                    self.receive(on: task)
                case .success:
                    self.receive(on: task) // バイナリは使わない
                case .failure(let error):
                    self.handleClose(reason: error.localizedDescription)
                }
            }
        }
    }

    private func handleClose(reason: String) {
        heartbeatWork?.cancel()
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        let wasConnected = isConnected
        isConnected = false
        if wasConnected {
            fire("disconnect", reason)
        } else {
            fire("connect_error", reason)
        }
        scheduleReconnect()
    }

    // socket.io クライアントと同じく 1 秒から 5 秒まで間隔を延ばしながら再接続する
    private func scheduleReconnect() {
        guard shouldReconnect else { return }
        let base = min(1.0 * pow(2.0, Double(reconnectAttempts)), 5.0)
        let delay = base * Double.random(in: 0.5...1.5)
        reconnectAttempts += 1
        let work = DispatchWorkItem { [weak self] in self?.open() }
        reconnectWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    // サーバーの ping が途絶えたら切断とみなす
    private func resetHeartbeat(timeout: TimeInterval? = nil) {
        heartbeatWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.handleClose(reason: "ping timeout") }
        heartbeatWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + (timeout ?? (pingInterval + pingTimeout)), execute: work)
    }

    // ========== パケット ==========
    private func handleEnginePacket(_ text: String) {
        guard let type = text.first else { return }
        let body = String(text.dropFirst())
        switch type {
        case "0": // open
            if let info = parseJSON(body) as? [String: Any] {
                if let interval = info["pingInterval"] as? Double { pingInterval = interval / 1000 }
                if let timeout = info["pingTimeout"] as? Double { pingTimeout = timeout / 1000 }
            }
            resetHeartbeat()
            send("40") // 既定の名前空間に接続
        case "1": // close
            handleClose(reason: "transport close")
        case "2": // ping
            send("3")
            resetHeartbeat()
        case "4": // message
            handleSocketPacket(body)
        default:
            break
        }
    }

    private func handleSocketPacket(_ text: String) {
        guard let type = text.first else { return }
        var body = Substring(text.dropFirst())
        // 名前空間（"/nsp,"）は使わないが、付いていれば飛ばす
        if body.hasPrefix("/"), let comma = body.firstIndex(of: ",") {
            body = body[body.index(after: comma)...]
        }
        switch type {
        case "0": // CONNECT
            isConnected = true
            reconnectAttempts = 0
            fire("connect")
        case "1": // DISCONNECT（サーバーから切られたときは再接続しない）
            shouldReconnect = false
            handleClose(reason: "io server disconnect")
        case "2": // EVENT
            // ack の ID（数字）が付いていれば飛ばす
            let json = body.drop(while: { $0.isNumber })
            guard let array = parseJSON(String(json)) as? [Any], let event = array.first as? String else { return }
            fire(event, array.count > 1 ? array[1] : nil)
        case "4": // CONNECT_ERROR
            NSLog("[socket] connect error: %@", String(body))
        default:
            break
        }
    }

    private func parseJSON(_ text: String) -> Any? {
        guard let data = text.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }
}
