namespace EnglishLearning.Api.Entities;

public sealed class ErrorLog
{
    public int ErrorLogId { get; set; }
    public int UserId { get; set; }
    public string SkillType { get; set; } = string.Empty;
    public int? LessonId { get; set; }
    public string? QuestionRef { get; set; }
    public string? UserAnswer { get; set; }
    public string? CorrectAnswer { get; set; }
    public string? Explanation { get; set; }
    public string Status { get; set; } = "unresolved";
    public DateTime CreatedAt { get; set; }
    public DateTime? ResolvedAt { get; set; }
}
