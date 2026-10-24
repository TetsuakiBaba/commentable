using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Threading;
using Windows.Media.Core;
using Windows.Media.Playback;
using Windows.Media.SpeechSynthesis;

namespace Commentable;

// コメントの効果音と読み上げ
sealed class SoundPlayer
{
    // id_sound の番号順。複数あるものはランダムに1つ鳴らす
    private static readonly string[][] SoundFiles =
    [
        ["camera1.mp3", "camera2.mp3", "camera3.mp3"],
        ["clap1.mp3", "clap2.mp3", "clap3.mp3", "clap4.mp3", "clap5.mp3", "clap6.mp3", "clap7.mp3", "clap8.mp3"],
        ["cracker.mp3"],
        ["kansei.mp3"],
        ["he.wav"],
        ["chottomatte.wav"],
        ["OK.wav"],
        ["punch.mp3"],
        ["laugh3.mp3"],
        ["kusa00.mp3", "kusa01.mp3", "kusa02.mp3", "kusa03.mp3", "kusa04.mp3", "kusa05.mp3"],
    ];

    public double Volume { get; set; } = 0.1;
    // ミュートにしたら、待っている読み上げを取り消し、読み上げ中のものも止める
    private bool isMuted;
    public bool IsMuted
    {
        get => isMuted;
        set
        {
            isMuted = value;
            if (value) CancelSpeech();
        }
    }

    private readonly Dictionary<string, byte[]> cache = new();
    private readonly HashSet<MediaPlayer> playing = new(); // 再生が終わるまで保持する（同じ音を重ねて鳴らせる）
    private readonly Dispatcher dispatcher = Dispatcher.CurrentDispatcher;
    private SpeechSynthesizer? synthesizer;
    private Task speechQueue = Task.CompletedTask; // 読み上げは順番に行う
    // 大量に送られても読み上げ続けないように、待たせるのは 3 件まで（それ以上は捨てる）
    private const int MaxPendingSpeech = 3;
    private int pendingSpeech;
    private CancellationTokenSource speechCancel = new();
    private MediaPlayer? speaking;

    public SoundPlayer()
    {
        // 最初のコメントで遅れないように読み込んでおく
        foreach (var name in SoundFiles.SelectMany(files => files).Append("protofessional.mp3"))
        {
            if (AppResources.Sound(name) is { } data) cache[name] = data;
            else Log.Write($"Sound not found: {name}");
        }
    }

    public static bool IsValidSoundID(int id) => id >= 0 && id < SoundFiles.Length;

    public void PlayComment(int soundID)
    {
        if (!IsValidSoundID(soundID)) return;
        var files = SoundFiles[soundID];
        Play(files[Random.Shared.Next(files.Length)], Volume);
    }

    public void Play(string name, double volume)
    {
        if (IsMuted || !cache.TryGetValue(name, out var data)) return;
        var contentType = name.EndsWith(".wav", StringComparison.OrdinalIgnoreCase) ? "audio/wav" : "audio/mpeg";
        Start(MediaSource.CreateFromStream(new MemoryStream(data).AsRandomAccessStream(), contentType), volume);
    }

    // onFinished: 再生が終わったとき・失敗したときに呼ぶ（再生用のスレッドから）
    private MediaPlayer Start(MediaSource source, double volume, Action? onFinished = null)
    {
        var player = new MediaPlayer
        {
            Source = source,
            Volume = volume,
            AudioCategory = MediaPlayerAudioCategory.SoundEffects,
            AutoPlay = false,
        };
        player.CommandManager.IsEnabled = false; // メディアの操作（音量の表示など）には出さない
        void Finish()
        {
            onFinished?.Invoke();
            dispatcher.BeginInvoke(() =>
            {
                if (playing.Remove(player)) player.Dispose();
            });
        }
        player.MediaEnded += (_, _) => Finish();
        player.MediaFailed += (_, e) =>
        {
            Log.Write($"Sound error: {e.Error} {e.ErrorMessage} {e.ExtendedErrorCode?.Message}");
            Finish();
        };
        playing.Add(player);
        player.Play();
        return player;
    }

    public void Speak(string text)
    {
        if (IsMuted || pendingSpeech >= MaxPendingSpeech) return;
        pendingSpeech++;
        var token = speechCancel.Token;
        speechQueue = speechQueue.ContinueWith(_ => SpeakAsync(text, token), CancellationToken.None,
            TaskContinuationOptions.None, TaskScheduler.FromCurrentSynchronizationContext()).Unwrap();
    }

    private void CancelSpeech()
    {
        speechCancel.Cancel();
        speechCancel = new CancellationTokenSource();
        if (speaking is { } player) Stop(player);
    }

    private void Stop(MediaPlayer player)
    {
        if (!playing.Remove(player)) return;
        player.Pause();
        player.Dispose();
    }

    private async Task SpeakAsync(string text, CancellationToken token)
    {
        pendingSpeech--;
        MediaPlayer? player = null;
        try
        {
            if (IsMuted || token.IsCancellationRequested) return;
            if (synthesizer == null)
            {
                synthesizer = new SpeechSynthesizer();
                if (SpeechSynthesizer.AllVoices.FirstOrDefault(voice => voice.Language.Equals("ja-JP", StringComparison.OrdinalIgnoreCase)) is { } voice)
                {
                    synthesizer.Voice = voice;
                }
            }
            var stream = await synthesizer.SynthesizeTextToStreamAsync(text);
            if (IsMuted || token.IsCancellationRequested) return;
            var finished = new TaskCompletionSource();
            player = Start(MediaSource.CreateFromStream(stream, stream.ContentType), Volume, () => finished.TrySetResult());
            speaking = player;
            await Task.WhenAny(finished.Task, Task.Delay(TimeSpan.FromMinutes(1), token));
        }
        catch (Exception e)
        {
            Log.Write($"Speech error: {e.Message}");
        }
        finally
        {
            if (player != null)
            {
                if (speaking == player) speaking = null;
                Stop(player);
            }
        }
    }
}
