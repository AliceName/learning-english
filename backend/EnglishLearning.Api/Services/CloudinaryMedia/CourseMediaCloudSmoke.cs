using EnglishLearning.Api.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Services.CloudinaryMedia;

internal static class CourseMediaCloudSmoke
{
    public static async Task VerifyAsync(Func<CloudinaryMediaStore> createCloud, ICloudinaryAssetTransport transport,
        CloudinarySettings settings, string contentRoot, List<CloudinarySmokeCheck> checks, CancellationToken token)
    {
        var legacyRoot = Path.Combine(contentRoot, "App_Data", "course-cloud-smoke-" + Guid.NewGuid().ToString("N"));
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["MediaStorage:RootPath"] = legacyRoot }).Build();
        var legacy = new MediaStorage(configuration, new SmokeEnvironment { ContentRootPath = contentRoot });
        CloudinaryCourseMediaStorage Storage(ICloudMediaStore cloud) => new(() => cloud, () => transport, legacy, Options.Create(settings));
        void Record(string name, bool passed)
        { checks.Add(new(name, passed)); if (!passed) throw new CloudMediaException(502, "course_cloud_smoke_assertion_failed"); }
        var png = CloudinaryEnvironmentSmoke.Fixtures().Single(file => file.ResourceType == "image").Bytes;
        var wav = Wave();
        using var firstCloud = createCloud(); var first = Storage(firstCloud);
        var cover = await first.SaveAsync(File(png, "cover.png", "image/png"), "cover", token);
        Record("course_pipeline_upload_cover", cover.ContentType == "image/png" && cover.SizeBytes == png.Length && MediaStorage.IsManagedFileName(cover.FileName));
        var audio = await first.SaveAsync(File(wav, "lesson.wav", "audio/wav"), "audio", token);
        Record("course_pipeline_upload_audio", audio.ContentType == "audio/wav" && audio.SizeBytes == wav.Length && MediaStorage.IsManagedFileName(audio.FileName));
        Record("course_pipeline_publish_asset_probe", await first.ExistsAsync("/api/media/" + cover.FileName, "image/", token) && await first.ExistsAsync("/api/media/" + audio.FileName, "audio/", token));
        using var restartedCloud = createCloud(); var restarted = Storage(restartedCloud);
        await using (var read = await restarted.OpenAsync(cover.FileName, null, token))
        {
            using var bytes = new MemoryStream(); if (read is not null) await read.Body.CopyToAsync(bytes, token);
            Record("course_pipeline_cold_cloud_cover_read", read is { Status: 200, EnableRangeProcessing: false } && bytes.ToArray().AsSpan().SequenceEqual(png));
        }
        await using (var read = await restarted.OpenAsync(audio.FileName, null, token))
        {
            using var bytes = new MemoryStream(); if (read is not null) await read.Body.CopyToAsync(bytes, token);
            Record("course_pipeline_audio_full_bytes", read is { Status: 200, EnableRangeProcessing: false } && bytes.ToArray().AsSpan().SequenceEqual(wav));
        }
        await using (var read = await restarted.OpenAsync(audio.FileName, "bytes=0-31", token))
        {
            using var bytes = new MemoryStream(); if (read is not null) await read.Body.CopyToAsync(bytes, token);
            Record("course_pipeline_range_206", read is { Status: 206, Length: 32 } && read.ContentRange == $"bytes 0-31/{wav.Length}" && bytes.ToArray().AsSpan().SequenceEqual(wav.AsSpan(0, 32)));
        }
        await using (var read = await restarted.OpenAsync(audio.FileName, "bytes=999999-", token))
            Record("course_pipeline_range_416", read is { Status: 416, Length: 0 } && read.ContentRange == $"bytes */{wav.Length}");
        Record("course_pipeline_wrong_kind_rejected", !await restarted.ExistsAsync("/api/media/" + cover.FileName, "audio/", token) && !await restarted.ExistsAsync("/api/media/" + audio.FileName, "image/", token));
        Record("course_pipeline_no_local_media", !Directory.Exists(legacyRoot));
    }
    private static IFormFile File(byte[] bytes, string name, string mime) => new FormFile(new MemoryStream(bytes, false), 0, bytes.Length, "file", name)
    { Headers = new HeaderDictionary(), ContentType = mime };
    private static byte[] Wave()
    {
        var bytes = new byte[44 + 16000];
        using var writer = new BinaryWriter(new MemoryStream(bytes));
        writer.Write("RIFF"u8); writer.Write(bytes.Length - 8); writer.Write("WAVEfmt "u8);
        writer.Write(16); writer.Write((short)1); writer.Write((short)1); writer.Write(8000); writer.Write(16000);
        writer.Write((short)2); writer.Write((short)16); writer.Write("data"u8); writer.Write(bytes.Length - 44);
        return bytes;
    }
    private sealed class SmokeEnvironment : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "EnglishLearning.Api";
        public string EnvironmentName { get; set; } = "Development";
        public string ContentRootPath { get; set; } = "";
        public string WebRootPath { get; set; } = "";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
    }
}
