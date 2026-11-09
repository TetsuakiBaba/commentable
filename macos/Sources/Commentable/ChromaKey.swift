import AppKit
import CoreImage
import ImageIO
import simd

// 単色の背景を透過する（クロマキー）
// 人物の切り抜きを macOS の「背景の置き換え」やグリーンバックに任せ、ここでは色で抜くだけにする。
// 推論をしないので軽く、フレームごとに結果が揺れることもない
//
// 背景の色は、映像の上の左右の隅から自動で決める（人物はふつう中央から下に映るので）。
// 両方の隅が同じ色のときだけ背景とみなす。片方に人物がかかっている間は、それまでの色を使い続ける
final class ChromaKey {
    // ---- 背景が鮮やかな色（緑や青）のとき ----
    // 背景の色の成分（緑なら緑）がほかの 2 つをどれだけ上回るかで、その画素に背景がどれだけ混ざっているかを測る。
    // 輪郭は人物と背景が混ざっているので、混ざっている分だけ透過して背景の色を引くと、色の縁が残らない
    // （背景の色との距離で決めると、半分混ざった画素も不透明になり、輪郭に背景の色が残った）
    // 背景とみなす鮮やかさ（これより地味な色の背景は、下の「距離」で決める）
    private static let vividExcess: Float = 0.3
    // 背景の混ざり具合がこれ以下なら人物だけ、これ以上なら背景だけとみなす
    // （人物の色のわずかな偏りで透けたり、背景のむらが残ったりしないように余裕を持たせる）
    private static let foregroundMix: Float = 0.1
    private static let backgroundMix: Float = 0.85

    // ---- 背景が地味な色（白や灰色）のとき ----
    // 背景の色との距離がこれ以下なら完全に透過し、これ以上なら残す。間はなめらかに変える（輪郭用）
    private static let transparentDistance: Float = 0.08
    private static let opaqueDistance: Float = 0.18
    // 左右の隅の色がこれより離れていたら、背景が単色でない（か、隅に人物が映っている）とみなす
    private static let cornerTolerance: Float = 0.08
    // 背景の色がこれより変わったら、変換表を作り直す
    private static let keyChangeThreshold: Float = 0.02
    private static let cubeSize = 64
    private static let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

    private var key: SIMD3<Float>? // 背景の色（sRGB、0〜1）
    // 色ごとの変換結果を並べた表を持つフィルタ。フレームごとに作り直すと、そのたびに表（4MB）を
    // 処理し直して CPU を使うので、背景の色が変わるまで使い回す
    private var filter: CIFilter?
    private var framesUntilCheck = 0

    func reset() {
        key = nil
        filter = nil
        framesUntilCheck = 0
    }

    // 背景を透過した映像を返す。背景の色がまだ決まらないときは、元の映像をそのまま返す
    func apply(to image: CIImage, context: CIContext) -> CIImage {
        if framesUntilCheck <= 0 {
            updateKey(from: image, context: context)
            // 色の読み取りは GPU からの読み戻しになるので、毎フレームはしない（決まるまでは短い間隔で試す）
            framesUntilCheck = key == nil ? 5 : 30
        } else {
            framesUntilCheck -= 1
        }
        guard let filter else { return image }
        filter.setValue(image, forKey: kCIInputImageKey)
        let output = filter.outputImage ?? image
        filter.setValue(nil, forKey: kCIInputImageKey) // カメラのバッファを次のフレームまで持ち続けない
        return output
    }

    private func updateKey(from image: CIImage, context: CIContext) {
        let extent = image.extent
        // 端そのものは避ける（カメラや映像効果の縁が乗ることがある）
        let margin = CGSize(width: extent.width * 0.02, height: extent.height * 0.02)
        let patch = CGSize(width: extent.width * 0.06, height: extent.height * 0.06)
        let top = extent.maxY - margin.height - patch.height // Core Image は下が原点
        let left = CGRect(x: extent.minX + margin.width, y: top, width: patch.width, height: patch.height)
        let right = CGRect(x: extent.maxX - margin.width - patch.width, y: top, width: patch.width, height: patch.height)
        guard let leftColor = averageColor(of: image, in: left, context: context),
              let rightColor = averageColor(of: image, in: right, context: context),
              Self.distance(leftColor, rightColor) < Self.cornerTolerance else { return }
        let newKey = (leftColor + rightColor) / 2
        if let key, Self.distance(key, newKey) < Self.keyChangeThreshold { return }
        key = newKey
        filter = CIFilter(name: "CIColorCubeWithColorSpace", parameters: [
            "inputCubeDimension": Self.cubeSize,
            "inputCubeData": Self.makeCube(key: newKey),
            "inputColorSpace": Self.colorSpace,
        ])
    }

    private func averageColor(of image: CIImage, in rect: CGRect, context: CIContext) -> SIMD3<Float>? {
        guard !rect.isEmpty else { return nil }
        let average = image.applyingFilter("CIAreaAverage", parameters: [kCIInputExtentKey: CIVector(cgRect: rect)])
        var pixel = [UInt8](repeating: 0, count: 4)
        context.render(average, toBitmap: &pixel, rowBytes: 4, bounds: CGRect(x: 0, y: 0, width: 1, height: 1),
                       format: .RGBA8, colorSpace: Self.colorSpace)
        return SIMD3(Float(pixel[0]), Float(pixel[1]), Float(pixel[2])) / 255
    }

    // 色の近さ。明るさの違いは半分に数える（背景に影や明るさのむらがあっても抜けるように）
    private static func distance(_ a: SIMD3<Float>, _ b: SIMD3<Float>) -> Float {
        simd_length(luminanceAndChroma(a) - luminanceAndChroma(b))
    }

    private static func luminanceAndChroma(_ color: SIMD3<Float>) -> SIMD3<Float> {
        let luminance = simd_dot(color, SIMD3(0.2126, 0.7152, 0.0722))
        return SIMD3(luminance * 0.5, (color.z - luminance) / 1.8556, (color.x - luminance) / 1.5748)
    }

    // すべての色について「どれだけ透過するか」を先に計算しておく（映像にはこの表を引くだけで済む）
    private static func makeCube(key: SIMD3<Float>) -> Data {
        let size = cubeSize
        var values = [Float](repeating: 0, count: size * size * size * 4)
        // 背景の色でいちばん強い成分（0: 赤、1: 緑、2: 青）と、残りの 2 つ
        let channel = key.x >= key.y && key.x >= key.z ? 0 : (key.y >= key.z ? 1 : 2)
        let others = ((channel + 1) % 3, (channel + 2) % 3)
        func excess(_ color: SIMD3<Float>) -> Float { color[channel] - max(color[others.0], color[others.1]) }
        let keyExcess = excess(key)
        values.withUnsafeMutableBufferPointer { buffer in
            var index = 0
            for blue in 0..<size {
                for green in 0..<size {
                    for red in 0..<size { // 赤がいちばん内側（CIColorCube の並び順）
                        let color = SIMD3(Float(red), Float(green), Float(blue)) / Float(size - 1)
                        let alpha: Float
                        let mix = excess(color) / keyExcess // 背景が混ざっている割合（鮮やかな背景のときだけ使う）
                        if keyExcess > vividExcess {
                            alpha = 1 - simd_clamp((mix - foregroundMix) / (backgroundMix - foregroundMix), 0, 1)
                        } else {
                            let t = simd_clamp((distance(color, key) - transparentDistance) / (opaqueDistance - transparentDistance), 0, 1)
                            alpha = t * t * (3 - 2 * t)
                        }
                        // 混ざっている背景の分を引く。引いた結果はアルファを掛けた色（premultiplied）になる
                        var premultiplied = simd_clamp(color - (1 - alpha) * key, SIMD3(repeating: 0), SIMD3(repeating: alpha))
                        if keyExcess > vividExcess {
                            // 引ききれずに残った背景の色味を消す（背景の色の成分に上限をかける）
                            // 人物だけの画素では、ほかの 2 つの大きいほうまで許す（黄色などをそのまま残す）。
                            // 背景が混ざっていそうな画素ほど、2 つの平均まで下げる（肌の輪郭が黄緑に寄らないように）
                            let (a, b) = (premultiplied[others.0], premultiplied[others.1])
                            let suspicion = simd_clamp(mix / foregroundMix, 0, 1)
                            let limit = max(a, b) + ((a + b) / 2 - max(a, b)) * suspicion
                            premultiplied[channel] = min(premultiplied[channel], limit)
                        }
                        // 表にはアルファを掛ける前の色を入れる（CIColorCubeWithColorSpace は表の色にアルファを掛けて出力する。
                        // macOS 26 で確認。掛けた色を入れると、輪郭が二重に暗くなった）
                        let straight = alpha > 0 ? simd_clamp(premultiplied / alpha, SIMD3(repeating: 0), SIMD3(repeating: 1)) : SIMD3(repeating: 0)
                        buffer[index] = straight.x
                        buffer[index + 1] = straight.y
                        buffer[index + 2] = straight.z
                        buffer[index + 3] = alpha
                        index += 4
                    }
                }
            }
        }
        return values.withUnsafeBufferPointer { Data(buffer: $0) }
    }

    // ========== 背景に使う画像 ==========
    // macOS の「背景」（ビデオエフェクト）に指定する、緑一色の画像。
    // 肌や髪の色からいちばん離れた色なので、人物が透けにくい。アプリの中で作るので、どの Mac でもすぐ手に入る
    static let backgroundImageName = "commentable-chromakey-green.png"

    static func backgroundImagePNG() -> Data? {
        let (width, height) = (1920, 1080)
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: colorSpace, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
        context.setFillColor(red: 0, green: 1, blue: 0, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let data = NSMutableData()
        guard let image = context.makeImage(),
              let destination = CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, image, nil)
        return CGImageDestinationFinalize(destination) ? data as Data : nil
    }

    // 保存先を選んでもらって画像を書き出し、Finder で見せる
    static func saveBackgroundImage() {
        let panel = NSSavePanel()
        panel.title = "クロマキー用の背景画像を保存"
        panel.message = "保存した画像を、macOS のビデオエフェクトの「背景」に指定してください"
        panel.nameFieldStringValue = backgroundImageName
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            guard let data = backgroundImagePNG() else { throw CocoaError(.fileWriteUnknown) }
            try data.write(to: url, options: .atomic)
            NSWorkspace.shared.activateFileViewerSelecting([url])
        } catch {
            Dialogs.message(style: .warning, title: "背景画像を保存できませんでした", detail: error.localizedDescription)
        }
    }
}
