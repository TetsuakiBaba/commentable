import AppKit
import CoreImage

// 投稿ページの QR コード（Electron 版の qr-code-styling と同じ見た目: 丸いドット・中央にロゴ）
enum QRCodeRenderer {
    private static let dotColor = NSColor(srgbRed: 0x33 / 255, green: 0x33 / 255, blue: 0x33 / 255, alpha: 1).cgColor
    private static let ciContext = CIContext()

    static func render(_ text: String, size: CGFloat, scale: CGFloat) -> CGImage? {
        guard size >= 1, let modules = modules(for: text) else { return nil }
        let count = modules.count
        let pixels = Int(ceil(size * scale))
        guard let context = CGContext(data: nil, width: pixels, height: pixels, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
        else { return nil }
        context.scaleBy(x: scale, y: scale)
        // 上から下へ描けるように反転する
        context.translateBy(x: 0, y: size)
        context.scaleBy(x: 1, y: -1)

        context.setFillColor(NSColor.white.cgColor)
        context.fill(CGRect(x: 0, y: 0, width: size, height: size))

        let margin = size / 15
        let cell = (size - margin * 2) / CGFloat(count)
        func cellRect(_ row: Int, _ col: Int, _ span: Int = 1) -> CGRect {
            CGRect(x: margin + CGFloat(col) * cell, y: margin + CGFloat(row) * cell, width: cell * CGFloat(span), height: cell * CGFloat(span))
        }

        // ロゴの後ろのドットを消す範囲（誤り訂正 Q の 25% × imageSize 0.4 まで）
        let logo = Resources.image("commentable_logo_text.png")?.cgImage(forProposedRect: nil, context: nil, hints: nil)
        var hideCols = 0, hideRows = 0
        if let logo {
            let aspect = CGFloat(logo.width) / CGFloat(logo.height)
            let maxHidden = floor(0.4 * 0.25 * CGFloat(count * count))
            hideRows = Int(floor(sqrt(maxHidden / aspect)))
            hideCols = Int(floor(CGFloat(hideRows) * aspect))
            if (count - hideCols) % 2 != 0 { hideCols -= 1 }
            if (count - hideRows) % 2 != 0 { hideRows -= 1 }
        }
        let hideColRange = ((count - hideCols) / 2)..<((count + hideCols) / 2)
        let hideRowRange = ((count - hideRows) / 2)..<((count + hideRows) / 2)

        // 位置検出パターン（左上・右上・左下）は別に描く
        let finders = [(0, 0), (0, count - 7), (count - 7, 0)]
        func inFinder(_ row: Int, _ col: Int) -> Bool {
            finders.contains { row >= $0.0 && row < $0.0 + 7 && col >= $0.1 && col < $0.1 + 7 }
        }

        context.setFillColor(dotColor)
        for row in 0..<count {
            for col in 0..<count where modules[row][col] {
                if inFinder(row, col) { continue }
                if hideRowRange.contains(row) && hideColRange.contains(col) { continue }
                context.fillEllipse(in: cellRect(row, col))
            }
        }

        context.setStrokeColor(dotColor)
        context.setLineWidth(cell)
        for (row, col) in finders {
            context.strokeEllipse(in: cellRect(row, col, 7).insetBy(dx: cell / 2, dy: cell / 2))
            context.fillEllipse(in: cellRect(row + 2, col + 2, 3))
        }

        if let logo, hideCols > 0, hideRows > 0 {
            let area = CGRect(x: margin + CGFloat(hideColRange.lowerBound) * cell, y: margin + CGFloat(hideRowRange.lowerBound) * cell,
                              width: CGFloat(hideCols) * cell, height: CGFloat(hideRows) * cell)
            let aspect = CGFloat(logo.width) / CGFloat(logo.height)
            var rect = area
            if area.width / area.height > aspect {
                rect.size.width = area.height * aspect
            } else {
                rect.size.height = area.width / aspect
            }
            rect.origin = CGPoint(x: area.midX - rect.width / 2, y: area.midY - rect.height / 2)
            // 反転した座標系なので画像だけ元に戻して描く
            context.saveGState()
            context.translateBy(x: 0, y: rect.maxY + rect.minY)
            context.scaleBy(x: 1, y: -1)
            context.interpolationQuality = .high
            context.draw(logo, in: rect)
            context.restoreGState()
        }
        return context.makeImage()
    }

    // QR コードのモジュール（上の行から順、true が黒）
    private static func modules(for text: String) -> [[Bool]]? {
        guard let filter = CIFilter(name: "CIQRCodeGenerator") else { return nil }
        filter.setValue(Data(text.utf8), forKey: "inputMessage")
        filter.setValue("Q", forKey: "inputCorrectionLevel")
        guard let output = filter.outputImage, let cgImage = ciContext.createCGImage(output, from: output.extent) else { return nil }

        let width = cgImage.width, height = cgImage.height
        var buffer = [UInt8](repeating: 255, count: width * height)
        guard let gray = CGContext(data: &buffer, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width,
                                   space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return nil }
        gray.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

        // 周りの余白を除く
        var minX = width, minY = height, maxX = -1, maxY = -1
        for y in 0..<height {
            for x in 0..<width where buffer[y * width + x] < 128 {
                minX = min(minX, x); maxX = max(maxX, x)
                minY = min(minY, y); maxY = max(maxY, y)
            }
        }
        guard maxX >= minX, maxY >= minY else { return nil }
        var rows: [[Bool]] = (minY...maxY).map { y in (minX...maxX).map { x in buffer[y * width + x] < 128 } }

        // 右上に位置検出パターンがなければ上下が逆になっている
        let count = rows.count
        if count > 7, !(count - 7..<count).allSatisfy({ rows[0][$0] }) {
            rows.reverse()
        }
        return rows
    }
}
