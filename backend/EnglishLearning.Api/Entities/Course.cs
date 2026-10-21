namespace EnglishLearning.Api.Entities;

public sealed class Course
{
    public int CourseId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string SourceType { get; set; } = "system";
    public string? CoverImageUrl { get; set; }
    public int? CreatedBy { get; set; }
    public bool IsPublished { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
