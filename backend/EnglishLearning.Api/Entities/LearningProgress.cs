namespace EnglishLearning.Api.Entities;

public sealed class LearningProgress
{
    public int ProgressId { get; set; }
    public int UserId { get; set; }
    public int CourseId { get; set; }
    public int? LastLessonId { get; set; }
    public string? LastPosition { get; set; }
    public DateTime UpdatedAt { get; set; }
}
