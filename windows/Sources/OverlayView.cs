using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using System.Windows.Threading;

namespace Commentable;

enum QRPosition { None, Center, TopRight }

enum CameraPosition { TopLeft, TopRight, BottomLeft, BottomRight, Center }

static class CameraPositionExtensions
{
    // 設定ファイルに保存する名前（macOS 版・Electron 版と同じ）
    public static string RawValue(this CameraPosition position) => position switch
    {
        CameraPosition.TopLeft => "top-left",
        CameraPosition.TopRight => "top-right",
        CameraPosition.BottomLeft => "bottom-left",
        CameraPosition.BottomRight => "bottom-right",
        _ => "center",
    };

    public static CameraPosition? Parse(string? value) => value switch
    {
        "top-left" => CameraPosition.TopLeft,
        "top-right" => CameraPosition.TopRight,
        "bottom-left" => CameraPosition.BottomLeft,
        "bottom-right" => CameraPosition.BottomRight,
        "center" => CameraPosition.Center,
        _ => null,
    };
}

// 画面全体の透明なオーバーレイ
// Electron 版は p5.js のキャンバスに毎フレーム描き直していたが、ここではコメントやエフェクトを
// 1つずつ要素にして WPF のアニメーションで動かす（コメントが流れていない間は描き直さない）
//
// 重なり順（下から）: カメラ, 時計, コメント, 隠しコマンドの演出, フラッシュ, コメントコマンド, 管理者メッセージ, QR コード, 通知
sealed class OverlayView : Grid
{
    public const int MaxComments = 50;
    private static readonly TimeSpan CommentDuration = TimeSpan.FromSeconds(10); // コメント表示時間

    private readonly Canvas cameraLayer = new();
    private readonly Canvas clockLayer = new();
    private readonly Canvas commentsLayer = new();
    private readonly Canvas effectLayer = new();
    private readonly Rectangle flashLayer = new() { Fill = Brushes.White, Opacity = 0 };
    private readonly Canvas commandsLayer = new();
    private readonly Canvas adminLayer = new();
    private readonly Canvas qrLayer = new();
    private readonly Canvas notificationLayer = new();

    private readonly Image cameraImage = new() { Stretch = Stretch.Fill, Visibility = Visibility.Collapsed };
    private readonly Image qrImage = new() { Stretch = Stretch.Fill, Visibility = Visibility.Collapsed, CacheMode = new BitmapCache() };

    private bool clockEnabled;
    private readonly DispatcherTimer clockTimer = new();
    private string? adminMessage;
    private QRPosition qrPosition = QRPosition.None;
    private string qrText = "";
    private bool qrSuppressed;
    private Size? cameraImageSize;
    private readonly DispatcherTimer? hoverTimer;
    private readonly DispatcherTimer notificationTimer = new() { Interval = TimeSpan.FromSeconds(5) };
    private double cameraOpacityTarget = 1;
    private double qrOpacityTarget = 1;

    private CameraPosition cameraPosition = CameraPosition.TopRight;
    public CameraPosition CameraPosition
    {
        get => cameraPosition;
        set
        {
            cameraPosition = value;
            LayoutCamera();
        }
    }

    private double cameraScale = 0.15; // 画面幅に対する比率
    public double CameraScale
    {
        get => cameraScale;
        set
        {
            cameraScale = value;
            LayoutCamera();
        }
    }

    private double PixelsPerDip => VisualTreeHelper.GetDpi(this).PixelsPerDip;
    private double W => ActualWidth;
    private double H => ActualHeight;

    // hoverEnabled: カメラ映像と QR コードをマウスを重ねたときに消す（共有用ウィンドウでは消さない）
    public OverlayView(bool hoverEnabled = true)
    {
        IsHitTestVisible = false;
        ClipToBounds = true;
        cameraLayer.Children.Add(cameraImage);
        qrLayer.Children.Add(qrImage);
        foreach (UIElement layer in new UIElement[] { cameraLayer, clockLayer, commentsLayer, effectLayer, flashLayer, commandsLayer, adminLayer, qrLayer, notificationLayer })
        {
            Children.Add(layer);
        }
        clockTimer.Tick += (_, _) => RenderClock();
        notificationTimer.Tick += (_, _) => HideNotification();
        SizeChanged += (_, _) => LayoutOverlay();

        // マウスイベントは受け取らない（クリックは下のアプリに通す）ので、カーソルの位置を見てホバーを判定する
        if (hoverEnabled)
        {
            hoverTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(50) };
            hoverTimer.Tick += (_, _) => UpdateHover();
            hoverTimer.Start();
        }
    }

    // 共有用ウィンドウを閉じたときに止める
    public void Stop()
    {
        clockTimer.Stop();
        hoverTimer?.Stop();
        notificationTimer.Stop();
    }

    protected override void OnDpiChanged(DpiScale oldDpi, DpiScale newDpi)
    {
        base.OnDpiChanged(oldDpi, newDpi);
        LayoutOverlay();
    }

    // 画面サイズや倍率が変わったときに置き直す（流れているコメントはそのまま）
    private void LayoutOverlay()
    {
        foreach (var child in effectLayer.Children)
        {
            if (child is FrameworkElement container)
            {
                container.Width = W;
                container.Height = H;
            }
        }
        RenderClock();
        RenderAdminMessage();
        RenderQR(fadeIn: false);
        LayoutCamera();
    }

    private static void Place(FrameworkElement element, double centerX, double centerY)
    {
        Canvas.SetLeft(element, centerX - element.Width / 2);
        Canvas.SetTop(element, centerY - element.Height / 2);
    }

    private static void RemoveAfter(UIElement element, Panel parent, TimeSpan delay)
    {
        var timer = new DispatcherTimer { Interval = delay };
        timer.Tick += (_, _) =>
        {
            timer.Stop();
            parent.Children.Remove(element);
        };
        timer.Start();
    }

    // 不透明度を変える（途中からでも滑らかに）
    private static void Fade(UIElement element, ref double target, double opacity, double seconds)
    {
        if (target == opacity) return;
        target = opacity;
        if (seconds <= 0)
        {
            element.BeginAnimation(OpacityProperty, null);
            element.Opacity = opacity;
            return;
        }
        element.BeginAnimation(OpacityProperty, new DoubleAnimation(opacity, TimeSpan.FromSeconds(seconds))
        {
            EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut },
        });
    }

    // 0〜1 の時刻に対する値を steps 個に分けたキーフレーム
    private static DoubleAnimationUsingKeyFrames KeyFrames(Func<double, double> value, TimeSpan duration, int steps = 40)
    {
        var animation = new DoubleAnimationUsingKeyFrames { Duration = duration };
        for (var i = 0; i <= steps; i++)
        {
            var t = (double)i / steps;
            animation.KeyFrames.Add(new LinearDoubleKeyFrame(value(t), KeyTime.FromPercent(t)));
        }
        return animation;
    }

    // ========== コメント ==========
    public int ActiveCommentCount => commentsLayer.Children.Count;

    // 表示できたら true（同時に表示できるのは MaxComments 件まで）
    public bool AddComment(string text, string? direction, string? fontSize, Color fill, Color stroke)
    {
        if (ActiveCommentCount >= MaxComments || W <= 0 || H <= 0) return false;

        var baseSize = H / 20;
        var multiplier = fontSize == "small" ? 0.7 : fontSize == "large" ? 1.5 : 1.0;
        var element = new OutlinedText(text, new TextStyle(baseSize * multiplier, fill, stroke, 5), PixelsPerDip);
        if (element.IsEmpty) return false;
        double width = element.Width, height = element.Height;

        // 表示位置（p5 版と同じく標準サイズの文字幅で決める）
        var measured = TextImage.Measure(text, baseSize, PixelsPerDip).Width;
        var x = measured < W ? measured / 2 + Random.Shared.NextDouble() * (W - measured) : measured / 2;
        var y = H > 200 ? 100 + Random.Shared.NextDouble() * (H - 200) : H / 2;

        commentsLayer.Children.Add(element);
        switch (direction)
        {
            case "left":
            case "right":
            {
                // 画面の端から端まで流れる
                var startX = direction == "left" ? W : -width;
                var endX = direction == "left" ? -width : W;
                Canvas.SetLeft(element, 0);
                Canvas.SetTop(element, y - height / 2);
                var move = new TranslateTransform();
                element.RenderTransform = move;
                move.BeginAnimation(TranslateTransform.XProperty, new DoubleAnimation(startX, endX, CommentDuration));
                break;
            }
            case "up":
            case "down":
            {
                // 文字の上端の位置で動かす
                var startY = direction == "up" ? H : -height;
                var endY = direction == "up" ? -height : H;
                Canvas.SetLeft(element, x - width / 2);
                Canvas.SetTop(element, 0);
                var move = new TranslateTransform();
                element.RenderTransform = move;
                move.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(startY, endY, CommentDuration));
                break;
            }
            default:
            {
                // その場でフェードアウトしながら小さくなる
                Place(element, x, y);
                var scale = new ScaleTransform(1, 1, width / 2, height / 2);
                element.RenderTransform = scale;
                var shrink = KeyFrames(t => Math.Sin(0.5 * Math.PI * (1 - t)), CommentDuration);
                scale.BeginAnimation(ScaleTransform.ScaleXProperty, shrink);
                scale.BeginAnimation(ScaleTransform.ScaleYProperty, shrink);
                element.BeginAnimation(OpacityProperty, KeyFrames(t => 1 - t, CommentDuration));
                break;
            }
        }
        RemoveAfter(element, commentsLayer, CommentDuration);
        return true;
    }

    // コメントコマンド =text("文字", x, y)（位置は画面に対する比率、10 秒間表示）
    public void AddTextCommand(string text, double x, double y, Color fill, Color stroke)
    {
        if (H <= 0) return;
        var element = new OutlinedText(text, new TextStyle(H / 15, fill, stroke, 5), PixelsPerDip);
        if (element.IsEmpty) return;
        commandsLayer.Children.Add(element);
        Place(element, x * W, y * H);
        RemoveAfter(element, commandsLayer, TimeSpan.FromSeconds(10));
    }

    public void ClearComments()
    {
        commentsLayer.Children.Clear();
        commandsLayer.Children.Clear();
        effectLayer.Children.Clear();
    }

    // ========== エフェクト ==========
    // 隠しコマンド（hidden == 0）: 画面を暗くしてコメントを大きく表示する
    public void ShowProtofessional(string text)
    {
        effectLayer.Children.Clear();
        if (H <= 0) return;
        var container = new Canvas { Width = W, Height = H, Background = Brushes.Black };
        var element = new OutlinedText(text, new TextStyle(H / 20, Colors.White), PixelsPerDip);
        if (!element.IsEmpty)
        {
            container.Children.Add(element);
            Place(element, W / 2, H / 2);
        }
        effectLayer.Children.Add(container);

        var duration = TimeSpan.FromSeconds(10);
        container.Opacity = 0;
        container.BeginAnimation(OpacityProperty, KeyFrames(t => Math.Cos(0.5 * Math.PI * t), duration));
        RemoveAfter(container, effectLayer, duration);
    }

    // カメラの効果音のときに画面を白く光らせる（p5 版は 60fps で毎フレーム 0.85 倍）
    public void Flash()
    {
        const int frames = 25;
        var animation = new DoubleAnimationUsingKeyFrames { Duration = TimeSpan.FromSeconds(frames / 60.0) };
        for (var i = 0; i <= frames; i++)
        {
            var value = i == frames ? 0 : 55.0 / 255.0 * Math.Pow(0.85, i);
            animation.KeyFrames.Add(new LinearDoubleKeyFrame(value, KeyTime.FromPercent((double)i / frames)));
        }
        flashLayer.BeginAnimation(OpacityProperty, animation);
    }

    // ========== 時計 ==========
    public void SetClock(bool enabled)
    {
        clockEnabled = enabled;
        RenderClock();
    }

    private void RenderClock()
    {
        clockTimer.Stop();
        clockLayer.Children.Clear();
        if (!clockEnabled || H <= 0) return;
        var now = DateTime.Now;
        var element = new OutlinedText(now.ToString("HH:mm"), new TextStyle(H / 15, Colors.White, Colors.Black, 5, bold: true), PixelsPerDip);
        Canvas.SetLeft(element, 20 - 5);
        Canvas.SetTop(element, 10 - 5);
        clockLayer.Children.Add(element);
        // 分が変わるときだけ描き直す
        clockTimer.Interval = TimeSpan.FromSeconds(60 - now.Second - now.Millisecond / 1000.0 + 0.05);
        clockTimer.Start();
    }

    // ========== 管理者メッセージ ==========
    public void SetAdminMessage(bool show, string text)
    {
        adminMessage = show && text.Length > 0 ? text : null;
        RenderAdminMessage();
    }

    private void RenderAdminMessage()
    {
        adminLayer.Children.Clear();
        if (adminMessage is not { } text || H <= 0) return;
        var element = new OutlinedText(text, new TextStyle(H / 20, Colors.White, background: Colors.Black), PixelsPerDip);
        if (element.IsEmpty) return;
        adminLayer.Children.Add(element);
        Place(element, W / 2, H / 2);
    }

    // ========== QR コード ==========
    public void SetQR(QRPosition position, string text)
    {
        qrPosition = position;
        qrText = text;
        RenderQR(fadeIn: true);
    }

    // トレイメニューを開いている間だけ隠す（オーバーレイはメニューより手前に表示されることがあるため）
    public void SetQRSuppressed(bool suppressed)
    {
        qrSuppressed = suppressed;
        Fade(qrImage, ref qrOpacityTarget, suppressed ? 0 : 1, 0);
    }

    private void RenderQR(bool fadeIn)
    {
        if (qrPosition == QRPosition.None || W <= 0)
        {
            qrImage.Visibility = Visibility.Collapsed;
            qrImage.Source = null;
            return;
        }
        var size = qrPosition == QRPosition.Center ? W / 3 : W / 10;
        if (QRCodeRenderer.Render(qrText, size) is not { } image) return;
        qrImage.Source = image;
        qrImage.Width = size;
        qrImage.Height = size;
        if (qrPosition == QRPosition.Center) Place(qrImage, W / 2, H / 2);
        else Place(qrImage, W - 20 - size / 2, 20 + size / 2);
        qrImage.Visibility = Visibility.Visible;
        if (fadeIn && !qrSuppressed)
        {
            Fade(qrImage, ref qrOpacityTarget, 0, 0);
            Fade(qrImage, ref qrOpacityTarget, 1, 2);
        }
    }

    // ========== カメラ ==========
    // 同じ画像（WriteableBitmap）を書き換えながら渡される。null はカメラ停止
    public void SetCameraFrame(BitmapSource? image)
    {
        if (image == null)
        {
            cameraImage.Source = null;
            cameraImage.Visibility = Visibility.Collapsed;
            cameraImageSize = null;
            return;
        }
        if (cameraImage.Source != image) cameraImage.Source = image;
        var size = new Size(image.PixelWidth, image.PixelHeight);
        if (cameraImageSize != size)
        {
            cameraImageSize = size;
            LayoutCamera();
        }
        cameraImage.Visibility = Visibility.Visible;
    }

    private void LayoutCamera()
    {
        if (cameraImageSize is not { Width: > 0 } imageSize) return;
        const double margin = 50;
        var width = W * cameraScale;
        var height = width * imageSize.Height / imageSize.Width;
        var center = cameraPosition switch
        {
            CameraPosition.TopLeft => new Point(margin + width / 2, margin + height / 2),
            CameraPosition.TopRight => new Point(W - margin - width / 2, margin + height / 2),
            CameraPosition.BottomLeft => new Point(margin + width / 2, H - margin - height / 2),
            CameraPosition.BottomRight => new Point(W - margin - width / 2, H - margin - height / 2),
            _ => new Point(W / 2, H / 2),
        };
        cameraImage.Width = width;
        cameraImage.Height = height;
        Place(cameraImage, center.X, center.Y);
    }

    // ========== ホバー ==========
    // カメラ映像と QR コードはマウスを重ねるとふわっと消える
    private void UpdateHover()
    {
        if (!IsVisible || PresentationSource.FromVisual(this) == null || !Native.GetCursorPos(out var cursor)) return;
        var point = PointFromScreen(new Point(cursor.X, cursor.Y));
        static Rect Bounds(FrameworkElement element) =>
            new(Canvas.GetLeft(element), Canvas.GetTop(element), element.Width, element.Height);
        if (cameraImage.Visibility == Visibility.Visible)
        {
            Fade(cameraImage, ref cameraOpacityTarget, Bounds(cameraImage).Contains(point) ? 0 : 1, 0.3);
        }
        if (qrImage.Visibility == Visibility.Visible && !qrSuppressed)
        {
            Fade(qrImage, ref qrOpacityTarget, Bounds(qrImage).Contains(point) ? 0 : 1, 0.2);
        }
    }

    // ========== 通知 ==========
    // 画面中央に緑のバッジを出して 5 秒後に消す
    private Border? notification;

    public void ShowNotification(string text)
    {
        notificationTimer.Stop();
        notificationLayer.Children.Clear();
        notification = null;
        if (W <= 0) return;

        var fontSize = Math.Max(24, Math.Min(48, W / 40));
        var label = new OutlinedText($"ⓘ {text}", new TextStyle(fontSize, Colors.White, bold: true) { SystemFont = true }, PixelsPerDip);
        var padding = new Size(fontSize * 0.65, fontSize * 0.35);
        var badge = new Border
        {
            Background = new SolidColorBrush(Color.FromRgb(0x19, 0x87, 0x54)),
            CornerRadius = new CornerRadius(fontSize * 0.25),
            Padding = new Thickness(padding.Width, padding.Height, padding.Width, padding.Height),
            Child = label,
            Width = label.Width + padding.Width * 2,
            Height = label.Height + padding.Height * 2,
        };
        notificationLayer.Children.Add(badge);
        Place(badge, W / 2, H / 2);
        notification = badge;

        // 下から浮かび上がる
        var move = new TranslateTransform();
        badge.RenderTransform = move;
        var ease = new SineEase { EasingMode = EasingMode.EaseInOut };
        var second = TimeSpan.FromSeconds(1);
        move.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(100, 0, second) { EasingFunction = ease });
        badge.BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, second) { EasingFunction = ease });

        // 5 秒後に下へ消える
        notificationTimer.Start();
    }

    private void HideNotification()
    {
        notificationTimer.Stop();
        if (notification is not { RenderTransform: TranslateTransform move } badge) return;
        var ease = new SineEase { EasingMode = EasingMode.EaseInOut };
        var second = TimeSpan.FromSeconds(1);
        move.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(0, 200, second) { EasingFunction = ease });
        badge.BeginAnimation(OpacityProperty, new DoubleAnimation(1, 0, second) { EasingFunction = ease });
    }
}
