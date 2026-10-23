using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Windows.Media.Imaging;

namespace Commentable;

// exe に埋め込んだ効果音・画像（Commentable.csproj の EmbeddedResource）
static class AppResources
{
    private static readonly Dictionary<string, BitmapImage?> images = new();

    public static Stream? Stream(string name) => Assembly.GetExecutingAssembly().GetManifestResourceStream(name);

    public static byte[]? Data(string name)
    {
        using var stream = Stream(name);
        if (stream == null) return null;
        using var memory = new MemoryStream();
        stream.CopyTo(memory);
        return memory.ToArray();
    }

    public static byte[]? Sound(string name) => Data($"sounds/{name}");

    public static BitmapImage? Image(string name)
    {
        if (images.TryGetValue(name, out var cached)) return cached;
        BitmapImage? image = null;
        using (var stream = Stream($"images/{name}"))
        {
            if (stream != null)
            {
                image = new BitmapImage();
                image.BeginInit();
                image.CacheOption = BitmapCacheOption.OnLoad;
                image.StreamSource = stream;
                image.EndInit();
                image.Freeze();
            }
        }
        images[name] = image;
        return image;
    }
}
