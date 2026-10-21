namespace EnglishLearning.Api.Entities;

public sealed class SpeakingAttempt
{
    public int AttemptId { get; set; }
    public int UserId { get; set; }
    public int LessonId { get; set; }
    public string AudioUrl { get; set; } = string.Empty;
    public decimal? OverallScore { get; set; }
    public string? PhonemeScores { get; set; }
    public string? Feedback { get; set; }
    public int? DurationSeconds { get; set; }
    public DateTime CreatedAt { get; set; }
}
