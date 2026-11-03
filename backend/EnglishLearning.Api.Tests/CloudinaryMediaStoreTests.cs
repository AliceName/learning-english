using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Services;
using EnglishLearning.Api.Services.CloudinaryMedia;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Tests;

internal sealed class MemoryCloudTransport : ICloudinaryAssetTransport
{
    internal sealed record Item(CloudAsset Asset, byte[] Bytes);
    internal ConcurrentDictionary<string, Item> Items = new();
    internal int UploadCalls, BinaryCreates, ManifestCreates, Reads, Stats;
    internal bool FailManifest, LoseManifestReply, IgnoreRanges, WrongRange, WrongMime, Truncate, CorruptBinary;
    internal bool OmitManifestLength;
    internal int ManifestHeaderLengthDelta, ManifestBodyLengthDelta;
    internal Func<string, Exception?>? Reject;
    internal Func<CloudAsset, Exception?>? RejectProbe;
    private long version;
    public async Task<CloudUpload> UploadIfAbsentAsync(string id, string type, string format, ReadOnlyMemory<byte> bytes, CancellationToken token)
    {
        token.ThrowIfCancellationRequested(); Interlocked.Increment(ref UploadCalls);
        await Task.Yield();
        if (Reject?.Invoke(id) is Exception rejected) throw rejected;
        if (type == "raw" && FailManifest) throw new CloudMediaException(503, "media_storage_unavailable", true);
        var proposed = new Item(new(Guid.NewGuid().ToString("N"), id, type, "authenticated", format,
            Interlocked.Increment(ref version).ToString(), bytes.Length), bytes.ToArray());
        var stored = Items.GetOrAdd(id, proposed);
        var created = ReferenceEquals(proposed, stored);
        if (created) { if (type == "raw") Interlocked.Increment(ref ManifestCreates); else Interlocked.Increment(ref BinaryCreates); }
        if (type == "raw" && LoseManifestReply) throw new CloudMediaException(504, "media_storage_timeout", true);
        return new CloudUpload(stored.Asset, created);
    }
    public Task<CloudAsset?> StatAsync(string id, string type, CancellationToken token)
    {
        token.ThrowIfCancellationRequested(); Interlocked.Increment(ref Stats);
        return Task.FromResult(Items.TryGetValue(id, out var item) ? item.Asset : null);
    }
    public async Task<CloudRemoteRead?> OpenManifestAsync(string id, CancellationToken token) =>
        Items.TryGetValue(id, out var item) ? await OpenAsync(item.Asset, null, token) : null;
    public Task<bool> ProbeAsync(CloudAsset asset, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (RejectProbe?.Invoke(asset) is Exception failure) throw failure;
        return Task.FromResult(Items.TryGetValue(asset.PublicId, out var item) && item.Asset == asset);
    }
    public Task<CloudRemoteRead> OpenAsync(CloudAsset asset, RangeHeaderValue? range, CancellationToken token)
    {
        token.ThrowIfCancellationRequested(); Interlocked.Increment(ref Reads);
        if (!Items.TryGetValue(asset.PublicId, out var item)) throw new CloudMediaException(404, "media_asset_missing");
        var bytes = item.Bytes.ToArray();
        if (CorruptBinary && asset.ResourceType != "raw") bytes[^1] ^= 1;
        var mime = asset.Format switch { "png" => "image/png", "jpg" => "image/jpeg", "webp" => "image/webp", "ogg" => "audio/ogg", "wav" => "audio/wav", "aac" => "audio/aac", "m4a" => "audio/mp4", "json" => "application/json", _ => "audio/mpeg" };
        if (WrongMime && asset.ResourceType != "raw") mime = "text/plain";
        if (range is not null && !IgnoreRanges)
        {
            var part = range.Ranges.Single(); var from = part.From!.Value; var to = part.To!.Value;
            return Task.FromResult(new CloudRemoteRead(HttpStatusCode.PartialContent, mime, to - from + 1,
                new ContentRangeHeaderValue(WrongRange ? from + 1 : from, to, bytes.Length), new MemoryStream(bytes[(int)from..((int)to + 1)])));
        }
        long? length = bytes.LongLength;
        if (asset.ResourceType == "raw")
        {
            length = OmitManifestLength ? null : length + ManifestHeaderLengthDelta;
            if (ManifestBodyLengthDelta < 0) bytes = bytes[..^1];
            if (ManifestBodyLengthDelta > 0) bytes = [.. bytes, 0];
        }
        if (Truncate && asset.ResourceType != "raw") bytes = bytes[..^1];
        return Task.FromResult(new CloudRemoteRead(HttpStatusCode.OK, mime, length, null, new MemoryStream(bytes)));
    }
}

public sealed class CloudinaryMediaStoreTests
{
    private const string Key = "1111111111111111111111111111111111111111111111111111111111111111";
    private const string OtherKey = "2222222222222222222222222222222222222222222222222222222222222222";
    private static readonly string Cover = new('a', 32);
    private static byte[] Wave => AudioFixture.Wave();
    private static AudioAttribution Credit => AudioFixture.Audio().Attribution;
    private static CloudinaryMediaStore Store(MemoryCloudTransport remote) => new(remote,
        Options.Create(new CloudinarySettings { EnvironmentPrefix = "els/test" }), Options.Create(new CloudinaryMediaOptions()), TimeProvider.System);
    private static Task<CloudMediaManifest> Save(CloudinaryMediaStore store, string key = Key, byte[]? bytes = null) =>
        store.StoreAsync(CloudMediaKind.DictionaryAudio, key, bytes ?? Wave, "wav", Credit, default);

    [Theory]
    [InlineData(CloudMediaKind.DictionaryAudio)]
    [InlineData(CloudMediaKind.CourseAudio)]
    [InlineData(CloudMediaKind.CourseCover)]
    public async Task Manifest_without_content_length_is_verified_on_commit_and_cold_read(CloudMediaKind kind)
    {
        var remote = new MemoryCloudTransport { OmitManifestLength = true };
        var cover = CloudinaryEnvironmentSmoke.Fixtures().Single(file => file.ResourceType == "image").Bytes;
        var key = kind == CloudMediaKind.DictionaryAudio ? Key : Cover;
        using var first = Store(remote);
        var saved = await first.StoreAsync(kind, key, kind == CloudMediaKind.CourseCover ? cover : Wave,
            kind == CloudMediaKind.CourseCover ? "png" : "wav", kind == CloudMediaKind.DictionaryAudio ? Credit : null, default);
        using var restarted = Store(remote);
        Assert.Equal(saved, await restarted.FindAsync(kind, key, default));
        Assert.Equal(1, remote.ManifestCreates);
    }

    [Theory]
    [InlineData(-1, "media_storage_truncated")]
    [InlineData(1, "media_storage_invalid_length")]
    public async Task Missing_manifest_length_does_not_hide_truncated_or_extra_bytes(int delta, string code)
    {
        var remote = new MemoryCloudTransport { OmitManifestLength = true, ManifestBodyLengthDelta = delta };
        using var store = Store(remote);
        var error = await Assert.ThrowsAsync<CloudMediaException>(() => Save(store));
        Assert.Equal(code, error.Code);
        Assert.NotEmpty(error.OrphanCandidates);
        remote.ManifestBodyLengthDelta = 0;
        Assert.NotNull(await Save(store)); // Retry verifies the committed manifest; no overwrite.
        Assert.Equal(1, remote.ManifestCreates);
    }

    [Fact]
    public async Task Declared_manifest_length_must_still_match_upload_receipt()
    {
        var remote = new MemoryCloudTransport { ManifestHeaderLengthDelta = 1 }; using var store = Store(remote);
        var error = await Assert.ThrowsAsync<CloudMediaException>(() => Save(store));
        Assert.Equal("media_storage_invalid_length", error.Code);
    }

    [Theory]
    [InlineData(0, "invalid_media_manifest_asset")]
    [InlineData(32769, "invalid_media_manifest_asset")]
    [InlineData(20, "invalid_media_manifest")]
    public async Task Cold_manifest_without_length_is_bounded_and_validated(int bodyLength, string code)
    {
        var remote = new MemoryCloudTransport(); using var store = Store(remote); await Save(store);
        var id = new CloudMediaNames("els/test").Manifest(CloudMediaKind.DictionaryAudio, Key);
        var item = remote.Items[id];
        remote.Items[id] = item with { Bytes = item.Bytes.Take(bodyLength).Concat(new byte[Math.Max(0, bodyLength - item.Bytes.Length)]).ToArray() };
        remote.OmitManifestLength = true;
        using var restarted = Store(remote);
        var error = await Assert.ThrowsAsync<CloudMediaException>(() => restarted.FindAsync(CloudMediaKind.DictionaryAudio, Key, default));
        Assert.Equal(code, error.Code);
    }

    [Fact]
    public async Task Writes_verified_binary_before_manifest_and_reuses_it_after_service_recreation()
    {
        var remote = new MemoryCloudTransport();
        using var first = Store(remote); var saved = await Save(first);
        Assert.Equal(1, remote.BinaryCreates); Assert.Equal(1, remote.ManifestCreates); Assert.Equal(2, remote.Items.Count);
        using var restarted = Store(remote); var found = await restarted.FindAsync(CloudMediaKind.DictionaryAudio, Key, default);
        Assert.Equal(saved, found); Assert.Equal("wikimedia", found!.Attribution!.Provider);
        var uploads = remote.UploadCalls; Assert.Equal(saved, await Save(restarted)); Assert.Equal(uploads, remote.UploadCalls);
        var manifest = remote.Items.Values.Single(item => item.Asset.ResourceType == "raw");
        var json = Encoding.UTF8.GetString(manifest.Bytes);
        Assert.DoesNotContain("base64", json); Assert.DoesNotContain("res.cloudinary.com", json); Assert.DoesNotContain("signature", json);
    }

    [Fact]
    public async Task Course_cover_and_course_audio_keep_separate_types_and_manifests()
    {
        var remote = new MemoryCloudTransport(); using var store = Store(remote);
        var png = CloudinaryEnvironmentSmoke.Fixtures().Single(item => item.ResourceType == "image").Bytes;
        var image = await store.StoreAsync(CloudMediaKind.CourseCover, Cover, png, "png", null, default);
        var audio = await store.StoreAsync(CloudMediaKind.CourseAudio, new string('b', 32), Wave, "wav", null, default);
        Assert.Equal("image", image.Asset.ResourceType); Assert.Equal("video", audio.Asset.ResourceType);
        using var reopened = Store(remote);
        Assert.Equal(image, await reopened.FindAsync(CloudMediaKind.CourseCover, Cover, default));
        await using var read = await reopened.OpenAsync(CloudMediaKind.CourseCover, Cover, null, default);
        using var body = new MemoryStream(); await read.Body.CopyToAsync(body); Assert.Equal(png, body.ToArray());
    }

    [Fact]
    public async Task Shared_audio_is_one_binary_with_two_independent_attribution_manifests()
    {
        var remote = new MemoryCloudTransport(); using var store = Store(remote);
        var first = await Save(store); var second = await Save(store, OtherKey);
        Assert.Equal(first.Asset, second.Asset); Assert.Equal(1, remote.BinaryCreates); Assert.Equal(2, remote.ManifestCreates);
    }

    [Fact]
    public async Task Concurrent_stores_of_one_reference_converge_and_never_overwrite()
    {
        var remote = new MemoryCloudTransport(); using var a = Store(remote); using var b = Store(remote);
        var results = await Task.WhenAll(Enumerable.Range(0, 16).Select(index => Save(index % 2 == 0 ? a : b)));
        Assert.All(results, result => Assert.Equal(results[0], result));
        Assert.Equal(1, remote.BinaryCreates); Assert.Equal(1, remote.ManifestCreates);
        var changed = Wave; changed[^1] = 12;
        Assert.Equal(409, (await Assert.ThrowsAsync<CloudMediaException>(() => Save(a, bytes: changed))).Status);
    }

    [Fact]
    public async Task Missing_manifest_is_not_ready_and_retry_recovers_the_existing_orphan_binary()
    {
        var remote = new MemoryCloudTransport { FailManifest = true }; using var store = Store(remote);
        var error = await Assert.ThrowsAsync<CloudMediaException>(() => Save(store));
        Assert.Contains(error.OrphanCandidates, id => id.Contains("/dictionary/audio/")); Assert.Single(remote.Items);
        using var restarted = Store(remote);
        Assert.Null(await restarted.FindAsync(CloudMediaKind.DictionaryAudio, Key, default));
        remote.FailManifest = false; var saved = await Save(restarted);
        Assert.NotNull(saved); Assert.Equal(1, remote.BinaryCreates); Assert.Equal(1, remote.ManifestCreates);
    }

    [Fact]
    public async Task Lost_manifest_acknowledgement_is_reconciled_by_reading_it_on_retry()
    {
        var remote = new MemoryCloudTransport { LoseManifestReply = true }; using var store = Store(remote);
        var failed = await Assert.ThrowsAsync<CloudMediaException>(() => Save(store));
        Assert.Equal(2, failed.OrphanCandidates.Count); Assert.Equal(2, remote.Items.Count);
        remote.LoseManifestReply = false; var retry = await Save(store);
        Assert.NotNull(retry); Assert.Equal(1, remote.BinaryCreates); Assert.Equal(1, remote.ManifestCreates);
    }

    [Fact]
    public async Task Failed_second_reference_does_not_offer_shared_binary_for_deletion()
    {
        var remote = new MemoryCloudTransport(); using var store = Store(remote); var first = await Save(store);
        remote.FailManifest = true;
        var failed = await Assert.ThrowsAsync<CloudMediaException>(() => Save(store, OtherKey));
        Assert.DoesNotContain(first.Asset.PublicId, failed.OrphanCandidates);
        Assert.Equal(first, await store.FindAsync(CloudMediaKind.DictionaryAudio, Key, default));
    }

    [Fact]
    public async Task Provider_collision_with_different_bytes_is_rejected_before_publishing_manifest()
    {
        var remote = new MemoryCloudTransport(); using var store = Store(remote);
        var id = new CloudMediaNames("els/test").Binary(CloudMediaKind.DictionaryAudio, Key, CloudMediaNames.Digest(Wave));
        var changed = Wave; changed[^1] = 77;
        remote.Items[id] = new(new("foreign", id, "video", "authenticated", "wav", "1", changed.Length), changed);
        Assert.Equal("media_asset_content_conflict", (await Assert.ThrowsAsync<CloudMediaException>(() => Save(store))).Code);
        Assert.Equal(0, remote.ManifestCreates); Assert.Single(remote.Items);
    }

    [Theory]
    [InlineData("../../other")]
    [InlineData("https://example.com/file")]
    [InlineData("not-a-hash")]
    public async Task Invalid_references_never_contact_the_provider(string reference)
    {
        var remote = new MemoryCloudTransport(); using var store = Store(remote);
        await Assert.ThrowsAsync<CloudMediaException>(() => Save(store, reference));
        Assert.Equal(0, remote.Stats); Assert.Equal(0, remote.UploadCalls);
    }

    [Fact]
    public async Task Oversized_or_wrong_type_bytes_are_rejected_without_upload()
    {
        var remote = new MemoryCloudTransport(); using var store = Store(remote);
        await Assert.ThrowsAsync<CloudMediaException>(() => Save(store, bytes: new byte[5 * 1024 * 1024 + 1]));
        await Assert.ThrowsAsync<CloudMediaException>(() => Save(store, bytes: Encoding.UTF8.GetBytes("<html>not an audio file</html>")));
        await Assert.ThrowsAsync<CloudMediaException>(() => store.StoreAsync(CloudMediaKind.CourseCover, Cover, Wave, "wav", null, default));
        Assert.Equal(0, remote.UploadCalls);
    }

    [Fact]
    public async Task Cache_does_not_hide_deleted_binary_and_missing_cloud_files_are_not_ready()
    {
        var remote = new MemoryCloudTransport(); using var store = Store(remote); var saved = await Save(store);
        remote.Items.TryRemove(saved.Asset.PublicId, out _);
        await Assert.ThrowsAsync<CloudMediaException>(() => store.OpenAsync(CloudMediaKind.DictionaryAudio, Key, null, default));
        using var recreated = Store(remote);
        Assert.Null(await recreated.FindAsync(CloudMediaKind.DictionaryAudio, Key, default));
    }

    [Fact]
    public async Task Manifest_cannot_reference_assets_outside_the_namespace()
    {
        var remote = new MemoryCloudTransport(); using var store = Store(remote); var saved = await Save(store);
        var names = new CloudMediaNames("els/test"); var id = names.Manifest(CloudMediaKind.DictionaryAudio, Key);
        var forged = saved with { Asset = saved.Asset with { PublicId = "els/prod/courses/covers/" + Cover } };
        var bytes = JsonSerializer.SerializeToUtf8Bytes(forged, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        remote.Items[id] = remote.Items[id] with { Bytes = bytes, Asset = remote.Items[id].Asset with { Bytes = bytes.Length } };
        using var restarted = Store(remote);
        await Assert.ThrowsAsync<CloudMediaException>(() => restarted.FindAsync(CloudMediaKind.DictionaryAudio, Key, default));
    }

    [Theory]
    [InlineData("bytes=0-31", 206, 32, "bytes 0-31/1644")]
    [InlineData("bytes=-16", 206, 16, "bytes 1628-1643/1644")]
    [InlineData("bytes=1630-", 206, 14, "bytes 1630-1643/1644")]
    [InlineData("bytes=99999-", 416, 0, "bytes */1644")]
    public async Task Range_responses_have_exact_bytes_and_unsatisfiable_does_not_call_cloud(string range, int status, int length, string header)
    {
        var remote = new MemoryCloudTransport(); using var store = Store(remote); await Save(store); var before = remote.Reads;
        await using var read = await store.OpenAsync(CloudMediaKind.DictionaryAudio, Key, range, default);
        Assert.Equal(status, read.Status); Assert.Equal(length, read.Length); Assert.Equal(header, read.ContentRange);
        using var output = new MemoryStream(); await read.Body.CopyToAsync(output); Assert.Equal(length, output.Length);
        if (status == 416) Assert.Equal(before, remote.Reads);
        else Assert.Equal(Wave[(range == "bytes=0-31" ? 0 : Wave.Length - length)..(range == "bytes=0-31" ? 32 : Wave.Length)], output.ToArray());
    }

    [Fact]
    public async Task Ignored_valid_range_serves_a_real_verified_slice_and_wrong_partial_headers_fail()
    {
        var remote = new MemoryCloudTransport(); using var store = Store(remote); await Save(store);
        remote.IgnoreRanges = true;
        await using (var read = await store.OpenAsync(CloudMediaKind.DictionaryAudio, Key, "bytes=10-19", default))
        {
            using var body = new MemoryStream(); await read.Body.CopyToAsync(body);
            Assert.Equal(206, read.Status); Assert.Equal(Wave[10..20], body.ToArray());
        }
        remote.IgnoreRanges = false; remote.WrongRange = true;
        Assert.Equal("media_storage_invalid_range", (await Assert.ThrowsAsync<CloudMediaException>(() => store.OpenAsync(CloudMediaKind.DictionaryAudio, Key, "bytes=10-19", default))).Code);
    }

    [Fact]
    public async Task Truncated_verification_and_provider_quota_do_not_publish_manifests()
    {
        var remote = new MemoryCloudTransport { Truncate = true }; using var store = Store(remote);
        await Assert.ThrowsAsync<CloudMediaException>(() => Save(store)); Assert.Equal(0, remote.ManifestCreates);
        var rejected = new MemoryCloudTransport { Reject = _ => CloudMediaErrors.Response(403, "Storage limit exceeded") };
        using var limited = Store(rejected);
        var error = await Assert.ThrowsAsync<CloudMediaException>(() => Save(limited));
        Assert.Equal("media_storage_quota_exceeded", error.Code); Assert.Empty(error.OrphanCandidates); Assert.Empty(rejected.Items);
    }

    [Fact]
    public async Task Already_cancelled_store_does_not_upload_or_return_ready()
    {
        var remote = new MemoryCloudTransport(); using var store = Store(remote); using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => store.StoreAsync(CloudMediaKind.DictionaryAudio, Key, Wave, "wav", Credit, cancelled.Token));
        Assert.Equal(0, remote.UploadCalls);
    }

    [Fact]
    public async Task Wrong_mime_or_changed_binary_never_becomes_ready()
    {
        var remote = new MemoryCloudTransport { WrongMime = true }; using var store = Store(remote);
        await Assert.ThrowsAsync<CloudMediaException>(() => Save(store)); Assert.Equal(0, remote.ManifestCreates);
        remote.WrongMime = false; remote.CorruptBinary = true;
        await Assert.ThrowsAsync<CloudMediaException>(() => Save(store)); Assert.Equal(0, remote.ManifestCreates);
    }

    [Theory]
    [InlineData(401, "invalid secret 123456", "media_storage_credentials_or_permission", false)]
    [InlineData(403, "Storage limit exceeded", "media_storage_quota_exceeded", false)]
    [InlineData(420, "Concurrent limit", "media_storage_rate_limited", true)]
    [InlineData(420, "Rate Limit Exceeded", "media_storage_rate_limited", true)]
    [InlineData(429, "busy", "media_storage_rate_limited", true)]
    [InlineData(503, "unavailable", "media_storage_unavailable", true)]
    public void Provider_errors_are_sanitized_and_quota_is_not_retried_blindly(int status, string message, string code, bool retryable)
    {
        var error = CloudMediaErrors.Response(status, message);
        Assert.Equal(code, error.Code); Assert.Equal(retryable, error.Retryable); Assert.DoesNotContain("123456", error.Message);
    }
}
