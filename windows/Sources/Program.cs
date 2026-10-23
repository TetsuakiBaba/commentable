using System;
using System.Windows;
using System.Windows.Threading;
using Forms = System.Windows.Forms;

namespace Commentable;

static class Program
{
    public static bool IsShuttingDown { get; private set; }

    [STAThread]
    static int Main(string[] args)
    {
        // アップデートで再起動したときは、前のアプリが終了するのを待つ
        var waitIndex = Array.IndexOf(args, "--wait-pid");
        if (waitIndex >= 0 && waitIndex + 1 < args.Length && int.TryParse(args[waitIndex + 1], out var pid))
        {
            try
            {
                using var previous = System.Diagnostics.Process.GetProcessById(pid);
                previous.WaitForExit(TimeSpan.FromSeconds(15));
            }
            catch (ArgumentException)
            {
                // もう終了している
            }
        }
        UpdateChecker.CleanUpAfterUpdate(); // 入れ替える前の exe が残っていれば消す

        // トレイのメニューとダイアログ（TaskDialog）は Windows Forms のものを使う
        Forms.Application.EnableVisualStyles();
        Forms.Application.SetCompatibleTextRenderingDefault(false);

        // 2つ起動するとコメントが二重に表示されるので、1つだけにする（macOS ではシステムが同じことをする）
        using var instance = new System.Threading.Mutex(true, @"Local\commentable-desktop", out var isFirstInstance);
        if (!isFirstInstance)
        {
            Dialogs.Message("Commentable はすでに起動しています", "画面右下のタスクトレイ（通知領域）にある Commentable のアイコンから操作してください。");
            return 0;
        }

        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        app.DispatcherUnhandledException += (_, e) =>
        {
            // 授業中にアプリが落ちないように、記録だけして続ける
            Log.Write($"Unhandled exception: {e.Exception}");
            e.Handled = true;
        };
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Log.Write($"Unhandled exception: {e.ExceptionObject}");

        var controller = new AppController(args);
        app.Startup += (_, _) => controller.Start();
        app.Exit += (_, _) => controller.Terminate();
        return app.Run();
    }

    // Electron 版の app.quit() に相当
    public static void Quit()
    {
        if (IsShuttingDown) return;
        IsShuttingDown = true;
        Dispatcher.CurrentDispatcher.BeginInvoke(() => Application.Current.Shutdown());
    }
}
