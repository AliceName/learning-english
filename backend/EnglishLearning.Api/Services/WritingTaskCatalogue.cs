using System.Security.Cryptography;
using System.Text.Json;
using System.Text;
using System.Globalization;
using EnglishLearning.Api.Contracts;

namespace EnglishLearning.Api.Services;

public sealed class WritingTaskLibrary(IConfiguration configuration, IWebHostEnvironment environment)
{
    public WritingTaskCatalogue Load()
    {
        if (!environment.IsDevelopment()) throw new InvalidOperationException("Local catalogue is disabled.");
        var path = configuration["WritingTasks:CataloguePath"]
            ?? Path.Combine(environment.ContentRootPath, "../../ai/writing/data/prompt-catalogue.v1.json");
        var bytes = File.ReadAllBytes(Path.GetFullPath(path));
        if (bytes.Length > 2_000_000) throw new InvalidDataException("Catalogue too large.");
        var catalogue = JsonSerializer.Deserialize<WritingTaskCatalogue>(bytes, new JsonSerializerOptions(JsonSerializerDefaults.Web))
            ?? throw new InvalidDataException("Missing catalogue.");
        if (catalogue.SourceCount != 50 || catalogue.Items is null || catalogue.Items.Length is < 1 or > 50
            || catalogue.Items.Any(t => !Valid(t) || t.Version != Version(t))
            || catalogue.Items.Select(t => t.Id).Distinct().Count() != catalogue.Items.Length) throw new InvalidDataException("Invalid catalogue.");
        return catalogue with { Version = Convert.ToHexStringLower(SHA256.HashData(bytes)) };
    }

    public static bool Valid(WritingTaskSnapshot? t) => t is not null &&
        Guid.TryParse(t.Id, out _) && Hash(t.Version) && Hash(t.SourceSha256) && Hash(t.SourcePromptSha256)
        && Bounded(t.Title, 200) && Bounded(t.Prompt, 8000) && Bounded(t.Topic, 200) && Bounded(t.Genre, 100)
        && t.Level is "Beginner" or "Intermediate" or "Advanced"
        && t.WordMode is "range" or "about" or "minimum" or "metadata"
        && t.MinWords is >= 1 and <= 1000 && t.MaxWords >= t.MinWords && t.MaxWords <= 1000
        && t.Requirements is { Length: > 0 and <= 12 } && t.Requirements.All(r => Bounded(r, 1000))
        && t.ReviewStatus == "automated-reviewed-not-expert";
    private static bool Hash(string? value) => value is { Length: 64 } && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
    private static bool Bounded(string? value, int max) => !string.IsNullOrWhiteSpace(value) && value.Length <= max;

    public static string Version(WritingTaskSnapshot t)
    {
        // UTF-8 byte-length prefixes avoid JSON encoder differences and ambiguous separators.
        string Number(int value) => value.ToString(CultureInfo.InvariantCulture);
        string[] fields = [t.Id,t.Title,t.Prompt,t.Level,t.Genre,t.Topic,Number(t.MinWords),Number(t.MaxWords),
            t.WordMode,Number(t.Requirements.Length),..t.Requirements,t.SourceSha256,t.SourcePromptSha256,t.ReviewStatus];
        var material = string.Concat(fields.Select(s => Number(Encoding.UTF8.GetByteCount(s)) + ":" + s));
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(material)));
    }
}
