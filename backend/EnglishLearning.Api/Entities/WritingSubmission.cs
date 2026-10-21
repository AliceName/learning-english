namespace EnglishLearning.Api.Entities;

public sealed class WritingSubmission
{
    public int SubmissionId { get; set; }
    public int UserId { get; set; }
    public int? LessonId { get; set; }
    public string? Topic { get; set; }
    public string OriginalText { get; set; } = string.Empty;
    public string? CorrectedText { get; set; }
    public string? CefrLevel { get; set; }
    public string? ErrorsJson { get; set; }
    public string? Feedback { get; set; }
    public decimal? Score { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
