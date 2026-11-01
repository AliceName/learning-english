using System.Data;
using System.Globalization;
using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Services;

public sealed class ListeningPracticeService(EnglishLearningDbContext db, ListeningGradingService grading)
{
    private async Task<(Course Course, Lesson Lesson, ListeningContent Content)> RequireLessonAsync(int userId, int courseId, int lessonId, CancellationToken ct)
    {
        var course = await db.Courses.AsNoTracking().SingleOrDefaultAsync(course => course.CourseId == courseId &&
            course.IsPublished && (course.SourceType == "system" || course.CreatedBy == userId), ct)
            ?? throw new ListeningPracticeException(404, "Không tìm thấy khóa học.");
        var lesson = await db.Lessons.AsNoTracking().SingleOrDefaultAsync(lesson => lesson.LessonId == lessonId &&
            lesson.CourseId == courseId && lesson.IsActive && lesson.SkillType == "listening", ct)
            ?? throw new ListeningPracticeException(404, "Không tìm thấy bài nghe.");
        return (course, lesson, ListeningGradingService.ReadContent(lesson));
    }

    public async Task<ListeningPracticeResponse> GetAsync(int userId, int courseId, int lessonId, CancellationToken ct)
    {
        var (course, lesson, content) = await RequireLessonAsync(userId, courseId, lessonId, ct);
        var history = Results(userId, lessonId);
        var latest = await history.OrderByDescending(item => item.SubmittedAt).ThenByDescending(item => item.ResultId).FirstOrDefaultAsync(ct);
        var progress = await db.LearningProgress.AsNoTracking().SingleOrDefaultAsync(item => item.UserId == userId && item.CourseId == courseId, ct);
        var lessons = await LessonLinksAsync(userId, courseId, ct);
        return new(courseId, course.Title, lessonId, lesson.Title, lesson.DifficultyLevel, lesson.EstimatedMinutes,
            lesson.AudioUrl!, ListeningGradingService.ContentVersion(lesson), content.HideTranscriptFirstListen,
            grading.PublicQuestions(lesson, content), Position(progress, lessonId), await history.CountAsync(ct),
            latest is null ? null : Summary(latest), Progress(lessons), lessons);
    }

    public async Task<ListeningStartResponse> StartAsync(int userId, int courseId, int lessonId, CancellationToken ct)
    {
        await RequireLessonAsync(userId, courseId, lessonId, ct);
        return await WriteAsync(async () =>
        {
            var enrollment = await db.UserCourses.SingleOrDefaultAsync(item => item.UserId == userId && item.CourseId == courseId, ct);
            if (enrollment is null) db.UserCourses.Add(new UserCourse { UserId = userId, CourseId = courseId });
            else if (enrollment.Status == "abandoned") enrollment.Status = "in_progress";
            var progress = await db.LearningProgress.SingleOrDefaultAsync(item => item.UserId == userId && item.CourseId == courseId, ct);
            var position = Position(progress, lessonId);
            if (progress is null)
            {
                progress = new LearningProgress { UserId = userId, CourseId = courseId };
                db.LearningProgress.Add(progress);
            }
            progress.LastLessonId = lessonId;
            progress.LastPosition = FormatPosition(position);
            progress.UpdatedAt = await DatabaseTimeAsync(ct);
            await db.SaveChangesAsync(ct);
            return new ListeningStartResponse(position);
        }, ct);
    }

    public async Task<ListeningPositionResponse> SavePositionAsync(int userId, int courseId, int lessonId, ListeningPositionRequest request, CancellationToken ct)
    {
        await RequireLessonAsync(userId, courseId, lessonId, ct);
        if (request.PositionSeconds is < 0 or > 86400) throw new ListeningPracticeException(400, "Vị trí nghe không hợp lệ.");
        var now = await DatabaseTimeAsync(ct);
        var position = FormatPosition(request.PositionSeconds);
        // A delayed request from another lesson must never switch the most recently started lesson.
        var changed = await db.LearningProgress.Where(item => item.UserId == userId && item.CourseId == courseId && item.LastLessonId == lessonId)
            .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.LastPosition, position).SetProperty(item => item.UpdatedAt, now), ct);
        return new(changed > 0);
    }

    public async Task<ListeningTranscriptResponse> TranscriptAsync(int userId, int courseId, int lessonId, CancellationToken ct)
    {
        var (_, _, content) = await RequireLessonAsync(userId, courseId, lessonId, ct);
        return new(content.Transcript);
    }

    public async Task<ListeningResultResponse> SubmitAsync(int userId, int courseId, int lessonId, ListeningSubmissionRequest request, CancellationToken ct)
    {
        var (_, lesson, content) = await RequireLessonAsync(userId, courseId, lessonId, ct);
        var review = grading.Grade(lesson, content, request);
        var result = await WriteAsync(async () =>
        {
            if (!await db.UserCourses.AnyAsync(item => item.UserId == userId && item.CourseId == courseId, ct))
                throw new ListeningPracticeException(409, "Hãy bấm Bắt đầu trước khi nộp bài.");
            var correct = review.Count(item => item.Correct);
            var saved = new ExerciseResult
            {
                UserId = userId, LessonId = lessonId, TotalQuestions = review.Length, CorrectAnswers = correct,
                Score = decimal.Round(100m * correct / review.Length, 2, MidpointRounding.AwayFromZero),
                TimeSpentSeconds = request.TimeSpentSeconds,
                WrongAnswersJson = JsonSerializer.Serialize(new ListeningWrongAnswersDocument(1, request.ContentVersion,
                    review.Where(item => !item.Correct).ToArray()), ListeningGradingService.JsonOptions)
            };
            db.ExerciseResults.Add(saved);
            var progress = await db.LearningProgress.SingleOrDefaultAsync(item => item.UserId == userId && item.CourseId == courseId, ct);
            // Preserve the position of a newer lesson opened in another tab.
            if (progress?.LastLessonId == lessonId) progress.UpdatedAt = await DatabaseTimeAsync(ct);
            await db.SaveChangesAsync(ct);
            return Summary(saved);
        }, ct);
        return new(result, true, review, Progress(await LessonLinksAsync(userId, courseId, ct)));
    }

    public async Task<ListeningResultsResponse> HistoryAsync(int userId, int courseId, int lessonId, ListeningResultsQuery query, CancellationToken ct)
    {
        await RequireLessonAsync(userId, courseId, lessonId, ct);
        var results = Results(userId, lessonId);
        var count = await results.CountAsync(ct);
        var page = await results.OrderByDescending(item => item.SubmittedAt).ThenByDescending(item => item.ResultId)
            .Skip((query.Page - 1) * query.PageSize).Take(query.PageSize).ToArrayAsync(ct);
        return new(page.Select(Summary).ToArray(), count, query.Page, query.PageSize, (int)Math.Ceiling((double)count / query.PageSize));
    }

    public async Task<ListeningResultResponse> ResultAsync(int userId, int courseId, int lessonId, int resultId, CancellationToken ct)
    {
        await RequireLessonAsync(userId, courseId, lessonId, ct);
        var result = await Results(userId, lessonId).SingleOrDefaultAsync(item => item.ResultId == resultId, ct)
            ?? throw new ListeningPracticeException(404, "Không tìm thấy kết quả bài làm.");
        ListeningWrongAnswersDocument? document = null;
        try { if (result.WrongAnswersJson is not null) document = JsonSerializer.Deserialize<ListeningWrongAnswersDocument>(result.WrongAnswersJson, ListeningGradingService.JsonOptions); }
        catch (JsonException) { }
        return new(Summary(result), false, document is { Version: 1, Questions: not null } ? document.Questions : [],
            Progress(await LessonLinksAsync(userId, courseId, ct)));
    }

    private IQueryable<ExerciseResult> Results(int userId, int lessonId) => db.ExerciseResults.AsNoTracking().Where(item => item.UserId == userId && item.LessonId == lessonId);

    private async Task<ListeningLessonLink[]> LessonLinksAsync(int userId, int courseId, CancellationToken ct) =>
        await db.Lessons.AsNoTracking().Where(item => item.CourseId == courseId && item.IsActive && item.SkillType == "listening")
            .OrderBy(item => item.OrderIndex).ThenBy(item => item.LessonId)
            .Select(item => new ListeningLessonLink(item.LessonId, item.Title,
                db.ExerciseResults.Any(result => result.UserId == userId && result.LessonId == item.LessonId))).ToArrayAsync(ct);

    private static ListeningCourseProgress Progress(ListeningLessonLink[] lessons)
    {
        var completed = lessons.Count(item => item.Completed);
        return new(completed, lessons.Length, lessons.Length == 0 ? 0 : decimal.Round(100m * completed / lessons.Length, 2));
    }

    private static ListeningResultSummary Summary(ExerciseResult result) => new(result.ResultId, result.Score,
        result.TotalQuestions, result.CorrectAnswers, result.TimeSpentSeconds, result.SubmittedAt);
    private static string FormatPosition(decimal position) => "listening:" + decimal.Round(position, 2).ToString(CultureInfo.InvariantCulture);
    private static decimal Position(LearningProgress? progress, int lessonId) => progress?.LastLessonId == lessonId &&
        progress.LastPosition?.StartsWith("listening:", StringComparison.Ordinal) == true &&
        decimal.TryParse(progress.LastPosition[10..], NumberStyles.Number, CultureInfo.InvariantCulture, out var value) && value is >= 0 and <= 86400 ? value : 0;
    private Task<DateTime> DatabaseTimeAsync(CancellationToken ct) => db.Database.SqlQuery<DateTime>($"SELECT SYSDATETIME() AS Value").SingleAsync(ct);

    private async Task<T> WriteAsync<T>(Func<Task<T>> write, CancellationToken ct)
    {
        // Integration tests may already own a rollback-only transaction.
        if (db.Database.CurrentTransaction is not null) return await write();
        for (var attempt = 0; ; attempt++)
        {
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
            try
            {
                var result = await write();
                await transaction.CommitAsync(ct);
                return result;
            }
            catch (Exception error) when (attempt < 2 && IsWriteConflict(error))
            {
                var sql = error as SqlException ?? error.InnerException as SqlException;
                // SQL Server has already rolled a deadlock victim back; its transaction may be completed.
                if (sql?.Number != 1205) await transaction.RollbackAsync(ct);
                db.ChangeTracker.Clear();
            }
        }
    }

    private static bool IsWriteConflict(Exception error) => error is SqlException { Number: 1205 or 2601 or 2627 } ||
        error is DbUpdateException { InnerException: SqlException { Number: 1205 or 2601 or 2627 } };
}
