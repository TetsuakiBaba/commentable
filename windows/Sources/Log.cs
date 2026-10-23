using System;
using System.Diagnostics;
using System.IO;

namespace Commentable;

// macOS 版の NSLog に相当（%LOCALAPPDATA%\Commentable\commentable.log にも残す）
static class Log
{
    private static readonly string File =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Commentable", "commentable.log");
    private static readonly object Lock = new();

    public static void Write(string message)
    {
        var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} {message}";
        Debug.WriteLine(line);
        lock (Lock)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(File)!);
                // 大きくなりすぎたら作り直す
                if (System.IO.File.Exists(File) && new FileInfo(File).Length > 1024 * 1024) System.IO.File.Delete(File);
                System.IO.File.AppendAllText(File, line + Environment.NewLine);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
            }
        }
    }
}
