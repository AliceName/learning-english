using System.ComponentModel.DataAnnotations;

namespace EnglishLearning.Api.Contracts;

public sealed class CourseListQuery
{
    [StringLength(200)]
    public string? Search { get; init; }

    [RegularExpression("^(A1|A2|B1|B2|C1|C2)$")]
    public string? Level { get; init; }

    [RegularExpression("^(speaking|writing|listening|reading|grammar)$")]
    public string? Skill { get; init; }

    [RegularExpression("^(system|user_upload)$")]
    public string? Source { get; init; }

    [RegularExpression("^(all|in_progress|completed|not_started)$")]
    public string Status { get; init; } = "all";

    [RegularExpression("^(updated|newest|popular|title)$")]
    public string Sort { get; init; } = "updated";

    [Range(1, 10000)]
    public int Page { get; init; } = 1;

    [Range(1, 24)]
    public int PageSize { get; init; } = 6;
}

public sealed record CourseEnrollment(string Status, decimal ProgressPercent);
public sealed record CourseSummary(int TotalCourses, int InProgress, int Completed);
public sealed record CourseListItem(
    int CourseId, string Title, string? Description, string SourceType, string? CoverImageUrl,
    DateTime UpdatedAt, int LessonCount, int EstimatedMinutes, int TimedLessonCount,
    IReadOnlyList<string> Levels, IReadOnlyList<string> Skills,
    int EnrollmentCount, CourseEnrollment? Enrollment);
public sealed record CourseListResponse(
    IReadOnlyList<CourseListItem> Items, int TotalCount, int Page, int PageSize,
    int TotalPages, CourseSummary Summary);
public sealed record CourseLessonSummary(
    int LessonId, string Title, string SkillType, string? DifficultyLevel,
    int? EstimatedMinutes, int OrderIndex);
public sealed record CourseDetailResponse(CourseListItem Course, IReadOnlyList<CourseLessonSummary> Lessons);
