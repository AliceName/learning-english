using System.Net;
using System.Net.Http.Json;
using System.Text;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Documents;
using EnglishLearning.Api.Services;
using EnglishLearning.Api.Services.CloudinaryMedia;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Configuration;
using Microsoft.EntityFrameworkCore;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;

namespace EnglishLearning.Api.Tests;

internal sealed class AudioTestEnvironment : IWebHostEnvironment, IHostApplicationLifetime
{
    public string ApplicationName { get; set; } = "EnglishLearning.Api";
    public string EnvironmentName { get; set; } = "Development";
    public string ContentRootPath { get; set; } = Path.GetTempPath();
    public string WebRootPath { get; set; } = Path.GetTempPath();
    public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
    public CancellationToken ApplicationStarted => CancellationToken.None;
    public CancellationToken ApplicationStopping => CancellationToken.None;
    public CancellationToken ApplicationStopped => CancellationToken.None;
    public void StopApplication() { }
}
internal sealed class AudioTestFactory(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send) : IHttpClientFactory
{
    private sealed class Handler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> callback) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) => callback(request, token);
    }
    public HttpClient CreateClient(string name) => new(new Handler(send));
}
internal sealed class FakeAudioDownload : IDictionaryAudioDownload
{
    internal int Calls;
    internal Func<CancellationToken, Task<DownloadedDictionaryAudio>> Fetch = _ => Task.FromResult(AudioFixture.Audio());
    public Task<DownloadedDictionaryAudio> DownloadAsync(DictionaryAudioReference reference, CancellationToken token)
    { Interlocked.Increment(ref Calls); return Fetch(token); }
}

internal static class AudioFixture
{
    internal const string Source = "https://commons.wikimedia.org/w/index.php?curid=825478";
    internal const string FileUrl = "https://upload.wikimedia.org/wikipedia/commons/a/ad/En-us-match.wav";
    internal static byte[] Wave(byte variation = 0)
    {
        var bytes = new byte[1644];
        using var writer = new BinaryWriter(new MemoryStream(bytes));
        writer.Write("RIFF"u8); writer.Write(bytes.Length - 8); writer.Write("WAVEfmt "u8);
        writer.Write(16); writer.Write((short)1); writer.Write((short)1); writer.Write(8000); writer.Write(16000);
        writer.Write((short)2); writer.Write((short)16); writer.Write("data"u8); writer.Write(bytes.Length - 44);
        bytes[^1] = variation;
        return bytes;
    }
    internal static DownloadedDictionaryAudio Audio(byte variation = 0) => new(Wave(variation), "wav", "audio/wav",
        new("wikimedia", Source, FileUrl, "Test speaker", "CC BY 3.0", "https://creativecommons.org/licenses/by/3.0/", "en-US"));
    internal static DictionaryPhonetic Phonetic(string? source = Source, string? audio = "https://api.dictionaryapi.dev/media/pronunciations/en/match-us.mp3") =>
        new("/mætʃ/", audio, source, new("CC BY 3.0", "https://creativecommons.org/licenses/by/3.0/"));
    internal static VocabularyEntryDocument Entry()
    {
        var raw = BsonSerializer.Deserialize<BsonArray>(VocabularyFixture.Json);
        raw[0]["word"] = "match";
        raw[0]["phonetics"] = new BsonArray { new BsonDocument { { "text", "/mætʃ/" },
            { "sourceUrl", Source }, { "audio", "https://api.dictionaryapi.dev/media/pronunciations/en/match-us.mp3" } } };
        return new("match", VocabularyPayload.FromBson(raw), DateTime.UtcNow);
    }
    internal static DictionaryAudioService Service(MemoryVocabularyRepository repo, IDictionaryAudioDownload download, IDictionaryAudioStorage storage,
        DictionaryAudioSettings options) => new(repo, download, storage, Options.Create(options), new AudioTestEnvironment(), NullLogger<DictionaryAudioService>.Instance);
    internal static void RemoveTestRoot(string root)
    {
        var path = Path.GetFullPath(root);
        if (!path.StartsWith(Path.GetFullPath(Path.GetTempPath()) + (Path.GetTempPath().EndsWith(Path.DirectorySeparatorChar) ? "" : Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase) ||
            !Path.GetFileName(path).StartsWith("englishlearning-audio-tests-", StringComparison.Ordinal)) throw new InvalidOperationException("Refusing to remove non-test audio directory.");
        if (Directory.Exists(path)) Directory.Delete(path, true);
    }
}

public sealed class DictionaryAudioTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "englishlearning-audio-tests-" + Guid.NewGuid().ToString("N"));
    private DictionaryAudioSettings Settings(long max = 1024 * 1024) => new() { RootPath = root, MaxCacheBytes = max };
    private DictionaryAudioStorage Storage(DictionaryAudioSettings? options = null) => new(Options.Create(options ?? Settings()), new AudioTestEnvironment());
    public void Dispose() => AudioFixture.RemoveTestRoot(root);

    [Theory]
    [InlineData("https://commons.wikimedia.org/w/index.php?curid=825478", "commons:page:825478")]
    [InlineData("https://commons.wikimedia.org/wiki/File:En-us-match.ogg", "commons:title:File:En-us-match.ogg")]
    [InlineData("https://commons.wikimedia.org/wiki/File:En_us_match.ogg", "commons:title:File:En us match.ogg")]
    public void Commons_identity_comes_from_source_not_word_spelling(string source, string expected)
    { Assert.Equal(expected, WikimediaAudioResolver.Identify(AudioFixture.Phonetic(source, null))!.Identity); }

    [Theory]
    [InlineData("https://127.0.0.1/private")] [InlineData("http://upload.wikimedia.org/wikipedia/commons/file.ogg")]
    [InlineData("https://upload.wikimedia.org.evil.example/wikipedia/commons/a.ogg")]
    [InlineData("https://upload.wikimedia.org:444/wikipedia/commons/a.ogg")]
    [InlineData("https://user:pass@upload.wikimedia.org/wikipedia/commons/a.ogg")]
    [InlineData("file:///C:/secret.mp3")] [InlineData("https://example.com/a.mp3")]
    public void Arbitrary_sources_and_download_urls_are_rejected(string url)
    { Assert.Null(WikimediaAudioResolver.Identify(AudioFixture.Phonetic(url, url))); }

    [Fact]
    public async Task Resolver_uses_imageinfo_and_preserves_plain_text_attribution()
    {
        var calls = new List<string>();
        var factory = new AudioTestFactory((request, _) =>
        {
            calls.Add(request.RequestUri!.AbsoluteUri);
            return Task.FromResult(JsonMetadata());
        });
        var resolver = new WikimediaAudioResolver(factory, Options.Create(Settings()));
        var resolved = await resolver.ResolveAsync(WikimediaAudioResolver.Identify(AudioFixture.Phonetic())!, default);
        Assert.Equal(AudioFixture.FileUrl, resolved!.Url.AbsoluteUri);
        Assert.Equal("Speaker & author", resolved.Attribution.Author);
        Assert.Equal("en-US", resolved.Attribution.Locale);
        Assert.Contains("pageids=825478", calls.Single()); Assert.Contains("imageinfo", calls.Single());
    }

    private static HttpResponseMessage JsonMetadata(string fileUrl = AudioFixture.FileUrl) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(System.Text.Json.JsonSerializer.Serialize(new { query = new { pages = new[] { new
        {
            title = "File:En-us-match.wav", imageinfo = new[] { new { url = fileUrl, size = AudioFixture.Wave().Length,
                extmetadata = new { Artist = new { value = "<b>Speaker &amp; author</b>" }, LicenseShortName = new { value = "CC BY 3.0" }, LicenseUrl = new { value = "https://creativecommons.org/licenses/by/3.0/" } } } }
        } } } }), Encoding.UTF8, "application/json")
    };
    private static HttpResponseMessage Sound(byte[]? bytes = null, string mime = "audio/wav")
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes ?? AudioFixture.Wave()) };
        response.Content.Headers.ContentType = new(mime); return response;
    }

    [Fact]
    public async Task Original_audio_is_preferred_and_wrong_body_is_never_cached()
    {
        var calls = new List<string>();
        var factory = new AudioTestFactory((request, _) =>
        {
            calls.Add(request.RequestUri!.Host);
            return Task.FromResult(request.RequestUri.Host == "commons.wikimedia.org" ? JsonMetadata() : Sound());
        });
        var resolver = new WikimediaAudioResolver(factory, Options.Create(Settings()));
        var download = new DictionaryAudioDownload(factory, resolver, Options.Create(Settings()), NullLogger<DictionaryAudioDownload>.Instance);
        var audio = await download.DownloadAsync(WikimediaAudioResolver.Identify(AudioFixture.Phonetic())!, default);
        Assert.Equal("wikimedia", audio.Attribution.Provider); Assert.Equal(2, calls.Count);
        Assert.DoesNotContain("api.dictionaryapi.dev", calls);
        factory = new((_, _) => Task.FromResult(Sound(Encoding.UTF8.GetBytes("<html>upstream error, this is not sound</html>"), "audio/mpeg")));
        download = new(factory, new(factory, Options.Create(Settings())), Options.Create(Settings()), NullLogger<DictionaryAudioDownload>.Instance);
        await Assert.ThrowsAsync<VocabularyException>(() => download.DownloadAsync(WikimediaAudioResolver.Identify(AudioFixture.Phonetic(null))!, default));
    }

    [Fact]
    public async Task Bad_redirect_cannot_fetch_private_network_and_dictionary_fallback_is_supported()
    {
        var hosts = new List<string>();
        var factory = new AudioTestFactory((request, _) =>
        {
            hosts.Add(request.RequestUri!.Host);
            if (request.RequestUri.Host == "commons.wikimedia.org") return Task.FromResult(JsonMetadata());
            if (request.RequestUri.Host == "api.dictionaryapi.dev") return Task.FromResult(Sound());
            var redirect = new HttpResponseMessage(HttpStatusCode.Found); redirect.Headers.Location = new Uri("http://127.0.0.1/private"); return Task.FromResult(redirect);
        });
        var download = new DictionaryAudioDownload(factory, new(factory, Options.Create(Settings())), Options.Create(Settings()), NullLogger<DictionaryAudioDownload>.Instance);
        var audio = await download.DownloadAsync(WikimediaAudioResolver.Identify(AudioFixture.Phonetic())!, default);
        Assert.Equal("dictionaryApi", audio.Attribution.Provider); Assert.DoesNotContain("127.0.0.1", hosts);
    }

    [Fact]
    public async Task Empty_oversized_and_plain_text_bodies_are_rejected()
    {
        foreach (var body in new[] { Array.Empty<byte>(), new byte[4096] })
            await Assert.ThrowsAsync<VocabularyException>(() => DictionaryAudioDownload.ReadLimitedAsync(new ByteArrayContent(body), 1024, default));
        var factory = new AudioTestFactory((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.BadGateway) { Content = new StringContent("error code: 502") }));
        var download = new DictionaryAudioDownload(factory, new(factory, Options.Create(Settings())), Options.Create(Settings()), NullLogger<DictionaryAudioDownload>.Instance);
        await Assert.ThrowsAsync<VocabularyException>(() => download.DownloadAsync(WikimediaAudioResolver.Identify(AudioFixture.Phonetic(null))!, default));
    }

    [Fact]
    public async Task Atomic_cache_reuses_content_and_repairs_missing_or_corrupt_files()
    {
        var storage = Storage(); var reference = WikimediaAudioResolver.Identify(AudioFixture.Phonetic())!;
        var saved = await storage.StoreAsync(reference.Key, AudioFixture.Audio(), default);
        Assert.NotNull(await Storage().FindAsync(reference.Key, default)); // Recreated storage, same disk.
        var bytes = AudioFixture.Wave(); bytes[0] = 0;
        await File.WriteAllBytesAsync(storage.PathFor(saved), bytes);
        Assert.Null(await storage.FindAsync(reference.Key, default));
        await storage.StoreAsync(reference.Key, AudioFixture.Audio(), default);
        Assert.NotNull(await storage.FindAsync(reference.Key, default));
        File.Delete(storage.PathFor(saved));
        Assert.Null(await storage.FindAsync(reference.Key, default));
        await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => storage.StoreAsync(reference.Key, AudioFixture.Audio(), default)));
        Assert.Single(Directory.GetFiles(root, "*.wav")); Assert.Single(Directory.GetFiles(root, "*.json")); Assert.Empty(Directory.GetFiles(root, "*.tmp"));
        var other = WikimediaAudioResolver.Identify(AudioFixture.Phonetic(null, "https://api.dictionaryapi.dev/media/pronunciations/en/match-uk.mp3"))!;
        await storage.StoreAsync(other.Key, AudioFixture.Audio(), default);
        Assert.Single(Directory.GetFiles(root, "*.wav")); // Different references, one content-addressed file.
    }

    [Fact]
    public async Task Quota_only_evicts_owned_cache_files()
    {
        Directory.CreateDirectory(root); await File.WriteAllTextAsync(Path.Combine(root, "user-file.txt"), "keep");
        var storage = Storage(Settings(3000));
        var first = WikimediaAudioResolver.Identify(AudioFixture.Phonetic())!;
        var second = WikimediaAudioResolver.Identify(AudioFixture.Phonetic(null, "https://api.dictionaryapi.dev/media/pronunciations/en/another.mp3"))!;
        await storage.StoreAsync(first.Key, AudioFixture.Audio(), default);
        await storage.StoreAsync(second.Key, AudioFixture.Audio(1), default);
        Assert.NotNull(await storage.FindAsync(second.Key, default));
        Assert.True(File.Exists(Path.Combine(root, "user-file.txt")));
        Assert.True(new DirectoryInfo(root).GetFiles().Sum(file => file.Length) <= 3000 + 4);
    }

    [Fact]
    public async Task Preparation_is_coalesced_durable_and_get_does_not_download()
    {
        var repo = new MemoryVocabularyRepository(); repo.Items["en:match"] = AudioFixture.Entry();
        var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var source = new FakeAudioDownload { Fetch = async token => { ready.TrySetResult(); await release.Task.WaitAsync(token); return AudioFixture.Audio(); } };
        var service = AudioFixture.Service(repo, source, Storage(), Settings());
        var request = new DictionaryAudioRequest { Word = "MATCH", Phonetic = 0 };
        Assert.Null(await service.FindAsync(request, default)); Assert.Equal(0, source.Calls);
        using var cancel = new CancellationTokenSource(); var canceled = service.PrepareAsync(request, cancel.Token);
        await ready.Task; var others = Enumerable.Range(0, 10).Select(_ => service.PrepareAsync(request, default)).ToArray();
        cancel.Cancel(); await Assert.ThrowsAnyAsync<OperationCanceledException>(() => canceled);
        release.TrySetResult(); await Task.WhenAll(others); Assert.Equal(1, source.Calls);
        source.Fetch = _ => throw new InvalidOperationException("Offline");
        var restarted = AudioFixture.Service(repo, source, Storage(), Settings());
        Assert.NotNull(await restarted.PrepareAsync(request, default)); Assert.Equal(1, source.Calls);
        var invalid = new DictionaryAudioRequest { Word = "match", Entry = 100 };
        Assert.Equal(404, (await Assert.ThrowsAsync<VocabularyException>(() => service.PrepareAsync(invalid, default))).StatusCode);
    }

    [Fact]
    public async Task Failed_preparation_does_not_persist_and_can_be_retried()
    {
        var repo = new MemoryVocabularyRepository(); repo.Items["en:match"] = AudioFixture.Entry();
        var source = new FakeAudioDownload { Fetch = _ => throw new VocabularyException(502, "invalid_audio", "Bad source") };
        var service = AudioFixture.Service(repo, source, Storage(), Settings());
        var request = new DictionaryAudioRequest { Word = "match" };
        await Assert.ThrowsAsync<VocabularyException>(() => service.PrepareAsync(request, default));
        Assert.False(Directory.Exists(root));
        source.Fetch = _ => Task.FromResult(AudioFixture.Audio());
        Assert.NotNull(await service.PrepareAsync(request, default)); Assert.Equal(2, source.Calls);
    }
}

public sealed class LiveAudioFactAttribute : FactAttribute
{
    public LiveAudioFactAttribute()
    { if (Environment.GetEnvironmentVariable("ENGLISHLEARNING_RUN_LIVE_AUDIO_TEST") != "1") Skip = "Opt in with ENGLISHLEARNING_RUN_LIVE_AUDIO_TEST=1 to contact Wikimedia."; }
}

public sealed class LiveDictionaryAudioTests(Xunit.Abstractions.ITestOutputHelper output)
{
    [LiveAudioFact]
    public async Task Match_original_is_downloaded_and_remains_available_offline_after_storage_recreation()
    {
        var root = Path.Combine(Path.GetTempPath(), "englishlearning-audio-tests-" + Guid.NewGuid().ToString("N"));
        try
        {
            var options = Options.Create(new DictionaryAudioSettings { RootPath = root });
            var factory = new AudioTestFactory(async (request, token) =>
            {
                using var client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(15) };
                using var copy = new HttpRequestMessage(request.Method, request.RequestUri);
                copy.Headers.UserAgent.ParseAdd(options.Value.UserAgent);
                // Response is buffered before this test-only client is disposed.
                var response = await client.SendAsync(copy, token);
                output.WriteLine($"GET {copy.RequestUri} -> {(int)response.StatusCode} {response.Content.Headers.ContentType}; {response.Content.Headers.ContentLength} bytes");
                return response;
            });
            var download = new DictionaryAudioDownload(factory, new(factory, options), options, NullLogger<DictionaryAudioDownload>.Instance);
            var clock = System.Diagnostics.Stopwatch.StartNew();
            var audio = await download.DownloadAsync(WikimediaAudioResolver.Identify(AudioFixture.Phonetic())!, default);
            Assert.Equal("wikimedia", audio.Attribution.Provider); Assert.Equal("audio/ogg", audio.ContentType); Assert.NotNull(audio.Attribution.LicenseName);
            var storage = new DictionaryAudioStorage(options, new AudioTestEnvironment());
            var repo = new MemoryVocabularyRepository(); repo.Items["en:match"] = AudioFixture.Entry();
            var key = WikimediaAudioResolver.Identify(AudioFixture.Phonetic())!.Key;
            await storage.StoreAsync(key, audio, default);
            var coldMs = clock.Elapsed.TotalMilliseconds;
            var blocked = new FakeAudioDownload { Fetch = _ => throw new InvalidOperationException("Network intentionally unavailable") };
            var restarted = AudioFixture.Service(repo, blocked, new DictionaryAudioStorage(options, new AudioTestEnvironment()), options.Value);
            clock.Restart();
            Assert.NotNull(await restarted.PrepareAsync(new() { Word = "match" }, default)); Assert.Equal(0, blocked.Calls);
            var warmMs = clock.Elapsed.TotalMilliseconds;
            var report = new { measuredAtUtc = DateTime.UtcNow, source = audio.Attribution.FileUrl, contentType = audio.ContentType,
                sizeBytes = audio.Bytes.Length, coldResolveDownloadAndStoreMs = coldMs, cachePrepareAfterRecreationMs = warmMs,
                upstreamCallsOnCacheHit = blocked.Calls, note = "One live sample; warm service uses an in-memory vocabulary repository; excludes SQL authentication, MongoDB and browser/proxy." };
            output.WriteLine(System.Text.Json.JsonSerializer.Serialize(report));
            var reportPath = Environment.GetEnvironmentVariable("ENGLISHLEARNING_AUDIO_SMOKE_REPORT");
            if (!string.IsNullOrWhiteSpace(reportPath))
                await File.WriteAllTextAsync(reportPath, System.Text.Json.JsonSerializer.Serialize(report, new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
        }
        finally { AudioFixture.RemoveTestRoot(root); }
    }
}

public sealed partial class RegistrationSqlServerTests
{
    private sealed class UnavailableDictionaryCloud : ICloudMediaStore
    {
        public int Calls;
        public Task<CloudMediaManifest?> FindAsync(CloudMediaKind kind, string key, CancellationToken token)
        { Calls++; throw new CloudMediaException(503, "media_storage_rate_limited", true, 10); }
        public Task<CloudMediaManifest> StoreAsync(CloudMediaKind kind, string key, ReadOnlyMemory<byte> bytes, string format, AudioAttribution? attribution, CancellationToken token) => throw new InvalidOperationException();
        public Task<CloudMediaRead> OpenAsync(CloudMediaKind kind, string key, string? range, CancellationToken token) => throw new InvalidOperationException();
    }

    [SqlServerFact]
    public async Task Dictionary_cloud_failure_is_private_retryable_and_does_not_block_meanings()
    {
        var login = await SignIn(await RegisterLoginUser()); var cloud = new UnavailableDictionaryCloud();
        var repo = new MemoryVocabularyRepository(); repo.Items["en:match"] = AudioFixture.Entry();
        await using var audioFactory = factory.WithWebHostBuilder(builder => builder
            .ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?> {
                ["Cloudinary:Enabled"] = "true", ["Cloudinary:CloudName"] = "unit-cloud", ["Cloudinary:ApiKey"] = "123456789012345",
                ["Cloudinary:ApiSecret"] = "unit-secret-not-real", ["Cloudinary:EnvironmentPrefix"] = "els/test" }))
            .ConfigureServices(services => {
                services.RemoveAll<IVocabularyRepository>(); services.AddSingleton<IVocabularyRepository>(repo);
                services.RemoveAll<ICloudMediaStore>(); services.AddSingleton<ICloudMediaStore>(cloud);
            }));
        using var http = audioFactory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await http.GetAsync("/api/v1/vocabulary/audio?word=match")).StatusCode); Assert.Equal(0, cloud.Calls);
        http.DefaultRequestHeaders.Authorization = new("Bearer", login.AccessToken);
        foreach (var prepare in new[] { false, true })
        {
            using var response = prepare ? await http.PostAsJsonAsync("/api/v1/vocabulary/audio/prepare", new DictionaryAudioRequest { Word = "match" })
                : await http.GetAsync("/api/v1/vocabulary/audio?word=match");
            Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode); Assert.True(response.Headers.CacheControl?.NoStore);
            Assert.Equal(TimeSpan.FromSeconds(10), response.Headers.RetryAfter?.Delta);
            Assert.Contains("media_storage_rate_limited", await response.Content.ReadAsStringAsync());
        }
        Assert.Equal(HttpStatusCode.OK, (await http.GetAsync("/api/v1/vocabulary?word=match")).StatusCode);
    }

    [SqlServerFact]
    public async Task Legacy_dictionary_file_keeps_existing_url_and_mvc_range_without_cloud_writes()
    {
        var root = Path.Combine(Path.GetTempPath(), "englishlearning-audio-tests-" + Guid.NewGuid().ToString("N"));
        try
        {
            var options = Options.Create(new DictionaryAudioSettings { RootPath = root });
            await new DictionaryAudioStorage(options, new AudioTestEnvironment()).StoreAsync(WikimediaAudioResolver.Identify(AudioFixture.Phonetic())!.Key, AudioFixture.Audio(), default);
            var login = await SignIn(await RegisterLoginUser()); var repo = new MemoryVocabularyRepository(); repo.Items["en:match"] = AudioFixture.Entry();
            await using var audioFactory = factory.WithWebHostBuilder(builder => builder
                .ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?> {
                    ["Cloudinary:Enabled"] = "false", ["Cloudinary:AllowLegacyReads"] = "true", ["DictionaryAudioSettings:RootPath"] = root }))
                .ConfigureServices(services => { services.RemoveAll<IVocabularyRepository>(); services.AddSingleton<IVocabularyRepository>(repo); }));
            using var http = audioFactory.CreateClient(); http.DefaultRequestHeaders.Authorization = new("Bearer", login.AccessToken);
            using var full = await http.GetAsync("/api/v1/vocabulary/audio?word=match");
            Assert.Equal(HttpStatusCode.OK, full.StatusCode); Assert.Equal(AudioFixture.Wave(), await full.Content.ReadAsByteArrayAsync());
            using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/vocabulary/audio?word=match"); request.Headers.Range = new(4, 15);
            using var part = await http.SendAsync(request); Assert.Equal(HttpStatusCode.PartialContent, part.StatusCode);
            Assert.Equal(AudioFixture.Wave()[4..16], await part.Content.ReadAsByteArrayAsync());
            Assert.True(part.Headers.CacheControl?.NoStore); Assert.Equal($"bytes 4-15/{AudioFixture.Wave().Length}", part.Content.Headers.ContentRange?.ToString());
        }
        finally { AudioFixture.RemoveTestRoot(root); }
    }

    [SqlServerFact]
    public async Task Audio_prepare_and_file_enforce_auth_and_support_range_without_redownloading()
    {
        var root = Path.Combine(Path.GetTempPath(), "englishlearning-audio-tests-" + Guid.NewGuid().ToString("N"));
        try
        {
            var login = await SignIn(await RegisterLoginUser());
            var repo = new MemoryVocabularyRepository(); repo.Items["en:match"] = AudioFixture.Entry(); var source = new FakeAudioDownload();
            var transport = new MemoryCloudTransport();
            await using var audioFactory = factory.WithWebHostBuilder(builder => builder
                .ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?> {
                    ["DictionaryAudioSettings:RootPath"] = root, ["Cloudinary:Enabled"] = "true", ["Cloudinary:CloudName"] = "unit-cloud",
                    ["Cloudinary:ApiKey"] = "123456789012345", ["Cloudinary:ApiSecret"] = "unit-secret-not-real", ["Cloudinary:EnvironmentPrefix"] = "els/test" }))
                .ConfigureServices(services =>
                {
                    services.RemoveAll<IVocabularyRepository>(); services.AddSingleton<IVocabularyRepository>(repo);
                    services.RemoveAll<IDictionaryAudioDownload>(); services.AddSingleton<IDictionaryAudioDownload>(source);
                    services.RemoveAll<ICloudinaryAssetTransport>(); services.AddSingleton<ICloudinaryAssetTransport>(transport);
                }));
            using var http = audioFactory.CreateClient(); var selection = new DictionaryAudioRequest { Word = "match" };
            Assert.Equal(HttpStatusCode.Unauthorized, (await http.PostAsJsonAsync("/api/v1/vocabulary/audio/prepare", selection)).StatusCode);
            http.DefaultRequestHeaders.Authorization = new("Bearer", login.AccessToken);
            Assert.Equal(HttpStatusCode.NotFound, (await http.GetAsync("/api/v1/vocabulary/audio?word=match&entry=0&phonetic=0")).StatusCode);
            Assert.Equal(0, source.Calls);
            var response = await http.PostAsJsonAsync("/api/v1/vocabulary/audio/prepare", selection);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var ready = (await response.Content.ReadFromJsonAsync<DictionaryAudioReadyResponse>())!;
            Assert.Equal("ready", ready.Status); Assert.Equal("audio/wav", ready.ContentType); Assert.DoesNotContain(root, await response.Content.ReadAsStringAsync());
            Assert.Equal(AudioFixture.Audio().Attribution, ready.Attribution);
            Assert.False(Directory.Exists(root)); Assert.Equal(1, transport.BinaryCreates); Assert.Equal(1, transport.ManifestCreates);
            using var range = new HttpRequestMessage(HttpMethod.Get, "/api/v1/vocabulary/audio?word=match&entry=0&phonetic=0");
            range.Headers.Range = new(0, 15); response = await http.SendAsync(range);
            Assert.Equal(HttpStatusCode.PartialContent, response.StatusCode); Assert.Equal(16, (await response.Content.ReadAsByteArrayAsync()).Length);
            Assert.True(response.Headers.CacheControl?.NoStore); Assert.NotNull(response.Content.Headers.ContentRange);
            using var invalidRange = new HttpRequestMessage(HttpMethod.Get, "/api/v1/vocabulary/audio?word=match");
            invalidRange.Headers.Range = new(99999, 100000);
            Assert.Equal(HttpStatusCode.RequestedRangeNotSatisfiable, (await http.SendAsync(invalidRange)).StatusCode);
            Assert.Equal(1, source.Calls);
            var reads = transport.Reads;
            Assert.Equal(HttpStatusCode.BadRequest, (await http.PostAsJsonAsync("/api/v1/vocabulary/audio/prepare", new { word = "match", entry = -1, phonetic = 0 })).StatusCode);
            using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
            var user = await db.Users.SingleAsync(user => user.UserId == login.User.UserId); user.IsActive = false; await db.SaveChangesAsync();
            Assert.Equal(HttpStatusCode.Unauthorized, (await http.PostAsJsonAsync("/api/v1/vocabulary/audio/prepare", selection)).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, (await http.GetAsync("/api/v1/vocabulary/audio?word=match")).StatusCode);
            Assert.Equal(reads, transport.Reads);
        }
        finally { AudioFixture.RemoveTestRoot(root); }
    }
}
