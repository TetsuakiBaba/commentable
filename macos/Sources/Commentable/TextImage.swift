import AppKit

// 縁取り付きの文字を画像にする（コメントはこの画像をレイヤーに載せて Core Animation で動かす）
struct TextStyle {
    var font: NSFont
    var fill: NSColor
    var stroke: NSColor? = nil
    var strokeWidth: CGFloat = 5
    var background: NSColor? = nil
}

enum TextImage {
    // p5 版は Google Fonts の Noto Sans JP を使っている。入っていなければヒラギノ、なければシステムフォント
    static func font(size: CGFloat, bold: Bool = false) -> NSFont {
        let names = bold ? ["NotoSansJP-Bold", "HiraginoSans-W6"] : ["NotoSansJP-Regular", "HiraginoSans-W3"]
        for name in names {
            if let font = NSFont(name: name, size: size) { return font }
        }
        return NSFont.systemFont(ofSize: size, weight: bold ? .bold : .regular)
    }

    private static func attributed(_ text: String, font: NSFont, color: NSColor) -> NSAttributedString {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        return NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: color, .paragraphStyle: paragraph])
    }

    static func measure(_ text: String, font: NSFont) -> CGSize {
        let rect = attributed(text, font: font, color: .white)
            .boundingRect(with: CGSize(width: 1_000_000, height: 1_000_000), options: [.usesLineFragmentOrigin, .usesFontLeading])
        return CGSize(width: ceil(rect.width), height: ceil(rect.height))
    }

    // 返す size は表示する大きさ（ポイント）。縁取りの分だけ余白を付ける
    static func render(_ text: String, style: TextStyle, scale: CGFloat) -> (image: CGImage, size: CGSize)? {
        let textSize = measure(text, font: style.font)
        let pad = style.stroke != nil ? ceil(style.strokeWidth) : 0
        let size = CGSize(width: textSize.width + pad * 2, height: textSize.height + pad * 2)
        guard size.width >= 1, size.height >= 1 else { return nil }

        // 長いコメントでも画像が大きくなりすぎないように解像度を落とす
        let renderScale = min(scale, 16384 / size.width, 16384 / size.height)
        let pixelWidth = Int(ceil(size.width * renderScale))
        let pixelHeight = Int(ceil(size.height * renderScale))
        guard let context = CGContext(data: nil, width: pixelWidth, height: pixelHeight, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
        else { return nil }
        context.scaleBy(x: renderScale, y: renderScale)

        if let background = style.background {
            context.setFillColor(background.cgColor)
            context.fill(CGRect(origin: .zero, size: size))
        }

        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
        let rect = CGRect(x: pad, y: pad, width: textSize.width, height: textSize.height)
        // p5 と同じく縁取りを先に描いてから塗る（縁取りの外側半分が見える）
        if let stroke = style.stroke, style.strokeWidth > 0 {
            context.setLineJoin(.round)
            let stroked = NSMutableAttributedString(attributedString: attributed(text, font: style.font, color: stroke))
            stroked.addAttributes([
                .strokeColor: stroke,
                .strokeWidth: style.strokeWidth / style.font.pointSize * 100, // 文字サイズに対する割合（%）
            ], range: NSRange(location: 0, length: stroked.length))
            stroked.draw(with: rect, options: [.usesLineFragmentOrigin, .usesFontLeading])
        }
        attributed(text, font: style.font, color: style.fill).draw(with: rect, options: [.usesLineFragmentOrigin, .usesFontLeading])
        NSGraphicsContext.restoreGraphicsState()

        guard let image = context.makeImage() else { return nil }
        return (image, size)
    }
}

extension NSColor {
    // "#rgb" / "#rrggbb" / "#rrggbbaa"（読めなければ nil）
    convenience init?(hex: String?) {
        guard var text = hex?.trimmingCharacters(in: .whitespaces), text.hasPrefix("#") else { return nil }
        text.removeFirst()
        if text.count == 3 { text = text.map { "\($0)\($0)" }.joined() }
        if text.count == 6 { text += "ff" }
        guard text.count == 8, let value = UInt64(text, radix: 16) else { return nil }
        self.init(srgbRed: CGFloat((value >> 24) & 0xff) / 255,
                  green: CGFloat((value >> 16) & 0xff) / 255,
                  blue: CGFloat((value >> 8) & 0xff) / 255,
                  alpha: CGFloat(value & 0xff) / 255)
    }
}
