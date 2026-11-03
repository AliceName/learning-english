using System.Text.RegularExpressions;

namespace EnglishLearning.Api.Services;

public sealed class SpeakingStorage(IConfiguration configuration, IWebHostEnvironment environment)
{
    public const int MaxBytes = 2 * 1024 * 1024;
    private const string Prefix = "/api/speaking/recordings/";
    private readonly string root = Path.GetFullPath(configuration["SpeakingStorage:RootPath"]
        ?? Path.Combine(environment.ContentRootPath, "App_Data", "speaking"));
    public static bool IsFileName(string fileName) => Regex.IsMatch(fileName, @"\A[a-f0-9]{32}\.wav\z");
    public string? Resolve(string url) => url.StartsWith(Prefix, StringComparison.Ordinal) && IsFileName(url[Prefix.Length..])
        ? Path.Combine(root, url[Prefix.Length..]) : null;
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
    public async Task<string> SaveAsync(byte[] wav, CancellationToken ct)
    {
        Directory.CreateDirectory(root);
        var url = Prefix + Guid.NewGuid().ToString("N") + ".wav";
        var path = Resolve(url)!;
        try { await File.WriteAllBytesAsync(path, wav, ct); }
        catch { if (File.Exists(path)) File.Delete(path); throw; }
        return url;
    }
    public void Delete(string url) { if (Resolve(url) is { } path && File.Exists(path)) File.Delete(path); }
}
