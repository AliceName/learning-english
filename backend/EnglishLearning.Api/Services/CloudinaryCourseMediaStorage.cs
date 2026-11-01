using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Services.CloudinaryMedia;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Services;

public sealed class CloudinaryCourseMediaStorage(Func<ICloudMediaStore> cloud, Func<ICloudinaryAssetTransport> transport,
    Func<MediaStorage> legacy, IOptions<CloudinarySettings> settings) : IMediaStorage
{
    public CloudinaryCourseMediaStorage(Func<ICloudMediaStore> cloud, Func<ICloudinaryAssetTransport> transport,
        MediaStorage legacy, IOptions<CloudinarySettings> settings) : this(cloud, transport, () => legacy, settings) { }
    private void EnsureReadable()
    {
        if (!settings.Value.Enabled && !settings.Value.AllowLegacyReads) throw new AuthoringException(503, "Kho media chưa được cấu hình. Vui lòng thử lại sau.");
    }
    private sealed record Identity(string Reference, string Format, string Mime, CloudMediaKind Kind);
    private static Identity? Identify(string fileName)
    {
        if (!MediaStorage.IsManagedFileName(fileName)) return null;
        var mime = MediaStorage.ContentType(fileName)!;
        var format = Path.GetExtension(fileName)[1..]; if (format == "jpeg") format = "jpg";
        return new(fileName[..32], format, mime, mime.StartsWith("image/", StringComparison.Ordinal) ? CloudMediaKind.CourseCover : CloudMediaKind.CourseAudio);
    }

    public async Task<(string FileName, string ContentType, long SizeBytes)> SaveAsync(IFormFile file, string kind, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
        var identity = Identify(new string('a', 32) + extension);
        if (kind is not ("cover" or "audio") || identity is null ||
            (kind == "cover") != (identity.Kind == CloudMediaKind.CourseCover))
            throw new AuthoringException(400, "Định dạng tệp không phù hợp. Ảnh: JPG/PNG/WebP; audio: MP3/WAV/AAC/M4A.");
        var maximum = (kind == "cover" ? 5L : 25L) * 1024 * 1024;
        if (file.Length < 12 || file.Length > maximum) throw new AuthoringException(400, kind == "cover" ? "Ảnh tối đa 5 MB." : "Audio tối đa 25 MB.");
        var declaredMime = file.ContentType?.Split(';')[0].Trim().ToLowerInvariant();
        if (!string.IsNullOrEmpty(declaredMime) && declaredMime != "application/octet-stream" && !CloudMediaValidation.MatchesMime(identity.Mime, declaredMime))
            throw new AuthoringException(400, "MIME của tệp không khớp định dạng đã chọn.");
        if (!settings.Value.Enabled) throw new AuthoringException(503, "Kho media chưa được cấu hình. Vui lòng thử lại sau.");
        await using var input = file.OpenReadStream();
        using var output = new MemoryStream((int)Math.Min(file.Length, 81920));
        var buffer = new byte[81920]; long total = 0;
        while (true)
        {
            var count = await input.ReadAsync(buffer.AsMemory(0, (int)Math.Min(buffer.Length, file.Length + 1 - total)), token);
            if (count == 0) break;
            total += count;
            if (total > file.Length || total > maximum) throw new AuthoringException(400, "Kích thước thực tế của tệp không hợp lệ.");
            await output.WriteAsync(buffer.AsMemory(0, count), token);
        }
        if (total != file.Length) throw new AuthoringException(400, "Tệp chưa tải đủ. Vui lòng thử lại.");
        var bytes = output.ToArray();
        try { _ = CloudMediaValidation.ValidateBytes(identity.Kind, identity.Format, bytes); }
        catch (CloudMediaException error) when (error.Status == 400) { throw new AuthoringException(400, "Nội dung tệp không khớp định dạng ảnh/audio đã chọn."); }
        var reference = Guid.NewGuid().ToString("N");
        var saved = await cloud().StoreAsync(identity.Kind, reference, bytes, identity.Format, null, token);
        Validate(saved, identity with { Reference = reference });
        return (reference + "." + identity.Format, saved.ContentType, saved.SizeBytes);
    }

    public async Task<bool> ExistsAsync(string url, string typePrefix, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (!url.StartsWith("/api/media/", StringComparison.Ordinal))
            return Uri.TryCreate(url, UriKind.Absolute, out var external) && external.Scheme is "http" or "https" && string.IsNullOrEmpty(external.UserInfo); // Preserve the existing MediaUrl contract; never fetch external URLs here.
        var name = url[11..]; var identity = Identify(name);
        if (identity is null || !identity.Mime.StartsWith(typePrefix, StringComparison.Ordinal)) return false;
        EnsureReadable();
        if (settings.Value.Enabled)
        {
            var saved = await cloud().FindAsync(identity.Kind, identity.Reference, token);
            if (saved is not null)
            {
                Validate(saved, identity);
                // Publish verifies the asset even when manifest metadata is cached.
                return await transport().ProbeAsync(saved.Asset, token);
            }
        }
        if (!settings.Value.AllowLegacyReads) return false;
        await using var old = await OpenLegacyAsync(name, identity, token);
        return old is not null;
    }

    public async Task<CourseMediaPlayback?> OpenAsync(string fileName, string? range, CancellationToken token)
    {
        var identity = Identify(fileName); if (identity is null) return null;
        EnsureReadable();
        if (settings.Value.Enabled)
        {
            var saved = await cloud().FindAsync(identity.Kind, identity.Reference, token);
            if (saved is not null)
            {
                Validate(saved, identity);
                var read = await cloud().OpenAsync(identity.Kind, identity.Reference, range, token);
                return new(read.Body, read.ContentType, read.Length, read.Status, read.ContentRange);
            }
        }
        return settings.Value.AllowLegacyReads ? await OpenLegacyAsync(fileName, identity, token) : null;
    }

    private async Task<CourseMediaPlayback?> OpenLegacyAsync(string name, Identity identity, CancellationToken token)
    {
        var path = legacy().Resolve(name); if (path is null) return null;
        FileStream? stream = null;
        try
        {
            stream = new(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete, 81920, true);
            if (stream.Length < 12 || stream.Length > (identity.Kind == CloudMediaKind.CourseCover ? 5L : 25L) * 1024 * 1024) return null;
            var header = new byte[(int)Math.Min(4096, stream.Length)]; await stream.ReadExactlyAsync(header, token);
            try { _ = CloudMediaValidation.ValidateBytes(identity.Kind, identity.Format, header); }
            catch (CloudMediaException) { return null; }
            stream.Position = 0;
            var result = new CourseMediaPlayback(stream, identity.Mime, stream.Length, EnableRangeProcessing: true); stream = null;
            return result;
        }
        catch (Exception error) when (error is FileNotFoundException or DirectoryNotFoundException) { return null; }
        finally { if (stream is not null) await stream.DisposeAsync(); }
    }

    private static void Validate(CloudMediaManifest saved, Identity identity)
    {
        if (saved.Kind != identity.Kind || saved.ReferenceKey != identity.Reference || saved.Asset.Format != identity.Format || saved.ContentType != identity.Mime)
            throw new CloudMediaException(502, "invalid_course_media_manifest");
    }
}
