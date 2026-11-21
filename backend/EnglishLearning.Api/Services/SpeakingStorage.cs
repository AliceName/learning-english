using System.Text.RegularExpressions;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Services.CloudinaryMedia;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Services;

/// <summary>
/// Learner recordings. With Cloudinary enabled they are stored as authenticated assets under
/// {prefix}/speaking/recordings/{guid} and streamed through the API; otherwise (local development)
/// they stay on disk. The URL stored in SpeakingAttempts.AudioUrl is the same in both modes.
/// Cloud names never contain user data: only SQL links a recording to its owner.
/// </summary>
public sealed class SpeakingStorage(IConfiguration configuration, IWebHostEnvironment environment,
    IOptions<CloudinarySettings> settings, Func<ICloudMediaStore> cloud, ILogger<SpeakingStorage> logger)
{
    public const int MaxBytes = 2 * 1024 * 1024;
    private const string Prefix = "/api/speaking/recordings/";
    private readonly string root = Path.GetFullPath(configuration["SpeakingStorage:RootPath"]
        ?? Path.Combine(environment.ContentRootPath, "App_Data", "speaking"));
    private bool CloudEnabled => settings.Value.Enabled;
    public static bool IsFileName(string fileName) => Regex.IsMatch(fileName, @"\A[a-f0-9]{32}\.wav\z");
    private static string? Reference(string url) => url.StartsWith(Prefix, StringComparison.Ordinal) && IsFileName(url[Prefix.Length..])
        ? url[Prefix.Length..^4] : null;
    public string? Resolve(string url) => Reference(url) is { } reference ? Path.Combine(root, reference + ".wav") : null;

    public static async Task<byte[]> ReadWavAsync(IFormFile file, CancellationToken ct)
    {
        if (file.Length < 44 || file.Length > MaxBytes) throw new SpeakingException(400, "Vui lòng gửi tệp WAV tối đa 2 MB.");
        await using var input = file.OpenReadStream();
        using var output = new MemoryStream();
        var buffer = new byte[16384];
        int read;
        while ((read = await input.ReadAsync(buffer, ct)) != 0)
        {
            if (output.Length + read > MaxBytes) throw new SpeakingException(413, "Audio tối đa 2 MB.");
            await output.WriteAsync(buffer.AsMemory(0, read), ct);
        }
        var bytes = output.ToArray();
        if (bytes.Length < 44 || !bytes.AsSpan(0, 4).SequenceEqual("RIFF"u8) || !bytes.AsSpan(8, 4).SequenceEqual("WAVE"u8))
            throw new SpeakingException(400, "Nội dung tệp cần là WAV. Hãy ghi âm lại hoặc chọn tệp WAV.");
        return bytes;
    }

    /// <summary>Stores a scored recording. Cloud failures surface as <see cref="CloudMediaException"/>.</summary>
    public async Task<string> SaveAsync(byte[] wav, CancellationToken ct)
    {
        var reference = Guid.NewGuid().ToString("N");
        var url = Prefix + reference + ".wav";
        if (CloudEnabled)
        {
            await cloud().StoreAsync(CloudMediaKind.SpeakingRecording, reference, wav, "wav", null, ct);
            return url;
        }
        Directory.CreateDirectory(root);
        var path = Resolve(url)!;
        try { await File.WriteAllBytesAsync(path, wav, ct); }
        catch { if (File.Exists(path)) File.Delete(path); throw; }
        return url;
    }

    public async Task<CourseMediaPlayback?> OpenAsync(string url, string? range, CancellationToken ct)
    {
        if (Reference(url) is not { } reference) return null;
        if (CloudEnabled)
        {
            try
            {
                var read = await cloud().OpenAsync(CloudMediaKind.SpeakingRecording, reference, range, ct);
                return new(read.Body, read.ContentType, read.Length, read.Status, read.ContentRange);
            }
            catch (CloudMediaException error) when (error.Status == 404 && settings.Value.AllowLegacyReads) { }
            catch (CloudMediaException error) when (error.Status == 404) { return null; }
        }
        var path = Resolve(url)!;
        if (!File.Exists(path)) return null;
        var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete, 81920, true);
        return new(stream, "audio/wav", stream.Length, EnableRangeProcessing: true);
    }

    /// <summary>Best-effort delete; returns false (and logs) when the recording may still exist.</summary>
    public async Task<bool> DeleteAsync(string url, CancellationToken ct)
    {
        if (Reference(url) is not { } reference) return true;
        try
        {
            if (CloudEnabled) await cloud().DeleteAsync(CloudMediaKind.SpeakingRecording, reference, ct);
            var path = Resolve(url)!;
            if (File.Exists(path)) File.Delete(path);
            return true;
        }
        catch (Exception error) when (error is CloudMediaException or IOException or UnauthorizedAccessException)
        {
            logger.LogWarning("Speaking recording {Reference} could not be deleted ({Error}); reconcile later.", reference,
                error is CloudMediaException cloudError ? cloudError.Code : error.GetType().Name);
            return false;
        }
    }
}
