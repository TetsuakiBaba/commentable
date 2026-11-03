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

    // ヒラギノは行間（leading）が 0.5em と大きく、最後の行の下にも付くので背景の下側だけ余白が広くなる。
    // 背景を付けるときはこの分を除いて上下の余白を揃える
    private static func trailingLeading(_ font: NSFont) -> CGFloat {
        max(0, font.leading)
    }

    // 返す size は表示する大きさ（ポイント）。縁取りの分だけ余白を付ける（背景付きは文字の大きさに合わせた余白）
    static func render(_ text: String, style: TextStyle, scale: CGFloat) -> (image: CGImage, size: CGSize)? {
        var textSize = measure(text, font: style.font)
        let pad: CGFloat
        var leading: CGFloat = 0
        if style.background != nil {
            leading = trailingLeading(style.font)
            pad = ceil(style.font.pointSize * 0.25)
        } else {
            pad = style.stroke != nil ? ceil(style.strokeWidth) : 0
        }
        textSize.height -= leading
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
        // 最後の行の行間は画像の下にはみ出させる
        let rect = CGRect(x: pad, y: pad - leading, width: textSize.width, height: textSize.height + leading)
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

    // 字幕: 色の違う文字列をつなげ、maxWidth で折り返して角丸の背景に載せる
    // fixedWidth を指定すると、文字の量によらず背景の幅をその幅にする（行が伸びても背景の大きさが変わらない）
    static func renderCaption(_ segments: [(text: String, color: NSColor)], font: NSFont, maxWidth: CGFloat, background: NSColor, scale: CGFloat,
                              alignment: NSTextAlignment = .center, fixedWidth: CGFloat? = nil) -> (image: CGImage, size: CGSize)? {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = alignment
        let text = NSMutableAttributedString()
        for segment in segments where !segment.text.isEmpty {
            text.append(NSAttributedString(string: segment.text, attributes: [.font: font, .foregroundColor: segment.color, .paragraphStyle: paragraph]))
        }
        guard text.length > 0 else { return nil }
        let bounds = text.boundingRect(with: CGSize(width: maxWidth, height: 1_000_000), options: [.usesLineFragmentOrigin, .usesFontLeading])
        let leading = trailingLeading(font)
        let textSize = CGSize(width: fixedWidth ?? ceil(bounds.width), height: ceil(bounds.height) - leading)
        let pad = CGSize(width: font.pointSize * 0.6, height: font.pointSize * 0.3)
        let size = CGSize(width: textSize.width + pad.width * 2, height: textSize.height + pad.height * 2)

        let pixelWidth = Int(ceil(size.width * scale))
        let pixelHeight = Int(ceil(size.height * scale))
        guard pixelWidth > 0, pixelHeight > 0,
              let context = CGContext(data: nil, width: pixelWidth, height: pixelHeight, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
        else { return nil }
        context.scaleBy(x: scale, y: scale)
        context.setFillColor(background.cgColor)
        context.addPath(CGPath(roundedRect: CGRect(origin: .zero, size: size), cornerWidth: font.pointSize * 0.25, cornerHeight: font.pointSize * 0.25, transform: nil))
        context.fillPath()

        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
        text.draw(with: CGRect(x: pad.width, y: pad.height - leading, width: textSize.width, height: textSize.height + leading), options: [.usesLineFragmentOrigin, .usesFontLeading])
        NSGraphicsContext.restoreGraphicsState()

        guard let image = context.makeImage() else { return nil }
        return (image, size)
    }
}

extension TextImage {
    // 文字列を width に収まる行に分ける（日本語の禁則も Core Text が扱う）
    static func wrap(_ text: String, font: NSFont, width: CGFloat) -> [String] {
        guard !text.isEmpty, width > 0 else { return [] }
        let typesetter = CTTypesetterCreateWithAttributedString(NSAttributedString(string: text, attributes: [.font: font]))
        let string = text as NSString
        var lines: [String] = []
        var start = 0
        while start < string.length {
            let count = max(1, CTTypesetterSuggestLineBreak(typesetter, start, Double(width)))
            let range = string.rangeOfComposedCharacterSequences(for: NSRange(location: start, length: min(count, string.length - start)))
            lines.append(string.substring(with: range))
            start = range.location + range.length
        }
        return lines
    }

    // 時計など短い 1 行の文字を角丸の背景に載せる。数字が上下の真ん中に来るように、行の高さではなく
    // 大文字の高さ（capHeight）で背景の大きさを決める
    static func renderBadge(_ text: String, font: NSFont, color: NSColor, background: NSColor, scale: CGFloat) -> (image: CGImage, size: CGSize)? {
        let attributed = NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: color])
        let line = CTLineCreateWithAttributedString(attributed)
        let textWidth = ceil(CTLineGetTypographicBounds(line, nil, nil, nil))
        let pad = CGSize(width: font.pointSize * 0.45, height: font.pointSize * 0.3)
        let size = CGSize(width: textWidth + pad.width * 2, height: ceil(font.capHeight + pad.height * 2))

        let pixelWidth = Int(ceil(size.width * scale))
        let pixelHeight = Int(ceil(size.height * scale))
        guard textWidth > 0,
              let context = CGContext(data: nil, width: pixelWidth, height: pixelHeight, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
        else { return nil }
        context.scaleBy(x: scale, y: scale)
        context.setFillColor(background.cgColor)
        let radius = size.height * 0.28
        context.addPath(CGPath(roundedRect: CGRect(origin: .zero, size: size), cornerWidth: radius, cornerHeight: radius, transform: nil))
        context.fillPath()

        context.textPosition = CGPoint(x: pad.width, y: (size.height - font.capHeight) / 2)
        CTLineDraw(line, context)

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
