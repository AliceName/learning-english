using System.Net;
using System.Net.Http.Headers;
using System.Text;
using CloudinaryDotNet.Actions;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Contracts;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Services.CloudinaryMedia;

public static class CloudinaryAdapterSmoke
{
    public static async Task<CloudinarySmokeReport> RunAsync(CloudinarySettings configured, string contentRoot, bool dictionaryAudio = false, bool courseMedia = false)
    {
        var checks = new List<CloudinarySmokeCheck>(); var pending = new List<string>();
        var issues = new List<CloudinarySmokeCleanupIssue>();
        var prefix = configured.EnvironmentPrefix + "/smoke/" + Guid.NewGuid().ToString("N");
        try { CloudinaryEnvironmentSmoke.EnsureSmokePrefix(configured, prefix); }
        catch (Exception) { return new("not_configured", DateTime.UtcNow, null, checks, pending, "cloudinary_configuration_required"); }
        var settings = new CloudinarySettings { Enabled = true, CloudName = configured.CloudName, ApiKey = configured.ApiKey,
            ApiSecret = configured.ApiSecret, EnvironmentPrefix = prefix, UploadTimeoutSeconds = configured.UploadTimeoutSeconds, ReadTimeoutSeconds = configured.ReadTimeoutSeconds };
        var sdk = CloudinaryClientFactory.Create(settings);
        var names = new CloudMediaNames(prefix);
        var tracked = new TrackingTransport(new CloudinaryAssetTransport(sdk, new DeliveryFactory(), Options.Create(settings)));
        using var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(4));
        var mediaOptions = Options.Create(new CloudinaryMediaOptions());
        CloudinaryMediaStore NewStore() => new(tracked, Options.Create(settings), mediaOptions, TimeProvider.System);
        string? failure = null;
        var stage = "prepare_fixtures";
        var before = Snapshot(contentRoot);
        try
        {
            var fixtures = CloudinaryEnvironmentSmoke.Fixtures();
            var ogg = fixtures.Single(file => file.ResourceType == "video").Bytes;
            var png = fixtures.Single(file => file.ResourceType == "image").Bytes;
            var key = CloudMediaNames.Digest("adapter-smoke-source-a"u8);
            var other = CloudMediaNames.Digest("adapter-smoke-source-b"u8);
            var credit = new AudioAttribution("wikimedia", "https://commons.wikimedia.org/wiki/File:En-us-match.ogg",
                "https://upload.wikimedia.org/wikipedia/commons/a/ad/En-us-match.ogg", "Dvortygirl", "CC BY-SA 3.0", "https://creativecommons.org/licenses/by-sa/3.0/", "en-US");
            using var first = NewStore();
            stage = "dictionary_audio_commit";
            var saved = await first.StoreAsync(CloudMediaKind.DictionaryAudio, key, ogg, "ogg", credit, deadline.Token);
            Record(checks, "binary_and_manifest_commit", saved.Asset.DeliveryType == "authenticated" && saved.Attribution == credit);
            var uploads = tracked.Uploads;
            Record(checks, "same_reference_reused_without_upload", await first.StoreAsync(CloudMediaKind.DictionaryAudio, key, ogg, "ogg", credit, deadline.Token) == saved && uploads == tracked.Uploads);
            using (var restarted = NewStore())
            {
                stage = "dictionary_audio_reopen_and_ranges";
                Record(checks, "manifest_read_after_store_recreation", await restarted.FindAsync(CloudMediaKind.DictionaryAudio, key, deadline.Token) == saved);
                await using var partial = await restarted.OpenAsync(CloudMediaKind.DictionaryAudio, key, "bytes=0-31", deadline.Token);
                using var body = new MemoryStream(); await partial.Body.CopyToAsync(body, deadline.Token);
                Record(checks, "adapter_range_206", partial.Status == 206 && body.ToArray().AsSpan().SequenceEqual(ogg.AsSpan(0, 32)) && partial.ContentRange == $"bytes 0-31/{ogg.Length}");
                var reads = tracked.Reads;
                await using var invalid = await restarted.OpenAsync(CloudMediaKind.DictionaryAudio, key, "bytes=999999-", deadline.Token);
                Record(checks, "adapter_range_416_without_cloud_request", invalid.Status == 416 && invalid.ContentRange == $"bytes */{ogg.Length}" && tracked.Reads == reads);
            }
            stage = "dictionary_audio_shared_binary";
            var shared = await first.StoreAsync(CloudMediaKind.DictionaryAudio, other, ogg, "ogg", credit, deadline.Token);
            Record(checks, "provider_existing_asset_conflict_is_verified", shared.Asset == saved.Asset && tracked.BinaryCreates == 1);

            var coverKey = Guid.NewGuid().ToString("N");
            stage = "course_cover_orphan_recovery";
            await tracked.UploadIfAbsentAsync(names.Binary(CloudMediaKind.CourseCover, coverKey, CloudMediaNames.Digest(png)), "image", "png", png, deadline.Token);
            CloudMediaManifest image;
            using (var recovered = NewStore())
            {
                Record(checks, "missing_manifest_is_cache_miss", await recovered.FindAsync(CloudMediaKind.CourseCover, coverKey, deadline.Token) is null);
                var binaryCreates = tracked.BinaryCreates;
                image = await recovered.StoreAsync(CloudMediaKind.CourseCover, coverKey, png, "png", null, deadline.Token);
                Record(checks, "orphan_binary_reused_when_manifest_is_published", tracked.BinaryCreates == binaryCreates);
            }
            using (var reopened = NewStore())
            {
                stage = "course_cover_read";
                await using var imageRead = await reopened.OpenAsync(CloudMediaKind.CourseCover, coverKey, null, deadline.Token);
                using var body = new MemoryStream(); await imageRead.Body.CopyToAsync(body, deadline.Token);
                Record(checks, "course_cover_manifest_and_read", image.Asset.ResourceType == "image" && body.ToArray().AsSpan().SequenceEqual(png));
            }
            stage = "course_audio_commit";
            var audio = await first.StoreAsync(CloudMediaKind.CourseAudio, Guid.NewGuid().ToString("N"), ogg, "ogg", null, deadline.Token);
            Record(checks, "course_audio_correct_resource_type", audio.Asset.ResourceType == "video" && audio.ContentType == "audio/ogg");
            stage = "changed_reference_rejected";
            var changed = png.ToArray(); changed[^1] ^= 1;
            var rejected = false; uploads = tracked.Uploads;
            try { await first.StoreAsync(CloudMediaKind.CourseCover, coverKey, changed, "png", null, deadline.Token); }
            catch (CloudMediaException error) when (error.Status == 409) { rejected = true; }
            Record(checks, "changed_reference_is_rejected_without_overwrite", rejected && tracked.Uploads == uploads);
            if (dictionaryAudio)
            {
                stage = "dictionary_audio_pipeline";
                await DictionaryAudioCloudSmoke.VerifyAsync(NewStore, settings, contentRoot, checks, deadline.Token);
            }
            if (courseMedia)
            {
                stage = "course_media_pipeline";
                await CourseMediaCloudSmoke.VerifyAsync(NewStore, tracked, settings, contentRoot, checks, deadline.Token);
            }
            stage = "local_runtime_media_unchanged";
            Record(checks, "local_runtime_media_unchanged", before == Snapshot(contentRoot));
        }
        catch (Exception error) { failure = error is CloudMediaException known ? known.Code : error is OperationCanceledException ? "adapter_smoke_timeout" : "adapter_smoke_failed"; }
        finally
        {
            using var cleanup = new CloudinarySmokeClient(configured, prefix);
            using var cleanupDeadline = new CancellationTokenSource(TimeSpan.FromSeconds(90));
            foreach (var (id, type) in tracked.Attempted.Reverse())
            {
                try
                {
                    names.EnsureOwned(id, type);
                    var removed = await CloudinarySmokeRecovery.DeleteWithRetryAsync(cleanup, new(id, type, "", ""), cleanupDeadline.Token);
                    if (!removed)
                    {
                        pending.Add(id); issues.Add(new(id, "adapter_smoke_cleanup_unconfirmed", null));
                    }
                }
                catch (Exception error)
                {
                    var safe = CloudinarySmokeFailure.FromException(error);
                    pending.Add(id); issues.Add(new(id, safe.Code, safe.HttpStatus));
                }
            }
            sdk.Api.Client.Dispose();
        }
        checks.Add(new("cleanup_adapter_smoke_assets", pending.Count == 0));
        return new(failure is null && pending.Count == 0 ? "passed" : "failed", DateTime.UtcNow, prefix, checks, pending,
            failure ?? (pending.Count > 0 ? "adapter_smoke_cleanup_failed" : null), CleanupIssues: issues)
        { AdapterFailure = failure is null ? null : new(stage, tracked.LastDelivery) };
    }

    private static void Record(List<CloudinarySmokeCheck> checks, string name, bool passed)
    { checks.Add(new(name, passed)); if (!passed) throw new CloudMediaException(502, "adapter_smoke_assertion_failed"); }
    private static string Snapshot(string root) => string.Join("|", new[] { "dictionary-audio", "uploads" }
        .Select(folder => Path.Combine(root, "App_Data", folder)).Where(Directory.Exists)
        .SelectMany(path => Directory.EnumerateFiles(path, "*", SearchOption.AllDirectories))
        .OrderBy(path => path, StringComparer.Ordinal).Select(path => { var file = new FileInfo(path); return path + ":" + file.Length + ":" + file.LastWriteTimeUtc.Ticks; }));

    private sealed class DeliveryFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(new HttpClientHandler
        { AllowAutoRedirect = false, UseCookies = false, AutomaticDecompression = DecompressionMethods.None }) { Timeout = Timeout.InfiniteTimeSpan };
    }
    private sealed class TrackingTransport(ICloudinaryAssetTransport inner) : ICloudinaryAssetTransport
    {
        public Dictionary<string, string> Attempted = new(StringComparer.Ordinal);
        public int Uploads, BinaryCreates, Reads;
        public CloudinarySmokeDeliveryObservation? LastDelivery;
        public async Task<CloudUpload> UploadIfAbsentAsync(string id, string type, string format, ReadOnlyMemory<byte> bytes, CancellationToken token)
        {
            Attempted[id] = type; Uploads++;
            var result = await inner.UploadIfAbsentAsync(id, type, format, bytes, token);
            if (result.Created && type != "raw") BinaryCreates++;
            return result;
        }
        public Task<CloudAsset?> StatAsync(string id, string type, CancellationToken token) => inner.StatAsync(id, type, token);
        public async Task<CloudRemoteRead?> OpenManifestAsync(string id, CancellationToken token)
        {
            Reads++; LastDelivery = new("find_manifest", "raw", "json", null, null, null);
            var response = await inner.OpenManifestAsync(id, token);
            LastDelivery = LastDelivery with { HttpStatus = response is null ? 404 : (int)response.Status, ContentLength = response?.Length };
            return response;
        }
        public async Task<bool> ProbeAsync(CloudAsset asset, CancellationToken token)
        {
            Reads++; LastDelivery = new("probe_binary", asset.ResourceType, asset.Format, null, asset.Bytes, null);
            return await inner.ProbeAsync(asset, token);
        }
        public async Task<CloudRemoteRead> OpenAsync(CloudAsset asset, RangeHeaderValue? range, CancellationToken token)
        {
            Reads++; LastDelivery = new(range is null ? "read_full" : "read_range", asset.ResourceType, asset.Format, null, asset.Bytes, null);
            var response = await inner.OpenAsync(asset, range, token);
            LastDelivery = LastDelivery with { HttpStatus = (int)response.Status, ContentLength = response.Length };
            return response;
        }
    }
}
