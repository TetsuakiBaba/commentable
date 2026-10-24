using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Threading;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Windows.Graphics;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using Windows.Graphics.Imaging;
using WinRT;

namespace Commentable;

// 対象のウィンドウを Windows.Graphics.Capture で取り込む（macOS 版の ScreenCaptureKit に相当）
// 他のウィンドウの後ろに隠れていても中身を取り込める
sealed class WindowCapture : IDisposable
{
    private static readonly TimeSpan MinimumFrameInterval = TimeSpan.FromSeconds(1.0 / 30);

    // UI スレッドで呼ばれる（同じ WriteableBitmap を書き換えながら渡す）
    public Action<WriteableBitmap>? OnFrame { get; set; }
    public Action? OnClosed { get; set; }

    private readonly IntPtr target;
    private readonly Dispatcher dispatcher = Dispatcher.CurrentDispatcher;
    private IDirect3DDevice? device;
    private GraphicsCaptureItem? item;
    private Direct3D11CaptureFramePool? pool;
    private GraphicsCaptureSession? session;
    private SizeInt32 poolSize;
    private WriteableBitmap? bitmap;

    // 以下は lock (gate) の中で読み書きする
    private readonly object gate = new();
    private bool disposed;
    private Direct3D11CaptureFrame? heldFrame; // 間隔を空けるために後で取り込むフレーム
    private Timer? heldTimer;
    private DateTime lastCopy = DateTime.MinValue;
    private (byte[] Pixels, int Stride, int Width, int Height)? latest; // UI スレッドに渡すフレーム（Width / Height は中身の大きさ）
    private bool presentScheduled;

    public WindowCapture(IntPtr target)
    {
        this.target = target;
    }

    public static bool IsSupported => GraphicsCaptureSession.IsSupported();

    public void Start()
    {
        device = Direct3D11.CreateDevice();
        item = Direct3D11.CreateItemForWindow(target);
        item.Closed += (_, _) => dispatcher.BeginInvoke(() => OnClosed?.Invoke());
        poolSize = item.Size;
        pool = Direct3D11CaptureFramePool.CreateFreeThreaded(device, DirectXPixelFormat.B8G8R8A8UIntNormalized, 3, poolSize);
        pool.FrameArrived += (sender, _) => FrameArrived(sender);
        session = pool.CreateCaptureSession(item);
        session.IsCursorCaptureEnabled = true; // 共有先でもポインタが見えるように
        // Windows 11 では取り込み中の黄色い枠を出さない（出せないときはそのまま）
        if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000))
        {
            try
            {
                session.IsBorderRequired = false;
            }
            catch (Exception e)
            {
                Log.Write($"Share window: cannot hide capture border: {e.Message}");
            }
        }
        session.StartCapture();
    }

    // ========== フレーム（取り込み用のスレッドで呼ばれる） ==========
    // このスレッドで例外が起きるとアプリが終了するので、すべて捕まえる
    private void FrameArrived(Direct3D11CaptureFramePool sender)
    {
        try
        {
            ProcessFrames(sender);
        }
        catch (Exception e)
        {
            Log.Write($"Share window: capture error: {e}");
        }
    }

    private void ProcessFrames(Direct3D11CaptureFramePool sender)
    {
        // たまっていれば最新のものだけを使う
        Direct3D11CaptureFrame? frame = null;
        while (sender.TryGetNextFrame() is { } next)
        {
            frame?.Dispose();
            frame = next;
        }
        if (frame == null) return;

        // 対象のウィンドウの大きさが変わったら、取り込む大きさを合わせる
        var size = frame.ContentSize;
        if (size.Width != poolSize.Width || size.Height != poolSize.Height)
        {
            frame.Dispose();
            if (size.Width <= 0 || size.Height <= 0 || device == null) return;
            poolSize = size;
            sender.Recreate(device, DirectXPixelFormat.B8G8R8A8UIntNormalized, 3, size);
            return;
        }

        lock (gate)
        {
            if (disposed)
            {
                frame.Dispose();
                return;
            }
            // 1 秒に 30 回まで。間隔が短いときは最新のフレームを取っておき、時間が来たら取り込む
            // （止まった画面の最後のフレームを取りこぼさないように）
            var wait = lastCopy + MinimumFrameInterval - DateTime.UtcNow;
            if (wait > TimeSpan.Zero)
            {
                heldFrame?.Dispose();
                heldFrame = frame;
                heldTimer ??= new Timer(_ => CopyHeldFrame());
                heldTimer.Change(wait, Timeout.InfiniteTimeSpan);
                return;
            }
            lastCopy = DateTime.UtcNow;
        }
        Copy(frame);
    }

    private void CopyHeldFrame()
    {
        Direct3D11CaptureFrame? frame;
        lock (gate)
        {
            frame = heldFrame;
            heldFrame = null;
            if (frame == null || disposed)
            {
                frame?.Dispose();
                return;
            }
            lastCopy = DateTime.UtcNow;
        }
        Copy(frame);
    }

    private void Copy(Direct3D11CaptureFrame frame)
    {
        try
        {
            using (frame)
            using (var software = SoftwareBitmap.CreateCopyFromSurfaceAsync(frame.Surface, BitmapAlphaMode.Premultiplied).AsTask().GetAwaiter().GetResult())
            {
                var width = Math.Min(software.PixelWidth, frame.ContentSize.Width);
                var height = Math.Min(software.PixelHeight, frame.ContentSize.Height);
                var pixels = new byte[software.PixelWidth * software.PixelHeight * 4];
                software.CopyToBuffer(pixels.AsBuffer());
                lock (gate)
                {
                    if (disposed) return;
                    latest = (pixels, software.PixelWidth * 4, width, height);
                    if (presentScheduled) return;
                    presentScheduled = true;
                }
                dispatcher.BeginInvoke(Present, DispatcherPriority.Render);
            }
        }
        catch (Exception e)
        {
            Log.Write($"Share window: frame error: {e.Message}");
        }
    }

    // UI スレッドで、最新のフレームを画像に書き込む
    private void Present()
    {
        (byte[] Pixels, int Stride, int Width, int Height)? frame;
        lock (gate)
        {
            frame = latest;
            latest = null;
            presentScheduled = false;
        }
        if (frame is not { } value || disposed) return;
        var (width, height) = (value.Width, value.Height);
        if (width <= 0 || height <= 0) return;
        if (bitmap == null || bitmap.PixelWidth != width || bitmap.PixelHeight != height)
        {
            bitmap = new WriteableBitmap(width, height, 96, 96, PixelFormats.Pbgra32, null);
        }
        bitmap.WritePixels(new Int32Rect(0, 0, width, height), value.Pixels, value.Stride, 0);
        OnFrame?.Invoke(bitmap);
    }

    public void Dispose()
    {
        lock (gate)
        {
            if (disposed) return;
            disposed = true;
            heldFrame?.Dispose();
            heldFrame = null;
            heldTimer?.Dispose();
        }
        session?.Dispose();
        pool?.Dispose();
        device?.Dispose();
        session = null;
        pool = null;
        device = null;
        item = null;
    }
}

// Direct3D と Windows.Graphics.Capture の準備（WinRT の型を C++ 用の API から作る）
static unsafe class Direct3D11
{
    private const int D3D_DRIVER_TYPE_HARDWARE = 1;
    private const int D3D_DRIVER_TYPE_WARP = 5;
    private const uint D3D11_CREATE_DEVICE_BGRA_SUPPORT = 0x20;
    private const uint D3D11_SDK_VERSION = 7;
    private static readonly Guid IID_IDXGIDevice = new("54ec77fa-1377-44e6-8c32-88fd5f44c84c");
    private static readonly Guid IID_IGraphicsCaptureItemInterop = new("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356");
    private static readonly Guid IID_IGraphicsCaptureItem = new("79C3F95B-31F7-4EC2-A464-632EF5D30760");

    [DllImport("d3d11.dll", ExactSpelling = true)]
    private static extern int D3D11CreateDevice(IntPtr adapter, int driverType, IntPtr software, uint flags, IntPtr featureLevels,
        uint featureLevelCount, uint sdkVersion, out IntPtr device, out int featureLevel, out IntPtr immediateContext);

    [DllImport("d3d11.dll", ExactSpelling = true)]
    private static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgiDevice, out IntPtr graphicsDevice);

    [DllImport("combase.dll", ExactSpelling = true)]
    private static extern int RoGetActivationFactory(IntPtr activatableClassId, in Guid iid, out IntPtr factory);

    [DllImport("combase.dll", ExactSpelling = true, CharSet = CharSet.Unicode)]
    private static extern int WindowsCreateString(string source, int length, out IntPtr hstring);

    [DllImport("combase.dll", ExactSpelling = true)]
    private static extern int WindowsDeleteString(IntPtr hstring);

    public static IDirect3DDevice CreateDevice()
    {
        foreach (var driverType in new[] { D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP })
        {
            if (D3D11CreateDevice(IntPtr.Zero, driverType, IntPtr.Zero, D3D11_CREATE_DEVICE_BGRA_SUPPORT, IntPtr.Zero, 0,
                    D3D11_SDK_VERSION, out var d3dDevice, out _, out var context) < 0) continue;
            try
            {
                Marshal.ThrowExceptionForHR(Marshal.QueryInterface(d3dDevice, in IID_IDXGIDevice, out var dxgiDevice));
                try
                {
                    Marshal.ThrowExceptionForHR(CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice, out var inspectable));
                    try
                    {
                        return MarshalInterface<IDirect3DDevice>.FromAbi(inspectable);
                    }
                    finally
                    {
                        Marshal.Release(inspectable);
                    }
                }
                finally
                {
                    Marshal.Release(dxgiDevice);
                }
            }
            finally
            {
                Marshal.Release(d3dDevice);
                if (context != IntPtr.Zero) Marshal.Release(context);
            }
        }
        throw new InvalidOperationException("Direct3D を使用できません。");
    }

    public static GraphicsCaptureItem CreateItemForWindow(IntPtr hwnd)
    {
        const string className = "Windows.Graphics.Capture.GraphicsCaptureItem";
        Marshal.ThrowExceptionForHR(WindowsCreateString(className, className.Length, out var hstring));
        try
        {
            Marshal.ThrowExceptionForHR(RoGetActivationFactory(hstring, IID_IGraphicsCaptureItemInterop, out var interop));
            try
            {
                // IGraphicsCaptureItemInterop::CreateForWindow（IUnknown の 3 つの次）
                var vtable = *(IntPtr**)interop;
                var createForWindow = (delegate* unmanaged[Stdcall]<IntPtr, IntPtr, Guid*, IntPtr*, int>)vtable[3];
                var iid = IID_IGraphicsCaptureItem;
                IntPtr result;
                Marshal.ThrowExceptionForHR(createForWindow(interop, hwnd, &iid, &result));
                try
                {
                    return GraphicsCaptureItem.FromAbi(result);
                }
                finally
                {
                    Marshal.Release(result);
                }
            }
            finally
            {
                Marshal.Release(interop);
            }
        }
        finally
        {
            WindowsDeleteString(hstring);
        }
    }
}
