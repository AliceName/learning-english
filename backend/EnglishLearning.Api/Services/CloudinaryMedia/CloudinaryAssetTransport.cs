using System.Net;
using System.Net.Http.Headers;
using System.Text.RegularExpressions;
using System.Text.Json;
using CloudinaryDotNet;
using CloudinaryDotNet.Actions;
using EnglishLearning.Api.Configuration;
using Microsoft.Extensions.Options;
using Newtonsoft.Json.Linq;

namespace EnglishLearning.Api.Services.CloudinaryMedia;

public sealed class CloudinaryAssetTransport(Cloudinary sdk, IHttpClientFactory clients, IOptions<CloudinarySettings> options) : ICloudinaryAssetTransport
{
    private readonly CloudMediaNames names = new(options.Value.EnvironmentPrefix);

    public async Task<CloudUpload> UploadIfAbsentAsync(string publicId, string resourceType, string format, ReadOnlyMemory<byte> bytes, CancellationToken token)
    {
        names.EnsureOwned(publicId, resourceType);
        if (resourceType == "raw")
        {
            if (format != "json" || bytes.Length is <= 0 or > 65536) throw new CloudMediaException(400, "invalid_manifest_upload");
            try
            {
                using var json = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 16 });
                if (json.RootElement.ValueKind != JsonValueKind.Object) throw new JsonException();
            }
            catch (JsonException) { throw new CloudMediaException(400, "invalid_manifest_upload"); }
        }
        else _ = CloudMediaValidation.ValidateBytes(resourceType == "image" ? CloudMediaKind.CourseCover :
            publicId[(names.Prefix.Length + 1)..].StartsWith("dictionary/", StringComparison.Ordinal) ? CloudMediaKind.DictionaryAudio : CloudMediaKind.CourseAudio, format, bytes.Span);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromSeconds(options.Value.UploadTimeoutSeconds));
        try
        {
            await using var stream = new MemoryStream(bytes.ToArray(), false);
            var file = new FileDescription("asset." + format, stream);
            RawUploadResult result = resourceType switch
            {
                "image" => await sdk.UploadAsync(new ImageUploadParams { File = file, PublicId = publicId, Type = "authenticated", Overwrite = false, UniqueFilename = false }, deadline.Token),
                "video" => await sdk.UploadAsync(new VideoUploadParams { File = file, PublicId = publicId, Type = "authenticated", Overwrite = false, UniqueFilename = false }, deadline.Token),
                "raw" => await sdk.UploadAsync(new RawUploadParams { File = file, PublicId = publicId, Type = "authenticated", Overwrite = false, UniqueFilename = false }, "raw", deadline.Token),
                _ => throw new CloudMediaException(400, "invalid_media_resource_type")
            };
            var existing = result.JsonObj?["existing"]?.Value<bool>() == true;
            if ((int)result.StatusCode == 409 || existing)
            {
                var found = await StatAsync(publicId, resourceType, deadline.Token)
                    ?? throw new CloudMediaException(409, "media_upload_conflict_unresolved", true);
                return new(found, false);
            }
            if (result.Error is not null || (int)result.StatusCode is < 200 or >= 300)
                throw CloudMediaErrors.Response((int)result.StatusCode, result.Error?.Message);
            var asset = new CloudAsset(result.AssetId, result.PublicId, result.ResourceType, result.Type,
                resourceType == "raw" ? format : result.Format, result.Version, result.Bytes);
            Validate(asset);
            if (asset.PublicId != publicId || asset.ResourceType != resourceType) throw InvalidResponse();
            return new(asset, true);
        }
        catch (Exception error) { throw CloudMediaErrors.Failure(error, token); }
    }

    public async Task<CloudAsset?> StatAsync(string publicId, string resourceType, CancellationToken token)
    {
        names.EnsureOwned(publicId, resourceType);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromSeconds(options.Value.ReadTimeoutSeconds));
        try
        {
            var result = await sdk.GetResourceAsync(new GetResourceParams(publicId) { ResourceType = Resource(resourceType), Type = "authenticated" }, deadline.Token);
            if (result.StatusCode == HttpStatusCode.NotFound) return null;
            if (result.Error is not null || (int)result.StatusCode is < 200 or >= 300)
                throw CloudMediaErrors.Response((int)result.StatusCode, result.Error?.Message);
            var asset = new CloudAsset(result.AssetId, result.PublicId, result.ResourceType.ToString().ToLowerInvariant(), result.Type,
                resourceType == "raw" ? "json" : result.Format, result.Version.ToString(System.Globalization.CultureInfo.InvariantCulture), result.Bytes);
            Validate(asset);
            if (asset.PublicId != publicId || asset.ResourceType != resourceType) throw InvalidResponse();
            return asset;
        }
        catch (Exception error) { throw CloudMediaErrors.Failure(error, token); }
    }

    public async Task<CloudRemoteRead> OpenAsync(CloudAsset asset, RangeHeaderValue? range, CancellationToken token) =>
        (await SendAsync(asset, range, false, false, false, token))!;

    public async Task<CloudRemoteRead?> OpenManifestAsync(string publicId, CancellationToken token)
    {
        var response = await SendAsync(new("manifest-lookup", publicId, "raw", "authenticated", "json", "1", 65536), null, false, true, true, token);
        if (response is not null) return response;
        // Disambiguate a cached CDN 404 after another instance has just published the manifest.
        var current = await StatAsync(publicId, "raw", token);
        return current is null ? null : await OpenAsync(current, null, token);
    }

    public async Task<bool> ProbeAsync(CloudAsset asset, CancellationToken token)
    {
        await using var response = await SendAsync(asset, null, true, false, true, token);
        if (response is null) return false;
        var mime = asset.Format switch { "jpg" or "jpeg" => "image/jpeg", "png" => "image/png", "webp" => "image/webp", "ogg" => "audio/ogg", "mp3" => "audio/mpeg", "wav" => "audio/wav", "aac" => "audio/aac", "m4a" => "audio/mp4", _ => "" };
        if (response.Status != HttpStatusCode.OK || response.Length != asset.Bytes || !CloudMediaValidation.MatchesMime(mime, response.ContentType))
            throw InvalidResponse();
        return true;
    }

    private async Task<CloudRemoteRead?> SendAsync(CloudAsset asset, RangeHeaderValue? range, bool head, bool manifest, bool missingIsNull, CancellationToken token)
    {
        Validate(asset);
        var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromSeconds(options.Value.ReadTimeoutSeconds));
        HttpResponseMessage? response = null;
        HttpClient? delivery = null;
        try
        {
            var url = sdk.Api.UrlImgUp.ResourceType(asset.ResourceType).Type("authenticated").Secure(true).Signed(true).Version(asset.Version);
            if (asset.ResourceType != "raw") url = url.Format(asset.Format);
            var uri = new Uri(url.BuildUrl(asset.PublicId));
            if (uri.Scheme != "https" || uri.Host != "res.cloudinary.com" || !uri.IsDefaultPort || !string.IsNullOrEmpty(uri.UserInfo)) throw InvalidResponse();
            using var request = new HttpRequestMessage(head ? System.Net.Http.HttpMethod.Head : System.Net.Http.HttpMethod.Get, uri);
            request.Headers.Range = range;
            if (manifest) request.Headers.CacheControl = new CacheControlHeaderValue { NoCache = true };
            delivery = clients.CreateClient("CloudinaryDelivery");
            response = await delivery.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            if (missingIsNull && response.StatusCode == HttpStatusCode.NotFound)
            { response.Dispose(); delivery.Dispose(); deadline.Dispose(); return null; }
            if (response.StatusCode is not (HttpStatusCode.OK or HttpStatusCode.PartialContent or HttpStatusCode.RequestedRangeNotSatisfiable))
                throw CloudMediaErrors.Response((int)response.StatusCode);
            var stream = await response.Content.ReadAsStreamAsync(deadline.Token);
            var owned = new OwnedReadStream(stream, response, delivery, deadline, token);
            return new(response.StatusCode, response.Content.Headers.ContentType?.MediaType?.ToLowerInvariant(),
                response.Content.Headers.ContentLength, response.Content.Headers.ContentRange, owned);
        }
        catch (Exception error)
        {
            response?.Dispose(); delivery?.Dispose(); deadline.Dispose();
            throw CloudMediaErrors.Failure(error, token);
        }
    }

    private void Validate(CloudAsset asset)
    {
        names.EnsureOwned(asset.PublicId, asset.ResourceType);
        if (asset.DeliveryType != "authenticated" || string.IsNullOrWhiteSpace(asset.AssetId) || asset.AssetId.Length > 200 ||
            !Regex.IsMatch(asset.Version ?? "", @"\A[0-9]{1,20}\z") || asset.Bytes is <= 0 or > 26214400 ||
            !Regex.IsMatch(asset.Format ?? "", asset.ResourceType switch { "image" => @"\A(jpg|jpeg|png|webp)\z", "video" => @"\A(ogg|mp3|wav|aac|m4a)\z", _ => @"\Ajson\z" })) throw InvalidResponse();
    }
    private static ResourceType Resource(string type) => type switch { "image" => ResourceType.Image, "video" => ResourceType.Video, "raw" => ResourceType.Raw, _ => throw InvalidResponse() };
    private static CloudMediaException InvalidResponse() => new(502, "media_storage_invalid_response");

    private sealed class OwnedReadStream(Stream inner, HttpResponseMessage response, HttpClient client, CancellationTokenSource deadline, CancellationToken caller) : Stream
    {
        public override bool CanRead => inner.CanRead;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken token = default)
        {
            using var combined = CancellationTokenSource.CreateLinkedTokenSource(deadline.Token, token);
            try { return await inner.ReadAsync(buffer, combined.Token); }
            catch (Exception error) { throw CloudMediaErrors.Failure(error, caller.IsCancellationRequested ? caller : token); }
        }
        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken token) => ReadAsync(buffer.AsMemory(offset, count), token).AsTask();
        public override int Read(byte[] buffer, int offset, int count) => ReadAsync(buffer.AsMemory(offset, count)).AsTask().GetAwaiter().GetResult();
        public override void Flush() => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        protected override void Dispose(bool disposing) { if (disposing) { inner.Dispose(); response.Dispose(); client.Dispose(); deadline.Dispose(); } base.Dispose(disposing); }
        public override async ValueTask DisposeAsync() { await inner.DisposeAsync(); response.Dispose(); client.Dispose(); deadline.Dispose(); GC.SuppressFinalize(this); }
    }
}
