namespace EnglishLearning.Api.Entities;

public sealed class Lesson
{
    public int LessonId { get; set; }
    public int CourseId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string SkillType { get; set; } = string.Empty;
    public string? Content { get; set; }
    public string? AudioUrl { get; set; }
    public int OrderIndex { get; set; }
    public string? DifficultyLevel { get; set; }
    public int? EstimatedMinutes { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
}
