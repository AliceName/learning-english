namespace EnglishLearning.Api.Entities;

public sealed class UserCourse
{
    public int UserCourseId { get; set; }
    public int UserId { get; set; }
    public int CourseId { get; set; }
    public DateTime EnrolledAt { get; set; }
    public string Status { get; set; } = "in_progress";
    public decimal ProgressPercent { get; set; } = 0m;
}
