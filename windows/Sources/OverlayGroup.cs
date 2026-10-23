using System.Collections.Generic;
using System.Linq;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace Commentable;

// コメントやエフェクトを、画面全体のオーバーレイと共有用ウィンドウの両方に表示する
// 共有用ウィンドウを開いたときは、表示中の設定（QR コード・時計・管理者メッセージ・カメラ）を合わせる
sealed class OverlayGroup(OverlayView main)
{
    public OverlayView Main { get; } = main;
    private readonly List<OverlayView> extras = new();
    private IEnumerable<OverlayView> All => extras.Prepend(Main).ToList();

    private (QRPosition Position, string Text) qr = (QRPosition.None, "");
    private bool clock;
    private (bool Show, string Text) adminMessage = (false, "");
    private BitmapSource? cameraFrame;

    private CameraPosition cameraPosition = CameraPosition.TopRight;
    public CameraPosition CameraPosition
    {
        get => cameraPosition;
        set
        {
            cameraPosition = value;
            foreach (var overlay in All) overlay.CameraPosition = value;
        }
    }

    private double cameraScale = 0.15;
    public double CameraScale
    {
        get => cameraScale;
        set
        {
            cameraScale = value;
            foreach (var overlay in All) overlay.CameraScale = value;
        }
    }

    public void Attach(OverlayView overlay)
    {
        extras.Add(overlay);
        overlay.CameraPosition = cameraPosition;
        overlay.CameraScale = cameraScale;
        overlay.SetQR(qr.Position, qr.Text);
        overlay.SetClock(clock);
        overlay.SetAdminMessage(adminMessage.Show, adminMessage.Text);
        overlay.SetCameraFrame(cameraFrame);
    }

    public void Detach(OverlayView overlay)
    {
        extras.Remove(overlay);
        overlay.Stop();
    }

    // 表示できたら true（同時に表示できる数は画面全体のオーバーレイで判断する）
    public bool AddComment(string text, string? direction, string? fontSize, Color fill, Color stroke)
    {
        if (!Main.AddComment(text, direction, fontSize, fill, stroke)) return false;
        foreach (var overlay in extras.ToList()) overlay.AddComment(text, direction, fontSize, fill, stroke);
        return true;
    }

    public void AddTextCommand(string text, double x, double y, Color fill, Color stroke)
    {
        foreach (var overlay in All) overlay.AddTextCommand(text, x, y, fill, stroke);
    }

    public void ShowProtofessional(string text)
    {
        foreach (var overlay in All) overlay.ShowProtofessional(text);
    }

    public void Flash()
    {
        foreach (var overlay in All) overlay.Flash();
    }

    public void ClearComments()
    {
        foreach (var overlay in All) overlay.ClearComments();
    }

    public void SetAdminMessage(bool show, string text)
    {
        adminMessage = (show, text);
        foreach (var overlay in All) overlay.SetAdminMessage(show, text);
    }

    public void SetQR(QRPosition position, string text)
    {
        qr = (position, text);
        foreach (var overlay in All) overlay.SetQR(position, text);
    }

    public void SetClock(bool enabled)
    {
        clock = enabled;
        foreach (var overlay in All) overlay.SetClock(enabled);
    }

    public void SetCameraFrame(BitmapSource? image)
    {
        cameraFrame = image;
        foreach (var overlay in All) overlay.SetCameraFrame(image);
    }

    // 配信者向けの通知（資料欄に送信しました など）は画面全体のオーバーレイにだけ出す
    public void ShowNotification(string text) => Main.ShowNotification(text);
}
