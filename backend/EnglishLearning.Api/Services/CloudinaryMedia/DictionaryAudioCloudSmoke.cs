using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Documents;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;

namespace EnglishLearning.Api.Services.CloudinaryMedia;

// Explicit CLI only: real cloud transport, isolated namespace, in-memory vocabulary/source.
// SQL auth is covered by HTTP integration tests, original downloads by live source tests.
internal static class DictionaryAudioCloudSmoke
{
    public static async Task VerifyAsync(Func<CloudinaryMediaStore> createCloud, CloudinarySettings settings,
        string contentRoot, List<CloudinarySmokeCheck> checks, CancellationToken token)
    {
        var environment = new SmokeEnvironment { ContentRootPath = contentRoot };
        var audioOptions = Options.Create(new DictionaryAudioSettings
        { RootPath = Path.Combine(contentRoot, "App_Data", "dictionary-cloud-smoke-" + Guid.NewGuid().ToString("N")) });
        var repo = new SmokeRepository(); var before = repo.Entry.ToBson().ToJson();
        var source = new SmokeSource(); var request = new DictionaryAudioRequest { Word = "match" };
        CloudinaryDictionaryAudioStorage Storage(ICloudMediaStore cloud) => new(() => cloud,
            new DictionaryAudioStorage(audioOptions, environment), Options.Create(settings), audioOptions);
        DictionaryAudioService Service(IDictionaryAudioStorage storage, SmokeSource download) =>
            new(repo, download, storage, audioOptions, environment, NullLogger<DictionaryAudioService>.Instance);
        void Record(string name, bool passed)
        {
            checks.Add(new(name, passed));
            if (!passed) throw new CloudMediaException(502, "dictionary_cloud_smoke_assertion_failed");
        }
        using var firstCloud = createCloud(); var firstStore = Storage(firstCloud); var first = Service(firstStore, source);
        Record("dictionary_pipeline_get_miss_without_download", await first.FindAsync(request, token) is null && source.Calls == 0);
        source.Fail = true; var failed = false;
        try { await first.PrepareAsync(request, token); }
        catch (VocabularyException error) when (error.Code == "audio_unavailable") { failed = true; }
        Record("dictionary_pipeline_failed_prepare_keeps_meaning", failed && before == repo.Entry.ToBson().ToJson());
        source.Fail = false;
        var pending = Enumerable.Range(0, 8).Select(_ => first.PrepareAsync(request, token)).ToArray();
        var prepared = await Task.WhenAll(pending);
        Record("dictionary_pipeline_retry_and_coalesced_prepare", source.Calls == 2 && prepared.All(entry => entry == prepared[0]));
        Record("dictionary_pipeline_attribution_preserved", prepared[0].Attribution == source.Audio.Attribution);

        using var restartedCloud = createCloud(); var restartedStore = Storage(restartedCloud);
        var offline = new SmokeSource { Fail = true }; var restarted = Service(restartedStore, offline);
        Record("dictionary_pipeline_cold_cloud_hit_without_source", await restarted.PrepareAsync(request, token) == prepared[0] && offline.Calls == 0);
        await using (var full = await restartedStore.OpenAsync(prepared[0], null, token))
        {
            using var bytes = new MemoryStream(); await full.Body.CopyToAsync(bytes, token);
            Record("dictionary_pipeline_cloud_playback_bytes", full.Status == 200 && !full.EnableRangeProcessing && bytes.ToArray().AsSpan().SequenceEqual(source.Audio.Bytes));
        }
        await using (var range = await restartedStore.OpenAsync(prepared[0], "bytes=0-31", token))
        {
            using var bytes = new MemoryStream(); await range.Body.CopyToAsync(bytes, token);
            Record("dictionary_pipeline_range_206", range.Status == 206 && range.Length == 32 && bytes.ToArray().AsSpan().SequenceEqual(source.Audio.Bytes.AsSpan(0, 32)));
        }
        await using (var range = await restartedStore.OpenAsync(prepared[0], "bytes=999999-", token))
            Record("dictionary_pipeline_range_416", range.Status == 416 && range.Length == 0 && range.ContentRange == $"bytes */{source.Audio.Bytes.Length}");
        Record("dictionary_pipeline_no_local_media_or_schema_change", !Directory.Exists(audioOptions.Value.RootPath) &&
            repo.Entry.ToBson().ElementCount == 5 && before == repo.Entry.ToBson().ToJson());
    }

    private sealed class SmokeSource : IDictionaryAudioDownload
    {
        public bool Fail; public int Calls;
        public readonly DownloadedDictionaryAudio Audio = new(CloudinaryEnvironmentSmoke.Fixtures().Single(file => file.ResourceType == "video").Bytes,
            "ogg", "audio/ogg", new("wikimedia", "https://commons.wikimedia.org/wiki/File:En-us-match.ogg",
                "https://upload.wikimedia.org/wikipedia/commons/a/ad/En-us-match.ogg", "Dvortygirl", "CC BY-SA 3.0",
                "https://creativecommons.org/licenses/by-sa/3.0/", "en-US"));
        public async Task<DownloadedDictionaryAudio> DownloadAsync(DictionaryAudioReference reference, CancellationToken token)
        {
            Interlocked.Increment(ref Calls);
            await Task.Delay(50, token);
            if (Fail) throw new VocabularyException(503, "audio_unavailable", "Smoke source unavailable.");
            return Audio;
        }
    }
    private sealed class SmokeRepository : IVocabularyRepository
    {
        public readonly VocabularyEntryDocument Entry = new("match", VocabularyPayload.FromBson(BsonSerializer.Deserialize<BsonArray>("""
            [{"word":"match","phonetics":[{"text":"/mætʃ/","sourceUrl":"https://commons.wikimedia.org/wiki/File:En-us-match.ogg"}],
              "meanings":[{"partOfSpeech":"noun","definitions":[{"definition":"A dictionary audio smoke fixture."}]}]}]
            """)), DateTime.UtcNow);
        public Task<VocabularyEntryDocument?> FindAsync(string key, CancellationToken token)
        { token.ThrowIfCancellationRequested(); return Task.FromResult<VocabularyEntryDocument?>(key == Entry.Id ? Entry : null); }
        public Task<VocabularyEntryDocument> SaveAsync(VocabularyEntryDocument entry, CancellationToken token) => throw new InvalidOperationException("Smoke vocabulary is read-only.");
    }
    private sealed class SmokeEnvironment : IWebHostEnvironment, IHostApplicationLifetime
    {
        public string ApplicationName { get; set; } = "EnglishLearning.Api";
        public string EnvironmentName { get; set; } = "Development";
        public string ContentRootPath { get; set; } = "";
        public string WebRootPath { get; set; } = "";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public CancellationToken ApplicationStarted => CancellationToken.None;
        public CancellationToken ApplicationStopping => CancellationToken.None;
        public CancellationToken ApplicationStopped => CancellationToken.None;
        public void StopApplication() { }
    }
}
