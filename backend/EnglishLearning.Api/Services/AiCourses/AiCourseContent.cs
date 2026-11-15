using EnglishLearning.Api.Contracts;

namespace EnglishLearning.Api.Services.AiCourses;

public sealed record AiContentIssue(string Code, string Path, string Message, string Hint);

public static class AiCourseContent
{
    public static readonly string[] Skills = ["listening", "speaking", "reading", "writing", "grammar"];
    public static bool MatchesSelection(AiCourseConfig config, AiOutlineLesson[] lessons) =>
        lessons is not null && lessons.Length == config.TotalLessons && lessons.All(lesson => lesson is not null && config.Skills.Contains(lesson.SkillType))
        && config.Skills.All(skill => lessons.Count(lesson => lesson.SkillType == skill) == config.LessonCount);

    public static LessonContentDocument Document(AiOutlineLesson lesson) =>
        new(1, lesson.Speaking, lesson.Listening, lesson.Grammar, lesson.Writing, lesson.Reading);

    public static void Validate(AiOutlineLesson lesson, int questionCount)
    {
        var issues = AiCourseValidation.FindIssues(lesson, questionCount);
        if (issues.Length > 0) throw Invalid(issues);
    }
    public static bool ValidTree(object value) => AiCourseValidation.TreeIssues(value).Count == 0;
    public static AiCourseException Invalid(params AiContentIssue[] issues) => new(502, "invalid_generated_content",
        issues.Length == 0 ? "Nội dung AI chưa đúng cấu trúc bài học." : $"Nội dung AI chưa hợp lệ: {issues[0].Message} ({issues[0].Path}).") { ContentIssues = issues };
}
