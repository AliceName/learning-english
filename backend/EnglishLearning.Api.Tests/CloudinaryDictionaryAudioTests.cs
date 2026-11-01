using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Services;
using EnglishLearning.Api.Services.CloudinaryMedia;
using Microsoft.Extensions.Options;
using MongoDB.Bson;

namespace EnglishLearning.Api.Tests;

public sealed class CloudinaryDictionaryAudioTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "englishlearning-audio-tests-" + Guid.NewGuid().ToString("N"));
    private static readonly DictionaryAudioRequest Request = new() { Word = "match" };
    private static string Key => WikimediaAudioResolver.Identify(AudioFixture.Phonetic())!.Key;
    private readonly MemoryCloudTransport transport = new();
    private DictionaryAudioSettings Settings => new() { RootPath = root };
    private DictionaryAudioStorage Legacy => new(Options.Create(Settings), new AudioTestEnvironment());
    private CloudinaryMediaStore Cloud() => new(transport, Options.Create(new CloudinarySettings { EnvironmentPrefix = "els/test" }),
        Options.Create(new CloudinaryMediaOptions()), TimeProvider.System);
    private CloudinaryDictionaryAudioStorage Storage(ICloudMediaStore cloud, bool enabled = true) => new(() => cloud, Legacy,
        Options.Create(new CloudinarySettings { Enabled = enabled, AllowLegacyReads = true }), Options.Create(Settings));
    private DictionaryAudioService Service(IDictionaryAudioStorage storage, FakeAudioDownload download, MemoryVocabularyRepository? repo = null)
    {
        repo ??= new(); repo.Items["en:match"] = AudioFixture.Entry();
        return AudioFixture.Service(repo, download, storage, Settings);
    }
    public void Dispose() => AudioFixture.RemoveTestRoot(root);

    [Fact]
    public async Task Miss_uploads_to_cloud_and_recreated_service_hits_without_source_or_disk_write()
    {
        var download = new FakeAudioDownload(); using var cloud = Cloud(); var store = Storage(cloud);
        var service = Service(store, download);
        Assert.Null(await service.FindAsync(Request, default)); Assert.Equal(0, download.Calls);
        var saved = await service.PrepareAsync(Request, default);
        Assert.Equal(AudioFixture.Audio().Attribution, saved.Attribution); Assert.False(Directory.Exists(root));
        Assert.Equal(1, transport.BinaryCreates); Assert.Equal(1, transport.ManifestCreates);
        using var restartedCloud = Cloud();
        var offline = new FakeAudioDownload { Fetch = _ => throw new InvalidOperationException("Source unavailable") };
        var restartedStore = Storage(restartedCloud); var restarted = Service(restartedStore, offline);
        Assert.Equal(saved, await restarted.PrepareAsync(Request, default)); Assert.Equal(0, offline.Calls);
        await using var read = await restartedStore.OpenAsync(saved, null, default);
        using var bytes = new MemoryStream(); await read.Body.CopyToAsync(bytes);
        Assert.Equal(AudioFixture.Wave(), bytes.ToArray()); Assert.False(read.EnableRangeProcessing);
    }

    [Fact]
    public async Task Existing_local_audio_keeps_working_without_new_upload_or_download()
    {
        var legacy = Legacy; var saved = await legacy.StoreAsync(Key, AudioFixture.Audio(), default);
        var before = Directory.GetFiles(root).Select(path => (path, new FileInfo(path).LastWriteTimeUtc)).ToArray();
        using var cloud = Cloud(); var store = Storage(cloud); var download = new FakeAudioDownload();
        var service = Service(store, download);
        Assert.Equal(saved, await service.PrepareAsync(Request, default)); Assert.Equal(0, download.Calls); Assert.Equal(0, transport.UploadCalls);
        await using var read = await store.OpenAsync(saved, "bytes=0-15", default);
        Assert.True(read.EnableRangeProcessing); Assert.True(read.Body.CanSeek); // MVC slices legacy files.
        using var bytes = new MemoryStream(); await read.Body.CopyToAsync(bytes); Assert.Equal(AudioFixture.Wave(), bytes.ToArray());
        Assert.Equal(before, Directory.GetFiles(root).Select(path => (path, new FileInfo(path).LastWriteTimeUtc)).ToArray());
    }

    [Fact]
    public async Task Cloud_wins_over_legacy_and_preserves_its_attribution()
    {
        await Legacy.StoreAsync(Key, AudioFixture.Audio(1), default);
        using var cloud = Cloud(); var store = Storage(cloud);
        var credit = AudioFixture.Audio().Attribution with { Author = "Cloud original speaker" };
        var saved = await store.StoreAsync(Key, AudioFixture.Audio() with { Attribution = credit }, default);
        Assert.Equal(saved, await store.FindAsync(Key, default)); Assert.Equal(credit, saved.Attribution);
        await using var read = await store.OpenAsync(saved, "bytes=0-15", default);
        Assert.Equal(206, read.Status); Assert.Equal(16, read.Length); Assert.False(read.EnableRangeProcessing);
        Assert.Equal($"bytes 0-15/{saved.SizeBytes}", read.ContentRange);
    }

    [Fact]
    public async Task Cloud_miss_cannot_make_get_start_a_download()
    {
        using var cloud = Cloud(); var store = Storage(cloud); var download = new FakeAudioDownload();
        Assert.Null(await Service(store, download).FindAsync(Request, default));
        Assert.Equal(0, download.Calls); Assert.Empty(transport.Items); Assert.False(Directory.Exists(root));
    }

    [Fact]
    public async Task Cloud_failure_does_not_fall_back_to_local_reads_or_writes()
    {
        await Legacy.StoreAsync(Key, AudioFixture.Audio(), default);
        var store = new CloudinaryDictionaryAudioStorage(() => throw new CloudMediaException(503, "media_storage_unavailable", true), Legacy,
            Options.Create(new CloudinarySettings { Enabled = true }), Options.Create(Settings));
        var download = new FakeAudioDownload(); var repo = new MemoryVocabularyRepository();
        var service = Service(store, download, repo); var meaning = repo.Items["en:match"].Payload;
        var error = await Assert.ThrowsAsync<CloudMediaException>(() => service.PrepareAsync(Request, default));
        Assert.Equal("media_storage_unavailable", error.Code); Assert.Equal(0, download.Calls);
        Assert.Same(meaning, repo.Items["en:match"].Payload);
    }

    [Fact]
    public async Task Cancelled_waiter_does_not_cancel_shared_cloud_preparation()
    {
        using var cloud = Cloud(); var store = Storage(cloud);
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var download = new FakeAudioDownload { Fetch = async token => { started.TrySetResult(); await release.Task.WaitAsync(token); return AudioFixture.Audio(); } };
        var service = Service(store, download); using var cancel = new CancellationTokenSource();
        var canceled = service.PrepareAsync(Request, cancel.Token); await started.Task;
        var others = Enumerable.Range(0, 10).Select(_ => service.PrepareAsync(Request, default)).ToArray();
        cancel.Cancel(); await Assert.ThrowsAnyAsync<OperationCanceledException>(() => canceled);
        release.SetResult(); await Task.WhenAll(others);
        Assert.Equal(1, download.Calls); Assert.Equal(1, transport.BinaryCreates); Assert.Equal(1, transport.ManifestCreates);
        Assert.False(Directory.Exists(root));
    }

    [Fact]
    public async Task Failed_cloud_commit_can_be_retried_and_keeps_the_vocabulary_payload()
    {
        transport.FailManifest = true; using var cloud = Cloud(); var store = Storage(cloud);
        var download = new FakeAudioDownload(); var repo = new MemoryVocabularyRepository(); var service = Service(store, download, repo);
        var before = repo.Items["en:match"].ToBson().ToJson();
        await Assert.ThrowsAsync<CloudMediaException>(() => service.PrepareAsync(Request, default));
        Assert.False(Directory.Exists(root)); Assert.Equal(0, transport.ManifestCreates);
        transport.FailManifest = false;
        Assert.NotNull(await service.PrepareAsync(Request, default));
        Assert.Equal(1, transport.BinaryCreates); Assert.Equal(1, transport.ManifestCreates);
        Assert.Equal(before, repo.Items["en:match"].ToBson().ToJson());
    }

    [Fact]
    public async Task Disabled_cloud_allows_existing_audio_but_never_writes_new_local_files()
    {
        using var cloud = Cloud(); var store = Storage(cloud, false);
        var error = await Assert.ThrowsAsync<VocabularyException>(() => store.StoreAsync(Key, AudioFixture.Audio(), default));
        Assert.Equal("audio_storage_not_configured", error.Code); Assert.False(Directory.Exists(root));
        var download = new FakeAudioDownload();
        await Assert.ThrowsAsync<VocabularyException>(() => Service(store, download).PrepareAsync(Request, default));
        Assert.Equal(0, download.Calls);
        var old = await Legacy.StoreAsync(Key, AudioFixture.Audio(), default);
        Assert.Equal(old, await store.FindAsync(Key, default)); Assert.Equal(0, transport.UploadCalls);
    }

    [Fact]
    public async Task Already_cancelled_prepare_does_not_start_cloud_or_source_work()
    {
        using var cloud = Cloud(); var source = new FakeAudioDownload(); using var cancel = new CancellationTokenSource(); cancel.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Service(Storage(cloud), source).PrepareAsync(Request, cancel.Token));
        Assert.Equal(0, source.Calls); Assert.Equal(0, transport.Reads); Assert.Equal(0, transport.UploadCalls);
    }
}
