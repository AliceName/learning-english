using System.Net.Http.Headers;
using CloudinaryDotNet;
using CloudinaryDotNet.Actions;
using EnglishLearning.Api.Configuration;

namespace EnglishLearning.Api.Services;

public sealed record CloudinarySmokeFile(string Name, string ResourceType, string Format, byte[] Bytes);
public sealed record CloudinarySmokeAsset(string PublicId, string ResourceType, string Format, string Version);

// Test/provisioning transport only; it is not wired into runtime media endpoints.
public interface ICloudinarySmokeClient : IDisposable
{
    Task<CloudinarySmokeAsset> UploadAsync(CloudinarySmokeFile file, string publicId, CancellationToken token);
    Uri DeliveryUrl(CloudinarySmokeAsset asset, bool signed, bool publicDelivery = false);
    Task<HttpResponseMessage> ReadAsync(Uri url, RangeHeaderValue? range, CancellationToken token);
    Task<bool> DeleteAsync(CloudinarySmokeAsset asset, CancellationToken token = default);
}

public sealed class CloudinarySmokeClient : ICloudinarySmokeClient
{
    private readonly Cloudinary sdk;
    private readonly HttpClient http;
    private readonly string runPrefix;

    public CloudinarySmokeClient(CloudinarySettings settings, string runPrefix)
    {
        CloudinaryEnvironmentSmoke.EnsureSmokePrefix(settings, runPrefix);
        sdk = CloudinaryClientFactory.Create(settings);
        this.runPrefix = runPrefix;
        http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, AutomaticDecompression = System.Net.DecompressionMethods.None })
        { Timeout = TimeSpan.FromSeconds(settings.ReadTimeoutSeconds) };
    }

    public async Task<CloudinarySmokeAsset> UploadAsync(CloudinarySmokeFile file, string publicId, CancellationToken token)
    {
        EnsureOwned(publicId, file.ResourceType);
        await using var stream = new MemoryStream(file.Bytes, writable: false);
        var description = new FileDescription(file.Name + "." + file.Format, stream);
        RawUploadResult result = file.ResourceType switch
        {
            "image" => await sdk.UploadAsync(new ImageUploadParams { File = description, PublicId = publicId, Type = "authenticated", Overwrite = false, UniqueFilename = false }, token),
            "video" => await sdk.UploadAsync(new VideoUploadParams { File = description, PublicId = publicId, Type = "authenticated", Overwrite = false, UniqueFilename = false }, token),
            "raw" => await sdk.UploadAsync(new RawUploadParams { File = description, PublicId = publicId, Type = "authenticated", Overwrite = false, UniqueFilename = false }, "raw", token),
            _ => throw new InvalidOperationException("Unsupported smoke resource type.")
        };
        // Do not propagate SDK errors/response bodies: they can contain credentials or signed URLs.
        if (result.Error is not null || (int)result.StatusCode is < 200 or >= 300)
            throw CloudinarySmokeFailure.FromResponse("upload", (int)result.StatusCode, result.Error?.Message);
        if (result.PublicId != publicId ||
            result.ResourceType != file.ResourceType || result.Type != "authenticated" || result.Bytes != file.Bytes.LongLength ||
            string.IsNullOrEmpty(result.AssetId) || string.IsNullOrEmpty(result.Version) ||
            file.ResourceType != "raw" && result.Format != file.Format)
            throw new CloudinarySmokeFailure("cloudinary_upload_metadata_mismatch", (int)result.StatusCode);
        return new(result.PublicId, result.ResourceType, file.Format, result.Version);
    }

    public Uri DeliveryUrl(CloudinarySmokeAsset asset, bool signed, bool publicDelivery = false)
    {
        EnsureOwned(asset.PublicId, asset.ResourceType);
        var url = sdk.Api.UrlImgUp.ResourceType(asset.ResourceType).Type(publicDelivery ? "upload" : "authenticated").Secure(true).Signed(signed);
        if (!string.IsNullOrEmpty(asset.Version)) url = url.Version(asset.Version);
        if (asset.ResourceType != "raw") url = url.Format(asset.Format);
        return new Uri(url.BuildUrl(asset.PublicId));
    }

    public async Task<HttpResponseMessage> ReadAsync(Uri url, RangeHeaderValue? range, CancellationToken token)
    {
        if (url.Scheme != "https" || url.Host != "res.cloudinary.com" || !url.IsDefaultPort || !string.IsNullOrEmpty(url.UserInfo))
            throw new InvalidOperationException("Unexpected Cloudinary delivery host.");
        using var request = new HttpRequestMessage(System.Net.Http.HttpMethod.Get, url);
        request.Headers.Range = range;
        return await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
    }

    public async Task<bool> DeleteAsync(CloudinarySmokeAsset asset, CancellationToken token = default)
    {
        var owned = CloudinarySmokeRecovery.CleanupAsset(runPrefix, asset.PublicId);
        if (owned.ResourceType != asset.ResourceType) throw new InvalidOperationException("Invalid smoke cleanup resource type.");
        var type = asset.ResourceType switch { "image" => ResourceType.Image, "video" => ResourceType.Video, "raw" => ResourceType.Raw, _ => throw new InvalidOperationException() };
        token.ThrowIfCancellationRequested();
        // SDK 1.29.3 has no DestroyAsync cancellation overload. This dedicated
        // smoke client runs deletes sequentially; cancel only its own pending request.
        using var cancellation = token.Register(static state => ((HttpClient)state!).CancelPendingRequests(), sdk.Api.Client);
        var result = await sdk.DestroyAsync(new DeletionParams(asset.PublicId) { ResourceType = type, Type = "authenticated", Invalidate = true });
        if (result.Error is not null || (int)result.StatusCode is < 200 or >= 300)
            throw CloudinarySmokeFailure.FromResponse("cleanup", (int)result.StatusCode, result.Error?.Message);
        return result.Result is "ok" or "not found";
    }

    private void EnsureOwned(string publicId, string type)
    {
        var expected = type switch { "image" => "image", "video" => "audio", "raw" => "manifest.json", _ => "" };
        if (expected.Length == 0 || publicId != runPrefix + "/" + expected)
            throw new InvalidOperationException("Refusing to access assets outside this exact smoke run.");
    }

    public void Dispose() { http.Dispose(); sdk.Api.Client.Dispose(); }
}
