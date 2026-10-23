using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Windows.Devices.Enumeration;
using Windows.Graphics.Imaging;
using Windows.Media.Capture;
using Windows.Media.Capture.Frames;
using Windows.Media.MediaProperties;

namespace Commentable;

// カメラの設定（Electron 版の camera-settings.json に相当。デバイス ID の形式が違うので別に保存する）
// 人物切り抜きは Windows の API にないので、Windows 版では使えない（Electron 版の Windows と同じ）
static class CameraSettings
{
    public static string? DeviceID
    {
        get => Preferences.GetString("camera.deviceID");
        set => Preferences.Set("camera.deviceID", value);
    }

    public static CameraPosition Position
    {
        get => CameraPositionExtensions.Parse(Preferences.GetString("camera.position")) ?? CameraPosition.TopRight;
        set => Preferences.Set("camera.position", value.RawValue());
    }

    public static string Size
    {
        get => Preferences.GetString("camera.size") ?? "small";
        set => Preferences.Set("camera.size", value);
    }

    public static readonly (string Label, string Value, double Scale)[] Sizes =
    [
        ("小", "small", 0.15),
        ("中", "medium", 0.25),
        ("大", "large", 0.40),
    ];

    public static double Scale(string size) => Sizes.FirstOrDefault(s => s.Value == size) is { Label: not null } found ? found.Scale : 0.15;

    public static async Task<List<DeviceInformation>> AvailableDevices() =>
        (await DeviceInformation.FindAllAsync(DeviceClass.VideoCapture)).Where(device => device.IsEnabled).ToList();
}

// カメラ映像を取り込んで画像として渡す
sealed class CameraController
{
    // UI スレッドで呼ばれる（同じ WriteableBitmap を書き換えながら渡す。null はカメラ停止）
    public Action<BitmapSource?>? OnFrame { get; set; }

    // 権限がないなどで開始できなかったときにダイアログを出すか（設定画面のプレビューでは出さない）
    public bool ShowsErrors { get; init; } = true;
    public Action<string>? OnError { get; set; }

    private readonly Dispatcher dispatcher = Dispatcher.CurrentDispatcher;
    private MediaCapture? capture;
    private MediaFrameReader? reader;
    private int generation; // 停止・切り替え後に古いフレームを表示しないため
    private int framePending; // UI スレッドがまだ前のフレームを表示していない
    private WriteableBitmap? bitmap;

    public bool IsRunning { get; private set; }

    public async void Start(string deviceID)
    {
        Stop();
        var current = ++generation;
        MediaCapture? newCapture = null;
        MediaFrameReader? newReader = null;
        try
        {
            var devices = await CameraSettings.AvailableDevices();
            var device = devices.FirstOrDefault(d => d.Id == deviceID) ?? devices.FirstOrDefault();
            if (device == null)
            {
                Fail("カメラが見つかりません", "カメラ設定でカメラを選び直してください。");
                return;
            }
            newCapture = await Initialize(device.Id);
            if (current != generation) return;

            // 映像の取り込み口（プレビュー用があればそれを使う）
            var source = newCapture.FrameSources.Values
                .Where(s => s.Info.SourceKind == MediaFrameSourceKind.Color)
                .OrderBy(s => s.Info.MediaStreamType == Windows.Media.Capture.MediaStreamType.VideoPreview ? 0 : 1)
                .FirstOrDefault();
            if (source == null)
            {
                Fail("カメラを使用できません", "このカメラからは映像を取り込めませんでした。");
                return;
            }
            await SelectFormat(source);
            if (current != generation) return;

            // 1280×720 程度に縮めて受け取る
            var format = source.CurrentFormat.VideoFormat;
            var scale = format.Width > 1280 ? 1280.0 / format.Width : 1.0;
            var size = new BitmapSize { Width = (uint)Math.Max(2, format.Width * scale), Height = (uint)Math.Max(2, format.Height * scale) };
            newReader = await newCapture.CreateFrameReaderAsync(source, MediaEncodingSubtypes.Bgra8, size);
            newReader.AcquisitionMode = MediaFrameReaderAcquisitionMode.Realtime; // 追いつかないときは古いフレームを捨てる
            newReader.FrameArrived += (sender, _) => FrameArrived(sender, current);
            var status = await newReader.StartAsync();
            if (status != MediaFrameReaderStartStatus.Success)
            {
                Fail("カメラを使用できません", $"カメラの映像を取り込めませんでした（{status}）。別のアプリがカメラを使っていないか確認してください。");
                return;
            }
            if (current != generation) return;
            capture = newCapture;
            reader = newReader;
            newCapture = null;
            newReader = null;
            IsRunning = true;
        }
        catch (UnauthorizedAccessException)
        {
            if (current != generation) return;
            if (ShowsErrors)
            {
                var response = Dialogs.Message("カメラを使用できません",
                    "設定 > プライバシーとセキュリティ > カメラ で「カメラへのアクセス」と「デスクトップ アプリがカメラにアクセスできるようにする」をオンにしてください。",
                    ["設定を開く", "閉じる"], DialogStyle.Warning);
                if (response == 0) Shell.Open("ms-settings:privacy-webcam");
            }
            OnError?.Invoke("カメラの使用が許可されていません。設定 > プライバシーとセキュリティ > カメラ で許可してください。");
        }
        catch (Exception e)
        {
            Log.Write($"Error starting camera: {e.Message}");
            if (current == generation) Fail("カメラを使用できません", e.Message);
        }
        finally
        {
            if (newReader != null) _ = Release(newReader, null);
            newCapture?.Dispose();
        }
    }

    private void Fail(string title, string detail)
    {
        if (ShowsErrors) Dialogs.Message(title, detail, style: DialogStyle.Warning);
        OnError?.Invoke(detail);
    }

    // 画質を選べるようにカメラを専有して開く（他のアプリが使っているときは共有で開く）
    private static async Task<MediaCapture> Initialize(string deviceID)
    {
        foreach (var mode in new[] { MediaCaptureSharingMode.ExclusiveControl, MediaCaptureSharingMode.SharedReadOnly })
        {
            var capture = new MediaCapture();
            try
            {
                await capture.InitializeAsync(new MediaCaptureInitializationSettings
                {
                    VideoDeviceId = deviceID,
                    StreamingCaptureMode = StreamingCaptureMode.Video,
                    MemoryPreference = MediaCaptureMemoryPreference.Cpu,
                    SharingMode = mode,
                });
                return capture;
            }
            catch (Exception e) when (e is not UnauthorizedAccessException && mode == MediaCaptureSharingMode.ExclusiveControl)
            {
                Log.Write($"Camera: cannot open exclusively ({e.Message}), retrying in shared mode");
                capture.Dispose();
            }
            catch
            {
                capture.Dispose();
                throw;
            }
        }
        throw new InvalidOperationException("カメラを開けませんでした。");
    }

    // 1280×720 に近く、なめらかに動く形式を選ぶ（共有で開いたときは選べない）
    private static async Task SelectFormat(MediaFrameSource source)
    {
        var best = source.SupportedFormats
            .Where(f => f.VideoFormat.Width > 0 && f.FrameRate.Denominator > 0)
            .OrderBy(f => Math.Abs((int)f.VideoFormat.Width - 1280) + Math.Abs((int)f.VideoFormat.Height - 720))
            .ThenByDescending(f => Math.Min(30.0, (double)f.FrameRate.Numerator / f.FrameRate.Denominator))
            .FirstOrDefault();
        if (best == null) return;
        try
        {
            await source.SetFormatAsync(best);
        }
        catch (Exception e)
        {
            Log.Write($"Camera: cannot set format: {e.Message}");
        }
    }

    public void Stop()
    {
        generation++;
        IsRunning = false;
        var oldReader = reader;
        var oldCapture = capture;
        reader = null;
        capture = null;
        if (oldReader != null || oldCapture != null) _ = Release(oldReader, oldCapture);
        bitmap = null;
        OnFrame?.Invoke(null);
    }

    private static async Task Release(MediaFrameReader? oldReader, MediaCapture? oldCapture)
    {
        try
        {
            if (oldReader != null)
            {
                await oldReader.StopAsync();
                oldReader.Dispose();
            }
        }
        catch (Exception e)
        {
            Log.Write($"Camera: stop error: {e.Message}");
        }
        oldCapture?.Dispose();
    }

    // 取り込み用のスレッドで呼ばれる
    private void FrameArrived(MediaFrameReader sender, int frameGeneration)
    {
        if (frameGeneration != Volatile.Read(ref generation)) return;
        using var frame = sender.TryAcquireLatestFrame();
        var source = frame?.VideoMediaFrame?.SoftwareBitmap;
        if (source == null) return;
        if (Interlocked.Exchange(ref framePending, 1) == 1) return;

        byte[] pixels;
        int width, height;
        var converted = source.BitmapPixelFormat == BitmapPixelFormat.Bgra8 ? source : SoftwareBitmap.Convert(source, BitmapPixelFormat.Bgra8);
        try
        {
            width = converted.PixelWidth;
            height = converted.PixelHeight;
            pixels = new byte[width * height * 4];
            converted.CopyToBuffer(pixels.AsBuffer());
        }
        catch (Exception e)
        {
            Log.Write($"Camera: frame error: {e.Message}");
            Volatile.Write(ref framePending, 0);
            return;
        }
        finally
        {
            if (converted != source) converted.Dispose();
        }

        dispatcher.BeginInvoke(() =>
        {
            try
            {
                if (frameGeneration != generation) return;
                if (bitmap == null || bitmap.PixelWidth != width || bitmap.PixelHeight != height)
                {
                    bitmap = new WriteableBitmap(width, height, 96, 96, PixelFormats.Bgr32, null);
                }
                bitmap.WritePixels(new Int32Rect(0, 0, width, height), pixels, width * 4, 0);
                OnFrame?.Invoke(bitmap);
            }
            finally
            {
                Volatile.Write(ref framePending, 0);
            }
        }, DispatcherPriority.Render);
    }
}
