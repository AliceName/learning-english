using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Services;

public sealed class SpeakingLessonService(EnglishLearningDbContext db)
{
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    public static SpeakingContent? ReadContent(string? json)
    {
        try
        {
            var content = json is null ? null : JsonSerializer.Deserialize<LessonContentDocument>(json, JsonOptions);
            return content is { Version: 1, Speaking.Sentences.Length: > 0 }
                && content.Speaking.Sentences.All(s => s is not null && !string.IsNullOrWhiteSpace(s.Text)) ? content.Speaking : null;
        }
        catch (JsonException) { return null; }
    }
    public async Task<SpeakingLessonResponse?> GetAsync(int userId, int lessonId, CancellationToken ct)
    {
        var item = await (from lesson in db.Lessons.AsNoTracking()
            join course in db.Courses.AsNoTracking() on lesson.CourseId equals course.CourseId
            where lesson.LessonId == lessonId && lesson.IsActive && lesson.SkillType == "speaking"
                && course.IsPublished && (course.SourceType == "system" || course.CreatedBy == userId)
            select new { Lesson = lesson, CourseTitle = course.Title }).SingleOrDefaultAsync(ct);
        if (item is null || ReadContent(item.Lesson.Content) is not { } content) return null;
        return new(item.Lesson.LessonId, item.Lesson.CourseId, item.Lesson.Title, item.CourseTitle, content.Goals ?? "", content.Sentences,
            Segments: content.Sentences.Select(sentence => SpeakingPhraseSegmenter.Split(sentence.Text)).ToArray(),
            SegmentationVersion: SpeakingPhraseSegmenter.Version);
    }
}
