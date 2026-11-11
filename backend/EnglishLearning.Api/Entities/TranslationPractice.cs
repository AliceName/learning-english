namespace EnglishLearning.Api.Entities;

public sealed class TranslationPrompt
{
    public int PromptId { get; set; }
    public Guid RotationKey { get; set; }
    public required string VietnameseText { get; set; }
    public required string CefrLevel { get; set; }
    public required string Topic { get; set; }
    public required string MeaningNotesJson { get; set; }
    public required byte[] NormalizedVietnameseHash { get; set; }
    public required string Availability { get; set; }
}

public sealed class TranslationAcceptedAnswer
{
    public int AnswerId { get; set; }
    public int PromptId { get; set; }
    public required string EnglishText { get; set; }
    public required byte[] NormalizedEnglishHash { get; set; }
    public required string Source { get; set; }
    public required string ReviewStatus { get; set; }
}

public sealed class UserTranslationPromptExposure
{
    public int UserId { get; set; }
    public Guid RotationKey { get; set; }
    public DateTime LastShownAtUtc { get; set; }
}
