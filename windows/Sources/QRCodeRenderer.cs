using System;
using System.Linq;
using System.Windows;
using System.Windows.Media;
using QRCoder;

namespace Commentable;

// 投稿ページの QR コード（Electron 版の qr-code-styling と同じ見た目: 丸いドット・中央にロゴ）
static class QRCodeRenderer
{
    private static readonly Brush DotBrush = Frozen(new SolidColorBrush(Color.FromRgb(0x33, 0x33, 0x33)));

    private static Brush Frozen(SolidColorBrush brush)
    {
        brush.Freeze();
        return brush;
    }

    // size × size（DIP）の絵を返す
    public static DrawingImage? Render(string text, double size)
    {
        if (size < 1 || Modules(text) is not { } modules) return null;
        var count = modules.Length;
        var group = new DrawingGroup();
        using (var context = group.Open())
        {
            context.DrawRectangle(Brushes.White, null, new Rect(0, 0, size, size));

            var margin = size / 15;
            var cell = (size - margin * 2) / count;
            Rect CellRect(int row, int col, int span = 1) => new(margin + col * cell, margin + row * cell, cell * span, cell * span);

            // ロゴの後ろのドットを消す範囲（誤り訂正 Q の 25% × imageSize 0.4 まで）
            var logo = AppResources.Image("commentable_logo_text.png");
            int hideCols = 0, hideRows = 0;
            if (logo != null)
            {
                var aspect = (double)logo.PixelWidth / logo.PixelHeight;
                var maxHidden = Math.Floor(0.4 * 0.25 * count * count);
                hideRows = (int)Math.Floor(Math.Sqrt(maxHidden / aspect));
                hideCols = (int)Math.Floor(hideRows * aspect);
                if ((count - hideCols) % 2 != 0) hideCols--;
                if ((count - hideRows) % 2 != 0) hideRows--;
            }
            var hideColStart = (count - hideCols) / 2;
            var hideRowStart = (count - hideRows) / 2;
            bool Hidden(int row, int col) =>
                row >= hideRowStart && row < hideRowStart + hideRows && col >= hideColStart && col < hideColStart + hideCols;

            // 位置検出パターン（左上・右上・左下）は別に描く
            (int Row, int Col)[] finders = [(0, 0), (0, count - 7), (count - 7, 0)];
            bool InFinder(int row, int col) => finders.Any(f => row >= f.Row && row < f.Row + 7 && col >= f.Col && col < f.Col + 7);

            var dots = new StreamGeometry();
            using (var dotContext = dots.Open())
            {
                for (var row = 0; row < count; row++)
                {
                    for (var col = 0; col < count; col++)
                    {
                        if (!modules[row][col] || InFinder(row, col) || Hidden(row, col)) continue;
                        AddEllipse(dotContext, CellRect(row, col));
                    }
                }
            }
            dots.Freeze();
            context.DrawGeometry(DotBrush, null, dots);

            var pen = new Pen(DotBrush, cell);
            pen.Freeze();
            foreach (var (row, col) in finders)
            {
                var outer = CellRect(row, col, 7);
                outer.Inflate(-cell / 2, -cell / 2);
                context.DrawEllipse(null, pen, Center(outer), outer.Width / 2, outer.Height / 2);
                var inner = CellRect(row + 2, col + 2, 3);
                context.DrawEllipse(DotBrush, null, Center(inner), inner.Width / 2, inner.Height / 2);
            }

            if (logo != null && hideCols > 0 && hideRows > 0)
            {
                var area = new Rect(margin + hideColStart * cell, margin + hideRowStart * cell, hideCols * cell, hideRows * cell);
                var aspect = (double)logo.PixelWidth / logo.PixelHeight;
                var rect = area;
                if (area.Width / area.Height > aspect) rect.Width = area.Height * aspect;
                else rect.Height = area.Width / aspect;
                rect.X = area.X + (area.Width - rect.Width) / 2;
                rect.Y = area.Y + (area.Height - rect.Height) / 2;
                context.DrawImage(logo, rect);
            }
        }
        group.Freeze();
        var image = new DrawingImage(group);
        image.Freeze();
        return image;
    }

    private static Point Center(Rect rect) => new(rect.X + rect.Width / 2, rect.Y + rect.Height / 2);

    private static void AddEllipse(StreamGeometryContext context, Rect rect)
    {
        var rx = rect.Width / 2;
        var ry = rect.Height / 2;
        var center = Center(rect);
        context.BeginFigure(new Point(center.X - rx, center.Y), true, true);
        context.ArcTo(new Point(center.X + rx, center.Y), new Size(rx, ry), 0, false, SweepDirection.Clockwise, false, false);
        context.ArcTo(new Point(center.X - rx, center.Y), new Size(rx, ry), 0, false, SweepDirection.Clockwise, false, false);
    }

    // QR コードのモジュール（上の行から順、true が黒）
    private static bool[][]? Modules(string text)
    {
        try
        {
            using var generator = new QRCodeGenerator();
            using var data = generator.CreateQrCode(text, QRCodeGenerator.ECCLevel.Q);
            // 周りの余白（4 モジュール）を除く
            const int quietZone = 4;
            var matrix = data.ModuleMatrix;
            var count = matrix.Count - quietZone * 2;
            if (count <= 0) return null;
            return Enumerable.Range(quietZone, count)
                .Select(row => Enumerable.Range(quietZone, count).Select(col => matrix[row][col]).ToArray())
                .ToArray();
        }
        catch (Exception e)
        {
            Log.Write($"QR code error: {e.Message}");
            return null;
        }
    }
}
