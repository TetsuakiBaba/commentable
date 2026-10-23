using System;
using System.Windows.Interop;

namespace Commentable;

// アプリが前面になくても効くショートカット
sealed class GlobalHotKey : IDisposable
{
    private const int WM_HOTKEY = 0x0312;
    private const uint MOD_ALT = 0x0001;
    private const uint MOD_CONTROL = 0x0002;
    private const uint MOD_NOREPEAT = 0x4000;
    private const uint VK_V = 0x56;
    private const int HotKeyID = 0x434D; // 'CM'

    private readonly HwndSource source;
    private readonly Action action;
    private readonly bool registered;

    // 既定は Ctrl+Alt+V（クリップボードの内容を配布資料欄に送信。Electron 版と同じ）
    public GlobalHotKey(Action action, uint modifiers = MOD_CONTROL | MOD_ALT, uint key = VK_V)
    {
        this.action = action;
        // メッセージを受け取るだけの見えないウィンドウ
        source = new HwndSource(new HwndSourceParameters("CommentableHotKey") { ParentWindow = Native.HWND_MESSAGE, WindowStyle = 0 });
        source.AddHook(WndProc);
        registered = Native.RegisterHotKey(source.Handle, HotKeyID, modifiers | MOD_NOREPEAT, key);
        if (!registered) Log.Write("Global shortcut registration failed");
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == WM_HOTKEY && wParam.ToInt32() == HotKeyID)
        {
            handled = true;
            action();
        }
        return IntPtr.Zero;
    }

    public void Dispose()
    {
        if (registered) Native.UnregisterHotKey(source.Handle, HotKeyID);
        source.RemoveHook(WndProc);
        source.Dispose();
    }
}
