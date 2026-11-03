using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using EnglishLearning.Api.Contracts;

namespace EnglishLearning.Api.Services.CloudinaryMedia;

[JsonConverter(typeof(JsonStringEnumConverter<CloudMediaKind>))]
public enum CloudMediaKind { DictionaryAudio, CourseCover, CourseAudio }
public sealed record CloudAsset(string AssetId, string PublicId, string ResourceType, string DeliveryType,
    string Format, string Version, long Bytes);
public sealed record CloudUpload(CloudAsset Asset, bool Created);
public sealed record CloudMediaManifest(int SchemaVersion, CloudMediaKind Kind, string ReferenceKey,
    CloudAsset Asset, string Sha256, string ContentType, long SizeBytes, DateTime CreatedAtUtc, AudioAttribution? Attribution);

public sealed class CloudMediaException(int status, string code, bool retryable = false, int? retryAfterSeconds = null,
    IReadOnlyList<string>? orphanCandidates = null) : Exception(code)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public bool Retryable { get; } = retryable;
    public int? RetryAfterSeconds { get; } = retryAfterSeconds;
    // Candidates need reconciliation: another reference or an uncertain manifest write may own them.
    public IReadOnlyList<string> OrphanCandidates { get; } = orphanCandidates ?? [];
}

public interface ICloudinaryAssetTransport
{
    Task<CloudUpload> UploadIfAbsentAsync(string publicId, string resourceType, string format, ReadOnlyMemory<byte> bytes, CancellationToken token);
    Task<CloudAsset?> StatAsync(string publicId, string resourceType, CancellationToken token);
    Task<CloudRemoteRead?> OpenManifestAsync(string publicId, CancellationToken token);
    Task<bool> ProbeAsync(CloudAsset asset, CancellationToken token);
    Task<CloudRemoteRead> OpenAsync(CloudAsset asset, RangeHeaderValue? range, CancellationToken token);
}

public interface ICloudMediaStore
{
    Task<CloudMediaManifest> StoreAsync(CloudMediaKind kind, string reference, ReadOnlyMemory<byte> bytes, string format, AudioAttribution? attribution, CancellationToken token);
    Task<CloudMediaManifest?> FindAsync(CloudMediaKind kind, string reference, CancellationToken token);
    Task<CloudMediaRead> OpenAsync(CloudMediaKind kind, string reference, string? range, CancellationToken token);
}

public sealed class CloudRemoteRead(HttpStatusCode status, string? contentType, long? length, ContentRangeHeaderValue? range, Stream body) : IAsyncDisposable
{
    public HttpStatusCode Status { get; } = status;
    public string? ContentType { get; } = contentType;
    public long? Length { get; } = length;
    public ContentRangeHeaderValue? ContentRange { get; } = range;
    public Stream Body { get; } = body;
    public ValueTask DisposeAsync() => Body.DisposeAsync();
}

public sealed class CloudMediaRead(int status, string contentType, long length, string? contentRange, Stream body) : IAsyncDisposable
{
    public int Status { get; } = status;
    public string ContentType { get; } = contentType;
    public long Length { get; } = length;
    public string? ContentRange { get; } = contentRange;
    public string AcceptRanges => "bytes";
    public Stream Body { get; } = body;
    public ValueTask DisposeAsync() => Body.DisposeAsync();
}

public sealed class CloudMediaNames(string prefix)
{
    public string Prefix { get; } = Regex.IsMatch(prefix, @"\Aels/(dev|test|prod)(/[a-z0-9][a-z0-9-]{0,31}){0,2}\z")
        ? prefix : throw new ArgumentException("Invalid media namespace.");
    public static bool Hash(string? value) => value is not null && Regex.IsMatch(value, @"\A[a-f0-9]{64}\z");
    public static string Digest(ReadOnlySpan<byte> bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));
    public static void Reference(CloudMediaKind kind, string reference)
    {
        if (!Enum.IsDefined(kind) || !Regex.IsMatch(reference ?? "", kind == CloudMediaKind.DictionaryAudio ? @"\A[a-f0-9]{64}\z" : @"\A[a-f0-9]{32}\z"))
            throw new CloudMediaException(400, "invalid_media_reference");
    }
    public string Manifest(CloudMediaKind kind, string reference)
    {
        Reference(kind, reference);
        return Prefix + (kind == CloudMediaKind.DictionaryAudio ? "/dictionary/references/" : "/courses/references/") + reference + ".json";
    }
    public string Binary(CloudMediaKind kind, string reference, string hash)
    {
        Reference(kind, reference);
        if (!Hash(hash)) throw new CloudMediaException(400, "invalid_media_hash");
        return Prefix + (kind switch
        {
            CloudMediaKind.DictionaryAudio => "/dictionary/audio/" + hash,
            CloudMediaKind.CourseCover => "/courses/covers/" + reference,
            _ => "/courses/audio/" + reference
        });
    }
    public void EnsureOwned(string id, string resourceType)
    {
        var suffix = id.StartsWith(Prefix + "/", StringComparison.Ordinal) ? id[(Prefix.Length + 1)..] : "";
        var pattern = resourceType switch
        {
            "image" => @"\Acourses/covers/[a-f0-9]{32}\z",
            "video" => @"\A(dictionary/audio/[a-f0-9]{64}|courses/audio/[a-f0-9]{32})\z",
            "raw" => @"\A(dictionary/references/[a-f0-9]{64}|courses/references/[a-f0-9]{32})\.json\z",
            _ => "(?!)"
        };
        if (!Regex.IsMatch(suffix, pattern)) throw new CloudMediaException(400, "media_namespace_violation");
    }
}
