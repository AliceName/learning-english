using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Services;
using EnglishLearning.Api.Services.CloudinaryMedia;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Tests;

public sealed class CloudinaryCourseMediaTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "englishlearning-audio-tests-" + Guid.NewGuid().ToString("N"));
    private readonly MemoryCloudTransport transport = new();
    private static byte[] Png => CloudinaryEnvironmentSmoke.Fixtures().Single(item => item.ResourceType == "image").Bytes;
    private MediaStorage Legacy => new(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["MediaStorage:RootPath"] = root }).Build(), new AudioTestEnvironment());
    private CloudinaryMediaStore Cloud() => new(transport, Options.Create(new CloudinarySettings { EnvironmentPrefix = "els/test" }), Options.Create(new CloudinaryMediaOptions()), TimeProvider.System);
    private CloudinaryCourseMediaStorage Storage(ICloudMediaStore cloud, bool enabled = true) => new(() => cloud, () => transport, Legacy, Options.Create(new CloudinarySettings { Enabled = enabled, AllowLegacyReads = true }));
    private static IFormFile File(byte[] bytes, string name, string mime = "application/octet-stream", long? length = null) => new TestFile(bytes, name, mime, length ?? bytes.LongLength);
    public void Dispose() => AudioFixture.RemoveTestRoot(root);

    [Theory]
    [InlineData("cover", "cover.png")]
    [InlineData("audio", "lesson.wav")]
    public async Task New_media_uploads_to_cloud_and_reads_after_recreation_without_disk(string kind, string name)
    {
        using var cloud = Cloud(); var storage = Storage(cloud); var bytes = kind == "cover" ? Png : AudioFixture.Wave();
        var saved = await storage.SaveAsync(File(bytes, name), kind, default);
        Assert.True(MediaStorage.IsManagedFileName(saved.FileName)); Assert.Equal(bytes.Length, saved.SizeBytes); Assert.False(Directory.Exists(root));
        Assert.True(await storage.ExistsAsync("/api/media/" + saved.FileName, kind == "cover" ? "image/" : "audio/", default));
        using var restartedCloud = Cloud(); await using var read = await Storage(restartedCloud).OpenAsync(saved.FileName, null, default);
        Assert.NotNull(read); Assert.False(read.EnableRangeProcessing);
        using var body = new MemoryStream(); await read.Body.CopyToAsync(body); Assert.Equal(bytes, body.ToArray());
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(1)]
    public async Task Stream_size_must_match_the_declared_length(int delta)
    {
        using var cloud = Cloud(); var error = await Assert.ThrowsAsync<AuthoringException>(() => Storage(cloud).SaveAsync(File(Png, "cover.png", length: Png.Length + delta), "cover", default));
        Assert.Equal(400, error.Status); Assert.Equal(0, transport.UploadCalls); Assert.False(Directory.Exists(root));
    }

    [Theory]
    [InlineData("cover.png", "audio/mpeg", "cover")]
    [InlineData("cover.png", "image/png", "audio")]
    [InlineData("cover.exe", "image/png", "cover")]
    public async Task Wrong_mime_extension_or_kind_is_rejected_before_upload(string name, string mime, string kind)
    {
        using var cloud = Cloud(); await Assert.ThrowsAsync<AuthoringException>(() => Storage(cloud).SaveAsync(File(Png, name, mime), kind, default));
        Assert.Equal(0, transport.UploadCalls);
    }

    [Fact]
    public async Task Oversize_fake_header_and_disabled_cloud_never_write_local_files()
    {
        using var cloud = Cloud(); var storage = Storage(cloud);
        await Assert.ThrowsAsync<AuthoringException>(() => storage.SaveAsync(File(Png, "cover.png", length: 5 * 1024 * 1024 + 1), "cover", default));
        await Assert.ThrowsAsync<AuthoringException>(() => storage.SaveAsync(File(new byte[64], "cover.png"), "cover", default));
        var disabled = await Assert.ThrowsAsync<AuthoringException>(() => Storage(cloud, false).SaveAsync(File(Png, "cover.png"), "cover", default));
        Assert.Equal(503, disabled.Status); Assert.Equal(0, transport.UploadCalls); Assert.False(Directory.Exists(root));
    }

    [Fact]
    public async Task Publish_probes_the_asset_even_when_manifest_is_cached_and_rejects_wrong_type()
    {
        using var cloud = Cloud(); var storage = Storage(cloud); var saved = await storage.SaveAsync(File(Png, "cover.png"), "cover", default);
        Assert.False(await storage.ExistsAsync("/api/media/" + saved.FileName, "audio/", default));
        var binary = transport.Items.Single(item => item.Value.Asset.ResourceType == "image"); transport.Items.TryRemove(binary.Key, out _);
        Assert.False(await storage.ExistsAsync("/api/media/" + saved.FileName, "image/", default));
    }

    [Fact]
    public async Task Legacy_media_is_read_only_and_has_validated_bytes()
    {
        var old = await Legacy.SaveAsync(File(Png, "cover.png"), "cover", default); var before = Directory.GetFiles(root).Length;
        using var cloud = Cloud(); var storage = Storage(cloud);
        Assert.True(await storage.ExistsAsync("/api/media/" + old.FileName, "image/", default));
        await using (var read = await storage.OpenAsync(old.FileName, null, default)) { Assert.NotNull(read); Assert.True(read.EnableRangeProcessing); }
        Assert.Equal(0, transport.UploadCalls); Assert.Equal(before, Directory.GetFiles(root).Length);
        await System.IO.File.WriteAllBytesAsync(Legacy.Resolve(old.FileName)!, new byte[Png.Length]);
        Assert.Null(await storage.OpenAsync(old.FileName, null, default));
    }

    [Theory]
    [InlineData("https://example.com/cover.png", true)]
    [InlineData("http://example.com/legacy.png", true)]
    [InlineData("https://user:pass@example.com/cover.png", false)]
    [InlineData("/api/media/not-a-guid.png", false)]
    [InlineData("file:///private.png", false)]
    public async Task External_urls_preserve_contract_without_being_fetched(string url, bool expected)
    {
        var storage = new CloudinaryCourseMediaStorage(() => throw new InvalidOperationException("No cloud lookup expected"),
            () => throw new InvalidOperationException("No external fetch expected"), Legacy, Options.Create(new CloudinarySettings { Enabled = true }));
        Assert.Equal(expected, await storage.ExistsAsync(url, "image/", default));
    }

    [Fact]
    public async Task Cloud_ranges_and_failures_do_not_turn_into_local_writes()
    {
        using var cloud = Cloud(); var storage = Storage(cloud); var saved = await storage.SaveAsync(File(AudioFixture.Wave(), "sample.wav"), "audio", default);
        await using (var read = await storage.OpenAsync(saved.FileName, "bytes=4-15", default))
        {
            Assert.NotNull(read); Assert.Equal(206, read.Status); Assert.Equal(12, read.Length); Assert.False(read.EnableRangeProcessing);
        }
        await using (var read = await storage.OpenAsync(saved.FileName, "bytes=999999-", default)) { Assert.NotNull(read); Assert.Equal(416, read.Status); }
        transport.FailManifest = true;
        await Assert.ThrowsAsync<CloudMediaException>(() => storage.SaveAsync(File(Png, "image.png"), "cover", default));
        Assert.False(Directory.Exists(root));
    }

    private sealed class TestFile(byte[] bytes, string name, string mime, long length) : IFormFile
    {
        public string ContentType => mime;
        public string ContentDisposition => "";
        public IHeaderDictionary Headers => new HeaderDictionary();
        public long Length => length;
        public string Name => "file";
        public string FileName => name;
        public Stream OpenReadStream() => new MemoryStream(bytes, false);
        public void CopyTo(Stream target) => target.Write(bytes);
        public Task CopyToAsync(Stream target, CancellationToken token = default) => target.WriteAsync(bytes, token).AsTask();
    }
}
