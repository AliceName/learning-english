using System.ComponentModel.DataAnnotations;

namespace EnglishLearning.Api.Contracts;

public sealed class GenerateIpaRequest
{
    [Required, StringLength(1000)] public string Text { get; init; } = "";
}

public sealed record IpaAlternative(string Word, IReadOnlyList<string> Pronunciations);
public sealed record GenerateIpaResponse(string? Ipa, string Accent, IReadOnlyList<string> UnknownWords,
    IReadOnlyList<IpaAlternative> Alternatives);
