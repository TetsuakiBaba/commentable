using System;
using System.Collections.Generic;
using System.Globalization;
using System.Windows;
using System.Windows.Media;

namespace Commentable;

// 縁取り付きの文字
struct TextStyle
{
    public double FontSize;
    public bool Bold;
    public bool SystemFont; // 通知などは UI のフォントで表示する
    public Color Fill;
    public Color? Stroke;
    public double StrokeWidth;
    public Color? Background;

    public TextStyle(double fontSize, Color fill, Color? stroke = null, double strokeWidth = 5, Color? background = null, bool bold = false)
    {
        FontSize = fontSize;
        Fill = fill;
        Stroke = stroke;
        StrokeWidth = strokeWidth;
        Background = background;
        Bold = bold;
        SystemFont = false;
    }
}

static class TextImage
{
    // p5 版は Google Fonts の Noto Sans JP を使っている。入っていなければ游ゴシック、なければメイリオ
    private static readonly FontFamily CommentFont = new("Noto Sans JP, Yu Gothic UI, Yu Gothic, Meiryo UI, Meiryo, Segoe UI");
    private static readonly FontFamily SystemFont = new("Yu Gothic UI, Meiryo UI, Segoe UI");
    private static readonly FontFamily EmojiFont = new("Segoe UI Emoji");

    public static FormattedText Format(string text, TextStyle style, double pixelsPerDip)
    {
        var typeface = new Typeface(style.SystemFont ? SystemFont : CommentFont, FontStyles.Normal,
            style.Bold ? FontWeights.Bold : FontWeights.Normal, FontStretches.Normal);
        var formatted = new FormattedText(text, CultureInfo.GetCultureInfo("ja-JP"), FlowDirection.LeftToRight, typeface,
            Math.Max(1, style.FontSize), Brushes.White, pixelsPerDip);
        // ❤️ のように後ろに絵文字の指定（U+FE0F）が付いた記号は、絵文字のフォントで描く
        // （WPF は指定を見ずに普通のフォントの記号を使ってしまう）
        for (var i = text.IndexOf('️'); i > 0; i = text.IndexOf('️', i + 1))
        {
            var start = i >= 2 && char.IsSurrogatePair(text[i - 2], text[i - 1]) ? i - 2 : i - 1;
            var end = i + 1 < text.Length && text[i + 1] == '⃣' ? i + 2 : i + 1; // キーキャップ（1️⃣ など）
            formatted.SetFontFamily(EmojiFont, start, end - start);
        }
        // 複数行のときは行ごとに中央揃え
        formatted.MaxTextWidth = Math.Max(1, formatted.WidthIncludingTrailingWhitespace + 0.5);
        formatted.TextAlignment = TextAlignment.Center;
        return formatted;
    }

    public static Size Measure(string text, double fontSize, double pixelsPerDip)
    {
        var formatted = Format(text, new TextStyle(fontSize, Colors.White), pixelsPerDip);
        return new Size(Math.Ceiling(formatted.WidthIncludingTrailingWhitespace), Math.Ceiling(formatted.Height));
    }

    // "#rgb" / "#rrggbb" / "#rrggbbaa"（読めなければ null）
    public static Color? ParseHex(string? hex)
    {
        var text = hex?.Trim();
        if (text == null || !text.StartsWith('#')) return null;
        text = text[1..];
        if (text.Length == 3) text = string.Concat(text[0], text[0], text[1], text[1], text[2], text[2]);
        if (text.Length == 6) text += "ff";
        if (text.Length != 8 || !uint.TryParse(text, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var value)) return null;
        return Color.FromArgb((byte)(value & 0xff), (byte)(value >> 24), (byte)((value >> 16) & 0xff), (byte)((value >> 8) & 0xff));
    }
}

// 縁取り付きの文字を表示する要素（コメントはこれを Canvas に置いてアニメーションで動かす）
// 大きさ（Width / Height）は縁取りの分だけ余白を付けたもの
// 絵文字はフォントのカラーレイヤー（COLR / CPAL）で色を付けて描く（WPF はカラー絵文字を描かないため）
sealed class OutlinedText : FrameworkElement
{
    private readonly Geometry outline; // 縁取りする形（すべての文字）
    private readonly List<(Geometry Geometry, Brush Brush)> fills = new(); // 塗る形と色（描く順）
    private readonly Pen? pen;
    private readonly Brush? background;

    public OutlinedText(string text, TextStyle style, double pixelsPerDip)
    {
        var formatted = TextImage.Format(text, style, pixelsPerDip);
        var textWidth = Math.Ceiling(formatted.WidthIncludingTrailingWhitespace);
        var textHeight = Math.Ceiling(formatted.Height);
        var pad = style.Stroke != null ? Math.Ceiling(style.StrokeWidth) : 0;
        Width = textWidth + pad * 2;
        Height = textHeight + pad * 2;

        var fill = Frozen(new SolidColorBrush(style.Fill));
        outline = BuildGlyphs(formatted, new Point(pad, pad), fill);
        if (style.Stroke is { } stroke && style.StrokeWidth > 0)
        {
            pen = new Pen(Frozen(new SolidColorBrush(stroke)), style.StrokeWidth) { LineJoin = PenLineJoin.Round };
            pen.Freeze();
        }
        if (style.Background is { } color) background = Frozen(new SolidColorBrush(color));

        IsHitTestVisible = false;
        // 動かしても描き直さないように画像として持つ（長いコメントでも大きくなりすぎないように解像度を落とす）
        var longest = Math.Max(Width, Height) * pixelsPerDip;
        CacheMode = new BitmapCache { RenderAtScale = longest > 8192 ? 8192 / longest : 1, SnapsToDevicePixels = false };
    }

    private static Brush Frozen(SolidColorBrush brush)
    {
        brush.Freeze();
        return brush;
    }

    public bool IsEmpty => Width < 1 || Height < 1;

    // 文字を形にする。カラー絵文字の文字はレイヤーごとに色を付け、それ以外は fill で塗る
    // （FormattedText を記録すると、フォントごとに組まれた GlyphRun が取り出せる）
    private Geometry BuildGlyphs(FormattedText formatted, Point origin, Brush fill)
    {
        var recorded = new DrawingGroup();
        using (var context = recorded.Open()) context.DrawText(formatted, origin);

        var all = new GeometryGroup { FillRule = FillRule.Nonzero };
        var plain = new GeometryGroup { FillRule = FillRule.Nonzero };
        void Walk(Drawing drawing)
        {
            if (drawing is DrawingGroup group)
            {
                foreach (var child in group.Children) Walk(child);
                return;
            }
            if (drawing is not GlyphRunDrawing { GlyphRun: { } run }) return;
            all.Children.Add(run.BuildGeometry());
            if (ColorFont.For(run.GlyphTypeface) is not { } colorFont)
            {
                plain.Children.Add(run.BuildGeometry());
                return;
            }
            var x = run.BaselineOrigin.X;
            for (var i = 0; i < run.GlyphIndices.Count; i++)
            {
                var offset = run.GlyphOffsets is { Count: > 0 } offsets ? offsets[i] : default;
                var glyphOrigin = new Point(x + offset.X, run.BaselineOrigin.Y - offset.Y);
                var advance = run.AdvanceWidths[i];
                var layers = colorFont.Layers(run.GlyphIndices[i]);
                if (layers.Count == 0)
                {
                    plain.Children.Add(SingleGlyph(run, run.GlyphIndices[i], glyphOrigin, advance).BuildGeometry());
                }
                else
                {
                    // レイヤーを下から順に重ねる（色が「文字の色」のレイヤーは fill で塗る）
                    foreach (var (glyph, color) in layers)
                    {
                        var geometry = SingleGlyph(run, glyph, glyphOrigin, advance).BuildGeometry();
                        geometry.Freeze();
                        fills.Add((geometry, color is { } c ? Frozen(new SolidColorBrush(c)) : fill));
                    }
                }
                x += advance;
            }
        }
        Walk(recorded);
        plain.Freeze();
        fills.Insert(0, (plain, fill));
        all.Freeze();
        return all;
    }

    private static GlyphRun SingleGlyph(GlyphRun run, ushort glyph, Point origin, double advance) =>
        new(run.GlyphTypeface, 0, false, run.FontRenderingEmSize, (float)run.PixelsPerDip, [glyph], origin, [advance],
            null, null, null, null, null, null);

    protected override void OnRender(DrawingContext context)
    {
        if (background != null) context.DrawRectangle(background, null, new Rect(0, 0, Width, Height));
        // p5 と同じく縁取りを先に描いてから塗る（縁取りの外側半分が見える）
        if (pen != null) context.DrawGeometry(null, pen, outline);
        foreach (var (geometry, brush) in fills) context.DrawGeometry(brush, null, geometry);
    }
}

// フォントのカラーレイヤー（OpenType の COLR v0 と CPAL の最初のパレット）
// Windows の絵文字フォント（Segoe UI Emoji）は、文字ごとに「形（グリフ）と色」のレイヤーを持っている
sealed class ColorFont
{
    private static readonly Dictionary<Uri, ColorFont?> Cache = new();

    private readonly Dictionary<ushort, (int First, int Count)> baseGlyphs = new();
    private readonly (ushort Glyph, ushort Palette)[] layers;
    private readonly Color[] palette;

    private ColorFont((ushort Glyph, ushort Palette)[] layers, Color[] palette)
    {
        this.layers = layers;
        this.palette = palette;
    }

    // 色の null は「文字の色」
    public List<(ushort Glyph, Color? Color)> Layers(ushort glyph)
    {
        var result = new List<(ushort, Color?)>();
        if (!baseGlyphs.TryGetValue(glyph, out var range)) return result;
        for (var i = range.First; i < range.First + range.Count && i < layers.Length; i++)
        {
            var (layerGlyph, index) = layers[i];
            result.Add((layerGlyph, index < palette.Length ? palette[index] : null));
        }
        return result;
    }

    // カラーレイヤーのないフォントは null
    public static ColorFont? For(GlyphTypeface typeface)
    {
        lock (Cache)
        {
            if (Cache.TryGetValue(typeface.FontUri, out var cached)) return cached;
            ColorFont? font = null;
            try
            {
                using var stream = typeface.GetFontStream();
                font = Read(stream);
            }
            catch (Exception e) when (e is System.IO.IOException or ArgumentException or InvalidOperationException or UnauthorizedAccessException)
            {
                Log.Write($"Cannot read color font {typeface.FontUri}: {e.Message}");
            }
            Cache[typeface.FontUri] = font;
            return font;
        }
    }

    private static ColorFont? Read(System.IO.Stream stream)
    {
        var reader = new System.IO.BinaryReader(stream);
        ushort U16() => (ushort)((reader.ReadByte() << 8) | reader.ReadByte());
        uint U32() => ((uint)U16() << 16) | U16();

        // テーブルの一覧（フォントコレクション .ttc は扱わない）
        stream.Position = 0;
        if (U32() == 0x74746366) return null; // 'ttcf'
        var tableCount = U16();
        stream.Position = 12;
        uint colr = 0, cpal = 0;
        for (var i = 0; i < tableCount; i++)
        {
            var tag = U32();
            U32(); // checksum
            var offset = U32();
            U32(); // length
            if (tag == 0x434F4C52) colr = offset; // 'COLR'
            if (tag == 0x4350414C) cpal = offset; // 'CPAL'
        }
        if (colr == 0 || cpal == 0) return null;

        // CPAL: 最初のパレットの色（BGRA）
        stream.Position = cpal;
        U16(); // version
        var entryCount = U16();
        var paletteCount = U16();
        U16(); // numColorRecords
        var recordsOffset = U32();
        if (paletteCount == 0) return null;
        var firstRecord = U16();
        var palette = new Color[entryCount];
        stream.Position = cpal + recordsOffset + firstRecord * 4L;
        for (var i = 0; i < entryCount; i++)
        {
            var bgra = reader.ReadBytes(4);
            palette[i] = Color.FromArgb(bgra[3], bgra[2], bgra[1], bgra[0]);
        }

        // COLR v0: 元の文字 → レイヤーの範囲、レイヤー → 形と色の番号
        stream.Position = colr;
        U16(); // version（v1 にも v0 の情報が入っている）
        var baseCount = U16();
        var baseOffset = U32();
        var layerOffset = U32();
        var layerCount = U16();
        var layers = new (ushort, ushort)[layerCount];
        stream.Position = colr + layerOffset;
        for (var i = 0; i < layerCount; i++) layers[i] = (U16(), U16());
        var font = new ColorFont(layers, palette);
        stream.Position = colr + baseOffset;
        for (var i = 0; i < baseCount; i++)
        {
            var glyph = U16();
            var first = U16();
            var count = U16();
            font.baseGlyphs[glyph] = (first, count);
        }
        return font.baseGlyphs.Count > 0 ? font : null;
    }
}
