using System.Text.RegularExpressions;

namespace EnglishLearning.Api.Services;

public sealed class MediaStorage(IConfiguration configuration, IWebHostEnvironment environment)
{
    private readonly string root = Path.GetFullPath(configuration["MediaStorage:RootPath"] ?? Path.Combine(environment.ContentRootPath, "App_Data", "uploads"));
    private static readonly IReadOnlyDictionary<string, string> Types = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".png"] = "image/png", [".webp"] = "image/webp",
        [".mp3"] = "audio/mpeg", [".wav"] = "audio/wav", [".aac"] = "audio/aac", [".m4a"] = "audio/mp4"
    };
    public static string? ContentType(string fileName) => Types.GetValueOrDefault(Path.GetExtension(fileName));
    public string? Resolve(string fileName) => Regex.IsMatch(fileName, @"^[a-f0-9]{32}\.(jpg|jpeg|png|webp|mp3|wav|aac|m4a)$") ? Path.Combine(root, fileName) : null;
    public bool Exists(string url, string? typePrefix = null) => !url.StartsWith("/api/media/", StringComparison.Ordinal) ||
        Resolve(url[11..]) is { } path && File.Exists(path) && (typePrefix is null || ContentType(path)?.StartsWith(typePrefix, StringComparison.Ordinal) == true);

    public async Task<(string FileName, string ContentType)> SaveAsync(IFormFile file, string kind, CancellationToken ct)
    {
        var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
        var type = ContentType(file.FileName);
        if (kind is not ("cover" or "audio") || type is null || !type.StartsWith(kind == "cover" ? "image/" : "audio/", StringComparison.Ordinal))
            throw new AuthoringException(400, "Định dạng tệp không phù hợp. Ảnh: JPG/PNG/WebP; audio: MP3/WAV/AAC/M4A.");
        if (file.Length <= 0 || file.Length > (kind == "cover" ? 5 : 25) * 1024 * 1024)
            throw new AuthoringException(400, kind == "cover" ? "Ảnh tối đa 5 MB." : "Audio tối đa 25 MB.");
        await using var input = file.OpenReadStream();
        var header = new byte[12];
        var read = await input.ReadAtLeastAsync(header, header.Length, throwOnEndOfStream: false, cancellationToken: ct);
        if (read < 12 || !MatchesHeader(extension, header)) throw new AuthoringException(400, "Nội dung tệp không khớp định dạng ảnh/audio đã chọn.");
        Directory.CreateDirectory(root);
        var fileName = Guid.NewGuid().ToString("N") + extension;
        var path = Resolve(fileName)!;
        try
        {
            await using var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, useAsync: true);
            await output.WriteAsync(header, ct);
            await input.CopyToAsync(output, ct);
        }
        catch { if (File.Exists(path)) File.Delete(path); throw; }
        return (fileName, type);
    }
    private static bool MatchesHeader(string extension, byte[] bytes) => extension switch
    {
        ".jpg" or ".jpeg" => bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff,
        ".png" => bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }),
        ".webp" => bytes.AsSpan(0, 4).SequenceEqual("RIFF"u8) && bytes.AsSpan(8, 4).SequenceEqual("WEBP"u8),
        ".wav" => bytes.AsSpan(0, 4).SequenceEqual("RIFF"u8) && bytes.AsSpan(8, 4).SequenceEqual("WAVE"u8),
        ".mp3" => bytes.AsSpan(0, 3).SequenceEqual("ID3"u8) || bytes[0] == 0xff && (bytes[1] & 0xe0) == 0xe0,
        ".aac" => bytes[0] == 0xff && (bytes[1] & 0xf6) == 0xf0,
        ".m4a" => bytes.AsSpan(4, 4).SequenceEqual("ftyp"u8),
        _ => false
    };
}
