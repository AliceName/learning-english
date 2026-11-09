using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Contracts;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearning.Api.Services.CloudinaryMedia;

public sealed class CloudinaryMediaStore : ICloudMediaStore, IDisposable
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { MaxDepth = 16 };
    private readonly ICloudinaryAssetTransport remote;
    private readonly CloudMediaNames names;
    private readonly CloudinaryMediaOptions options;
    private readonly TimeProvider clock;
    private readonly MemoryCache cache;
    private readonly SemaphoreSlim[] stripes = Enumerable.Range(0, 64).Select(_ => new SemaphoreSlim(1)).ToArray();
    private readonly SemaphoreSlim operations;
    private readonly ILogger<CloudinaryMediaStore> logger;

    public CloudinaryMediaStore(ICloudinaryAssetTransport remote, IOptions<CloudinarySettings> settings, IOptions<CloudinaryMediaOptions> options, TimeProvider clock,
        ILogger<CloudinaryMediaStore>? logger = null)
    {
        this.remote = remote; names = new(settings.Value.EnvironmentPrefix); this.options = options.Value; this.clock = clock;
        cache = new(new MemoryCacheOptions { SizeLimit = this.options.MetadataCacheEntries });
        operations = new(this.options.MaxConcurrentOperations);
        this.logger = logger ?? NullLogger<CloudinaryMediaStore>.Instance;
    }

    public async Task<CloudMediaManifest> StoreAsync(CloudMediaKind kind, string reference, ReadOnlyMemory<byte> bytes, string format,
        AudioAttribution? attribution, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        var manifestId = names.Manifest(kind, reference);
        format = format.ToLowerInvariant();
        if (format == "jpeg") format = "jpg";
        var mime = CloudMediaValidation.ValidateBytes(kind, format, bytes.Span);
        ValidateAttribution(kind, attribution);
        var hash = CloudMediaNames.Digest(bytes.Span);
        var binaryId = names.Binary(kind, reference, hash);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromSeconds(options.OperationTimeoutSeconds));
        // Lock by reference, not by content: different content must not race the same manifest.
        var gate = stripes[(int)(Convert.ToUInt32(CloudMediaNames.Digest(System.Text.Encoding.UTF8.GetBytes(manifestId))[..8], 16) % stripes.Length)];
        var locked = false; var entered = false;
        CloudUpload? binary = null, manifestUpload = null;
        var binaryAttempted = false; var manifestAttempted = false;
        try
        {
            await gate.WaitAsync(deadline.Token); locked = true;
            await operations.WaitAsync(deadline.Token); entered = true;
            var existing = await FindAsync(kind, reference, deadline.Token);
            if (existing is not null)
            {
                if (existing.Sha256 != hash || existing.ContentType != mime || existing.Asset.Format != format) throw Conflict();
                return existing;
            }
            binaryAttempted = true;
            binary = await remote.UploadIfAbsentAsync(binaryId, kind == CloudMediaKind.CourseCover ? "image" : "video", format, bytes, deadline.Token);
            ValidateBinary(binary.Asset, kind, reference, hash, mime, bytes.Length, format);
            await VerifyBinaryAsync(binary.Asset, hash, mime, deadline.Token);
            var proposed = new CloudMediaManifest(1, kind, reference, binary.Asset, hash, mime, bytes.Length, clock.GetUtcNow().UtcDateTime, attribution);
            var json = JsonSerializer.SerializeToUtf8Bytes(proposed, Json);
            if (json.Length > options.MaxManifestBytes) throw new CloudMediaException(400, "media_manifest_too_large");
            manifestAttempted = true;
            manifestUpload = await remote.UploadIfAbsentAsync(manifestId, "raw", "json", json, deadline.Token);
            ValidateRaw(manifestUpload.Asset, manifestId);
            var committed = await ReadManifestAsync(manifestUpload.Asset, kind, reference, deadline.Token);
            if (!SameContent(proposed, committed)) throw Conflict();
            Remember(manifestId, committed);
            return committed;
        }
        catch (Exception error)
        {
            cache.Remove(manifestId);
            var cancelled = error is OperationCanceledException && token.IsCancellationRequested;
            var safe = cancelled ? new CloudMediaException(499, "media_store_cancelled", true) : CloudMediaErrors.Failure(error, token);
            var candidates = new List<string>();
            if (binary?.Created == true || binary is null && binaryAttempted && safe.Retryable) candidates.Add(binaryId);
            if (manifestUpload?.Created == true || manifestUpload is null && manifestAttempted && safe.Retryable) candidates.Add(manifestId);
            // Never automatically delete: content-addressed audio can be shared by another successful writer.
            if (candidates.Count > 0) logger.LogWarning("Cloud media reconciliation required ({Code}) for managed IDs: {PublicIds}.", safe.Code, string.Join(",", candidates));
            if (cancelled) throw new OperationCanceledException(token);
            throw new CloudMediaException(safe.Status, safe.Code, safe.Retryable, safe.RetryAfterSeconds, candidates);
        }
        finally { if (entered) operations.Release(); if (locked) gate.Release(); }
    }

    public async Task<CloudMediaManifest?> FindAsync(CloudMediaKind kind, string reference, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        var id = names.Manifest(kind, reference);
        if (cache.TryGetValue(id, out CloudMediaManifest? cached) && cached!.Kind == kind) return cached;
        try
        {
            await using var raw = await remote.OpenManifestAsync(id, token);
            if (raw is null) return null; // No negative cache: a concurrent writer may publish immediately afterwards.
            var manifest = ParseManifest(await ReadBoundedManifestAsync(raw, token), kind, reference);
            if (!await remote.ProbeAsync(manifest.Asset, token)) return null;
            Remember(id, manifest);
            return manifest;
        }
        catch (Exception error) { cache.Remove(id); throw CloudMediaErrors.Failure(error, token); }
    }

    public async Task<CloudMediaRead> OpenAsync(CloudMediaKind kind, string reference, string? range, CancellationToken token)
    {
        var manifest = await FindAsync(kind, reference, token) ?? throw new CloudMediaException(404, "media_asset_missing");
        var selected = SelectRange(range, manifest.SizeBytes);
        if (selected is { From: < 0 }) return new(416, manifest.ContentType, 0, $"bytes */{manifest.SizeBytes}", Stream.Null);
        CloudRemoteRead? response = null;
        try
        {
            response = await remote.OpenAsync(manifest.Asset, selected is null ? null : new RangeHeaderValue(selected.Value.From, selected.Value.To), token);
            if (!CloudMediaValidation.MatchesMime(manifest.ContentType, response.ContentType)) throw new CloudMediaException(502, "media_storage_invalid_content_type");
            if (selected is null)
            {
                if (response.Status != HttpStatusCode.OK || response.Length != manifest.SizeBytes) throw new CloudMediaException(502, "media_storage_invalid_length");
                return new(200, manifest.ContentType, manifest.SizeBytes, null, response.Body);
            }
            var (from, to) = selected.Value;
            var length = to - from + 1;
            if (response.Status == HttpStatusCode.PartialContent && response.ContentRange is { Unit: "bytes" } observed &&
                observed.From == from && observed.To == to && observed.Length == manifest.SizeBytes && response.Length == length)
                return new(206, manifest.ContentType, length, $"bytes {from}-{to}/{manifest.SizeBytes}", response.Body);
            if (response.Status == HttpStatusCode.OK && response.Length == manifest.SizeBytes)
            {
                // Provider ignored a valid Range: verify the full bounded file before serving a real slice.
                var full = await ReadExactAsync(response, checked((int)manifest.SizeBytes), token);
                if (CloudMediaNames.Digest(full) != manifest.Sha256) throw new CloudMediaException(502, "media_storage_hash_mismatch");
                await response.DisposeAsync(); response = null;
                return new(206, manifest.ContentType, length, $"bytes {from}-{to}/{manifest.SizeBytes}", new MemoryStream(full, (int)from, (int)length, false));
            }
            throw new CloudMediaException(502, "media_storage_invalid_range");
        }
        catch (Exception error)
        {
            if (response is not null) await response.DisposeAsync();
            cache.Remove(names.Manifest(kind, reference));
            throw CloudMediaErrors.Failure(error, token);
        }
    }

    private async Task VerifyBinaryAsync(CloudAsset asset, string hash, string mime, CancellationToken token)
    {
        await using var read = await remote.OpenAsync(asset, null, token);
        if (read.Status != HttpStatusCode.OK || read.Length != asset.Bytes || !CloudMediaValidation.MatchesMime(mime, read.ContentType))
            throw new CloudMediaException(502, "media_storage_verification_failed");
        using var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = new byte[81920]; long total = 0; int count;
        while ((count = await read.Body.ReadAsync(buffer, token)) > 0)
        {
            total += count;
            if (total > asset.Bytes) throw new CloudMediaException(502, "media_storage_invalid_length");
            sha.AppendData(buffer, 0, count);
        }
        if (total != asset.Bytes || Convert.ToHexStringLower(sha.GetHashAndReset()) != hash) throw new CloudMediaException(409, "media_asset_content_conflict");
    }

    private async Task<CloudMediaManifest> ReadManifestAsync(CloudAsset raw, CloudMediaKind kind, string reference, CancellationToken token)
    {
        ValidateRaw(raw, names.Manifest(kind, reference));
        await using var response = await remote.OpenAsync(raw, null, token);
        var bytes = await ReadExactAsync(response, checked((int)raw.Bytes), token);
        return ParseManifest(bytes, kind, reference);
    }

    private CloudMediaManifest ParseManifest(byte[] bytes, CloudMediaKind kind, string reference)
    {
        CloudMediaManifest manifest;
        try { manifest = JsonSerializer.Deserialize<CloudMediaManifest>(bytes, Json) ?? throw new JsonException(); }
        catch (Exception error) when (error is JsonException or NotSupportedException) { throw new CloudMediaException(502, "invalid_media_manifest"); }
        if (manifest.SchemaVersion != 1 || manifest.Kind != kind || manifest.ReferenceKey != reference || manifest.Asset is null ||
            manifest.CreatedAtUtc.Kind != DateTimeKind.Utc || !CloudMediaNames.Hash(manifest.Sha256)) throw new CloudMediaException(502, "invalid_media_manifest");
        ValidateBinary(manifest.Asset, kind, reference, manifest.Sha256, manifest.ContentType, manifest.SizeBytes, manifest.Asset.Format);
        ValidateAttribution(kind, manifest.Attribution);
        return manifest;
    }

    private static async Task<byte[]> ReadExactAsync(CloudRemoteRead read, int length, CancellationToken token)
    {
        // HTTP can omit Content-Length. The upload receipt still supplies the exact size:
        // enforce it against the body, including EOF, rather than rejecting a missing header.
        if (read.Status != HttpStatusCode.OK || read.Length is long declared && declared != length)
            throw new CloudMediaException(502, "media_storage_invalid_length");
        var bytes = new byte[length];
        try { await read.Body.ReadExactlyAsync(bytes, token); }
        catch (EndOfStreamException) { throw new CloudMediaException(502, "media_storage_truncated"); }
        if (await read.Body.ReadAsync(new byte[1], token) != 0) throw new CloudMediaException(502, "media_storage_invalid_length");
        return bytes;
    }

    private async Task<byte[]> ReadBoundedManifestAsync(CloudRemoteRead read, CancellationToken token)
    {
        if (read.Status != HttpStatusCode.OK || read.Length is <= 0 || read.Length > options.MaxManifestBytes)
            throw new CloudMediaException(502, "invalid_media_manifest_asset");
        if (read.Length is long declared) return await ReadExactAsync(read, checked((int)declared), token);
        // Cold reads have no upload receipt. Read at most the manifest limit plus one
        // sentinel byte, so a chunked response cannot cause unbounded allocation.
        var buffer = new byte[options.MaxManifestBytes + 1];
        var total = 0;
        while (total < buffer.Length)
        {
            var count = await read.Body.ReadAsync(buffer.AsMemory(total), token);
            if (count == 0) break;
            total += count;
        }
        if (total == 0 || total > options.MaxManifestBytes) throw new CloudMediaException(502, "invalid_media_manifest_asset");
        return buffer[..total];
    }

    private void ValidateRaw(CloudAsset raw, string id)
    {
        if (raw.PublicId != id || raw.ResourceType != "raw" || raw.DeliveryType != "authenticated" || raw.Format != "json" ||
            string.IsNullOrWhiteSpace(raw.AssetId) || !ValidVersion(raw.Version) || raw.Bytes <= 0 || raw.Bytes > options.MaxManifestBytes)
            throw new CloudMediaException(502, "invalid_media_manifest_asset");
    }
    private void ValidateBinary(CloudAsset asset, CloudMediaKind kind, string reference, string hash, string mime, long length, string format)
    {
        var expectedMime = format switch { "jpg" => "image/jpeg", "png" => "image/png", "webp" => "image/webp", "ogg" => "audio/ogg", "mp3" => "audio/mpeg", "wav" => "audio/wav", "aac" => "audio/aac", "m4a" => "audio/mp4", _ => "" };
        if (asset.PublicId != names.Binary(kind, reference, hash) || asset.ResourceType != (kind == CloudMediaKind.CourseCover ? "image" : "video") ||
            asset.DeliveryType != "authenticated" || string.IsNullOrWhiteSpace(asset.AssetId) || !ValidVersion(asset.Version) || asset.Format != format ||
            mime != expectedMime || !mime.StartsWith(kind == CloudMediaKind.CourseCover ? "image/" : "audio/", StringComparison.Ordinal) ||
            length <= 0 || length > (kind == CloudMediaKind.CourseAudio ? 25L : 5L) * 1024 * 1024 || asset.Bytes != length)
            throw new CloudMediaException(409, "media_asset_metadata_conflict");
    }
    private static bool ValidVersion(string version) => !string.IsNullOrEmpty(version) && version.Length <= 20 && version.All(char.IsAsciiDigit);
    private static bool SameContent(CloudMediaManifest left, CloudMediaManifest right) => left.Kind == right.Kind && left.ReferenceKey == right.ReferenceKey &&
        left.Asset == right.Asset && left.Sha256 == right.Sha256 && left.SizeBytes == right.SizeBytes && left.ContentType == right.ContentType;
    private static CloudMediaException Conflict() => new(409, "media_reference_conflict");
    private static void ValidateAttribution(CloudMediaKind kind, AudioAttribution? credit)
    {
        if (kind == CloudMediaKind.DictionaryAudio && credit?.Provider == "minhqnd-tts")
        {
            if (!credit.Synthetic || credit.Locale != "vi" || string.IsNullOrWhiteSpace(credit.VoiceProfile) || credit.VoiceProfile.Length > 100 ||
                !DefinitionAudioService.AllowedSource(credit.FileUrl) || credit.SourceUrl != "https://dict.minhqnd.com/" || credit.FileUrl.Length > 8192)
                throw new CloudMediaException(400, "invalid_media_attribution");
            return;
        }
        if (kind != CloudMediaKind.DictionaryAudio && credit is null) return;
        if (credit is null || credit.Provider is not ("wikimedia" or "dictionaryApi") || credit.FileUrl is null ||
            WikimediaAudioResolver.Https(credit.FileUrl) is not { } url || !WikimediaAudioResolver.AllowedDownload(url) ||
            new[] { credit.Author, credit.LicenseName, credit.LicenseUrl, credit.SourceUrl, credit.FileUrl, credit.Locale }.Any(value => value?.Length > 4000))
            throw new CloudMediaException(400, "invalid_media_attribution");
    }
    private static (long From, long To)? SelectRange(string? text, long length)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        if (!RangeHeaderValue.TryParse(text, out var header) || header.Unit != "bytes" || header.Ranges.Count != 1) throw new CloudMediaException(400, "unsupported_media_range");
        var item = header.Ranges.Single();
        if (item.From is long start) return start >= length ? (-1, -1) : (start, Math.Min(item.To ?? length - 1, length - 1));
        return item.To is > 0 ? (Math.Max(0, length - item.To.Value), length - 1) : (-1, -1);
    }
    private void Remember(string id, CloudMediaManifest manifest) => cache.Set(id, manifest,
        new MemoryCacheEntryOptions { Size = 1, AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(options.MetadataCacheSeconds) });
    public void Dispose() { cache.Dispose(); operations.Dispose(); foreach (var stripe in stripes) stripe.Dispose(); }
}
