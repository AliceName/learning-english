using System.Data;
using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Services;

public sealed class GrammarPracticeService(EnglishLearningDbContext db)
{
    private async Task<(Course Course, Lesson Lesson, GrammarContent Content)> RequireLessonAsync(int userId, int courseId, int lessonId, CancellationToken ct)
    {
        var course = await db.Courses.AsNoTracking().SingleOrDefaultAsync(item => item.CourseId == courseId &&
            item.IsPublished && (item.SourceType == "system" || item.CreatedBy == userId), ct)
            ?? throw new GrammarPracticeException(404, "Không tìm thấy khóa học.");
        var lesson = await db.Lessons.AsNoTracking().SingleOrDefaultAsync(item => item.LessonId == lessonId &&
            item.CourseId == courseId && item.IsActive && item.SkillType == "grammar", ct)
            ?? throw new GrammarPracticeException(404, "Không tìm thấy bài ngữ pháp.");
        return (course, lesson, GrammarGradingService.ReadContent(lesson));
    }

    public async Task<GrammarPracticeResponse> GetAsync(int userId, int courseId, int lessonId, CancellationToken ct)
    {
        var (course, lesson, content) = await RequireLessonAsync(userId, courseId, lessonId, ct);
        var latest = await db.ExerciseResults.AsNoTracking().Where(item => item.UserId == userId && item.LessonId == lessonId)
            .OrderByDescending(item => item.SubmittedAt).ThenByDescending(item => item.ResultId).FirstOrDefaultAsync(ct);
        var lessons = await db.Lessons.AsNoTracking().Where(item => item.CourseId == courseId && item.IsActive && item.SkillType == "grammar")
            .OrderBy(item => item.OrderIndex).ThenBy(item => item.LessonId)
            .Select(item => new GrammarLessonLink(item.LessonId, item.Title)).ToArrayAsync(ct);
        return new(courseId, course.Title, lessonId, lesson.Title, lesson.DifficultyLevel, lesson.EstimatedMinutes,
            GrammarGradingService.ContentVersion(lesson), content.Topic, content.Rules, content.CommonMistakes,
            GrammarGradingService.PublicQuestions(content), latest is null ? null : Summary(latest), lessons);
    }

    public async Task<GrammarResultResponse> SubmitAsync(int userId, int courseId, int lessonId, GrammarSubmissionRequest request, CancellationToken ct)
    {
        var (_, lesson, content) = await RequireLessonAsync(userId, courseId, lessonId, ct);
        var review = GrammarGradingService.Grade(lesson, content, request);
        // Serialize enrollment creation so simultaneous attempts cannot create duplicate memberships.
        if (db.Database.CurrentTransaction is not null) return await SaveAsync();
        for (var attempt = 0; ; attempt++)
        {
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
            try
            {
                var result = await SaveAsync();
                await transaction.CommitAsync(ct);
                return result;
            }
            catch (Exception error) when (attempt < 2 && (error is SqlException { Number: 1205 or 2601 or 2627 } ||
                error is DbUpdateException { InnerException: SqlException { Number: 1205 or 2601 or 2627 } }))
            {
                var sql = error as SqlException ?? error.InnerException as SqlException;
                if (sql?.Number != 1205) await transaction.RollbackAsync(ct);
                db.ChangeTracker.Clear();
            }
        }

        async Task<GrammarResultResponse> SaveAsync()
        {
            var enrollment = await db.UserCourses.SingleOrDefaultAsync(item => item.UserId == userId && item.CourseId == courseId, ct);
            if (enrollment is null) db.UserCourses.Add(new UserCourse { UserId = userId, CourseId = courseId });
            else if (enrollment.Status == "abandoned") enrollment.Status = "in_progress";
            var correct = review.Count(item => item.Correct);
            var saved = new ExerciseResult
            {
                UserId = userId, LessonId = lessonId, TotalQuestions = review.Length, CorrectAnswers = correct,
                Score = decimal.Round(100m * correct / review.Length, 2, MidpointRounding.AwayFromZero),
                TimeSpentSeconds = request.TimeSpentSeconds,
                WrongAnswersJson = JsonSerializer.Serialize(new GrammarWrongAnswersDocument(1, request.ContentVersion,
                    review.Where(item => !item.Correct).ToArray()), GrammarGradingService.JsonOptions)
            };
            db.ExerciseResults.Add(saved);
            await db.SaveChangesAsync(ct);
            return new(Summary(saved), review);
        }
    }

    private static GrammarResultSummary Summary(ExerciseResult result) => new(result.ResultId, result.Score,
        result.TotalQuestions, result.CorrectAnswers, result.TimeSpentSeconds, result.SubmittedAt);
}
