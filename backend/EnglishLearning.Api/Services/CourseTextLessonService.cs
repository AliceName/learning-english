using System.Data;
using System.Text.Json;
using System.Text.RegularExpressions;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services.AiCourses;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Services;

public sealed class CourseTextLessonService(EnglishLearningDbContext db, CourseReadingGrading reading, WritingAiClient writing)
{
    private async Task<(Course Course, Lesson Lesson)> RequireAsync(int user, int courseId, int lessonId, string skill, CancellationToken ct)
    {
        var course = await db.Courses.AsNoTracking().SingleOrDefaultAsync(item => item.CourseId == courseId && item.IsPublished
            && (item.SourceType == "system" || item.CreatedBy == user), ct) ?? throw new CourseTextLessonException(404, "Không tìm thấy khóa học.");
        var lesson = await db.Lessons.AsNoTracking().SingleOrDefaultAsync(item => item.LessonId == lessonId && item.CourseId == courseId
            && item.IsActive && item.SkillType == skill, ct) ?? throw new CourseTextLessonException(404, "Không tìm thấy bài học.");
        return (course, lesson);
    }
    public async Task<CourseReadingLesson> ReadingAsync(int user, int courseId, int lessonId, CancellationToken ct)
    {
        var (course, lesson) = await RequireAsync(user, courseId, lessonId, "reading", ct);
        var content = CourseReadingGrading.ReadContent(lesson);
        var latest = await db.ExerciseResults.AsNoTracking().Where(item => item.UserId == user && item.LessonId == lessonId)
            .OrderByDescending(item => item.ResultId).FirstOrDefaultAsync(ct);
        return new(courseId, course.Title, lessonId, lesson.Title, lesson.DifficultyLevel, ListeningGradingService.ContentVersion(lesson),
            content.PassageTitle, content.Passage, content.Instructions, content.Vocabulary, reading.PublicQuestions(lesson, content),
            latest is null ? null : content.Translation, latest is null ? null : Summary(latest),
            content.ImageUrl, content.ImageAlt, content.ImageCaption, content.Category, lesson.EstimatedMinutes);
    }
    public async Task<CourseReadingResult> SubmitReadingAsync(int user, int courseId, int lessonId, ListeningSubmissionRequest request, CancellationToken ct)
    {
        var (_, lesson) = await RequireAsync(user, courseId, lessonId, "reading", ct);
        var content = CourseReadingGrading.ReadContent(lesson);
        var review = reading.Grade(lesson, content, request);
        await using var transaction = db.Database.IsRelational() && db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct) : null;
        await EnrollAsync(user, courseId, ct);
        var result = new ExerciseResult {
            UserId = user, LessonId = lessonId, TotalQuestions = review.Length, CorrectAnswers = review.Count(item => item.Correct),
            Score = decimal.Round(review.Where(item => item.Correct).Sum(item => content.Questions[item.QuestionId].Points)
                / content.Questions.Sum(question => question.Points) * 100, 2, MidpointRounding.AwayFromZero),
            TimeSpentSeconds = request.TimeSpentSeconds,
            WrongAnswersJson = JsonSerializer.Serialize(new { version = 1, request.ContentVersion, questions = review.Where(item => !item.Correct) }, AiCourseStore.Json)
        };
        db.ExerciseResults.Add(result); await db.SaveChangesAsync(ct);
        if (transaction is not null) await transaction.CommitAsync(ct);
        return new(Summary(result), review, content.Translation);
    }
    public async Task<CourseWritingLesson> WritingAsync(int user, int courseId, int lessonId, CancellationToken ct)
    {
        var (course, lesson) = await RequireAsync(user, courseId, lessonId, "writing", ct);
        var content = ReadWriting(lesson);
        var latest = await db.WritingSubmissions.AsNoTracking().Where(item => item.UserId == user && item.LessonId == lessonId)
            .OrderByDescending(item => item.SubmissionId).FirstOrDefaultAsync(ct);
        return new(courseId, course.Title, lessonId, lesson.Title, lesson.DifficultyLevel, ListeningGradingService.ContentVersion(lesson),
            content.TaskType, content.Topic, content.Prompt, content.Instructions, content.MinWords, content.MaxWords, content.Rubric,
            latest is null ? null : WritingResult(latest, content));
    }
    public async Task<CourseWritingResult> SubmitWritingAsync(int user, int courseId, int lessonId, CourseWritingRequest request, CancellationToken ct)
    {
        var (_, lesson) = await RequireAsync(user, courseId, lessonId, "writing", ct);
        var content = ReadWriting(lesson);
        if (!AiCourseContent.ValidTree(request) || request.ContentVersion != ListeningGradingService.ContentVersion(lesson))
            throw new CourseTextLessonException(409, "Nội dung bài đã thay đổi hoặc bài viết chưa hợp lệ. Hãy tải lại bài.");
        var wordCount = Regex.Matches(request.OriginalText, @"[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*").Count;
        if (wordCount < content.MinWords || wordCount > content.MaxWords)
            throw new CourseTextLessonException(400, $"Bài viết cần từ {content.MinWords} đến {content.MaxWords} từ.");
        var analysis = await writing.AnalyzeAsync(new SubmitWritingRequest {
            OriginalText = request.OriginalText, Topic = content.Prompt, Corrections = request.Corrections
        }, ct);
        var (_, current) = await RequireAsync(user, courseId, lessonId, "writing", ct);
        if (ListeningGradingService.ContentVersion(current) != request.ContentVersion)
            throw new CourseTextLessonException(409, "Đề viết đã thay đổi trong lúc phân tích. Bản nháp vẫn được giữ; hãy tải lại bài.");
        await using var transaction = db.Database.IsRelational() && db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct) : null;
        await EnrollAsync(user, courseId, ct);
        var saved = new WritingSubmission {
            UserId = user, LessonId = lessonId, Topic = content.Topic, OriginalText = request.OriginalText,
            CefrLevel = analysis.Cefr, CorrectedText = analysis.CorrectedText, ErrorsJson = JsonSerializer.Serialize(analysis, AiCourseStore.Json)
        };
        db.WritingSubmissions.Add(saved); await db.SaveChangesAsync(ct);
        if (transaction is not null) await transaction.CommitAsync(ct);
        return WritingResult(saved, content);
    }
    private async Task EnrollAsync(int user, int courseId, CancellationToken ct)
    {
        var enrollment = await db.UserCourses.SingleOrDefaultAsync(item => item.UserId == user && item.CourseId == courseId, ct);
        if (enrollment is null) db.UserCourses.Add(new UserCourse { UserId = user, CourseId = courseId });
        else if (enrollment.Status == "abandoned") enrollment.Status = "in_progress";
    }
    private static WritingContent ReadWriting(Lesson lesson)
    {
        try {
            var document = JsonSerializer.Deserialize<LessonContentDocument>(lesson.Content ?? "null", AiCourseStore.Json);
            if (document is not { Version: 1, Writing: { } content } || !AiCourseContent.ValidTree(content)
                || string.IsNullOrWhiteSpace(content.Prompt) || content.Rubric.Length == 0) throw new CourseTextLessonException(409, "Đề viết đang được hoàn thiện.");
            return content;
        } catch (JsonException) { throw new CourseTextLessonException(409, "Đề viết đang được hoàn thiện."); }
    }
    private static GrammarResultSummary Summary(ExerciseResult item) => new(item.ResultId, item.Score, item.TotalQuestions,
        item.CorrectAnswers, item.TimeSpentSeconds, item.SubmittedAt);
    private static CourseWritingResult WritingResult(WritingSubmission item, WritingContent content)
    {
        WritingAnalysis? analysis = null;
        try { analysis = JsonSerializer.Deserialize<WritingAnalysis>(item.ErrorsJson ?? "null", AiCourseStore.Json); } catch (JsonException) { }
        return new(item.SubmissionId, item.OriginalText, item.CefrLevel, item.CorrectedText, analysis?.Errors ?? [],
            analysis?.Warnings ?? [], analysis?.Feedback, content.SampleAnswer, item.CreatedAt);
    }
}
