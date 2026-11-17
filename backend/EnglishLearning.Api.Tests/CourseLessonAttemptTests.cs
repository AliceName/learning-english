using System.Net.Http.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using Microsoft.Extensions.DependencyInjection;

namespace EnglishLearning.Api.Tests;

public sealed partial class RegistrationSqlServerTests
{
    [SqlServerFact]
    public async Task Catalog_completion_includes_linked_reading_and_writing_results_without_other_users_or_hidden_lessons()
    {
        var fixture = await CreateCatalog();
        var courseId = fixture.Courses[0].CourseId;
        var otherUserId = fixture.Courses[3].CreatedBy!.Value;
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var lessons = new[]
        {
            new Lesson { CourseId = courseId, Title = "Own writing", SkillType = "writing" },
            new Lesson { CourseId = courseId, Title = "Other writing", SkillType = "writing" },
            new Lesson { CourseId = courseId, Title = "Own reading", SkillType = "reading" },
            new Lesson { CourseId = courseId, Title = "Other reading", SkillType = "reading" },
            new Lesson { CourseId = courseId, Title = "Hidden writing", SkillType = "writing", IsActive = false },
        };
        db.Lessons.AddRange(lessons);
        await db.SaveChangesAsync();
        db.WritingSubmissions.AddRange(
            new WritingSubmission { UserId = fixture.UserId, LessonId = lessons[0].LessonId, OriginalText = "First attempt." },
            new WritingSubmission { UserId = fixture.UserId, LessonId = lessons[0].LessonId, OriginalText = "Another attempt." },
            new WritingSubmission { UserId = otherUserId, LessonId = lessons[1].LessonId, OriginalText = "Another learner." },
            new WritingSubmission { UserId = fixture.UserId, LessonId = lessons[4].LessonId, OriginalText = "Hidden lesson." },
            new WritingSubmission { UserId = fixture.UserId, OriginalText = "Free writing without a course lesson." });
        db.ExerciseResults.AddRange(
            new ExerciseResult { UserId = fixture.UserId, LessonId = lessons[2].LessonId, Score = 0, TotalQuestions = 1 },
            new ExerciseResult { UserId = otherUserId, LessonId = lessons[3].LessonId, Score = 100, CorrectAnswers = 1, TotalQuestions = 1 });
        await db.SaveChangesAsync();

        var detail = (await client.GetFromJsonAsync<CourseDetailResponse>($"/api/v1/courses/{courseId}"))!;
        var completed = detail.Lessons.Where(lesson => lesson.HasAttempted).Select(lesson => lesson.LessonId).Order().ToArray();
        Assert.Equal(new[] { lessons[0].LessonId, lessons[2].LessonId }.Order(), completed);
        Assert.Equal(6, detail.Lessons.Count);
        Assert.DoesNotContain(detail.Lessons, lesson => lesson.LessonId == lessons[4].LessonId);
    }

    [SqlServerFact]
    public async Task Catalog_lesson_attempt_flags_use_own_saved_results_for_all_practice_types_even_when_score_is_zero()
    {
        await EnableGrammarInTestTransaction();
        var fixture = await CreateCatalog();
        var courseId = fixture.Courses[0].CourseId;
        var otherUserId = fixture.Courses[3].CreatedBy!.Value;
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var lessons = new[]
        {
            new Lesson { CourseId = courseId, Title = "Own listening", SkillType = "listening" },
            new Lesson { CourseId = courseId, Title = "Own grammar", SkillType = "grammar" },
            new Lesson { CourseId = courseId, Title = "Own speaking", SkillType = "speaking" },
            new Lesson { CourseId = courseId, Title = "Other listening", SkillType = "listening" },
            new Lesson { CourseId = courseId, Title = "Other grammar", SkillType = "grammar" },
            new Lesson { CourseId = courseId, Title = "Other speaking", SkillType = "speaking" },
        };
        db.Lessons.AddRange(lessons);
        await db.SaveChangesAsync();

        var url = $"/api/v1/courses/{courseId}";
        var initial = (await client.GetFromJsonAsync<CourseDetailResponse>(url))!;
        // Enrollment and course progress alone do not mean that a particular lesson was attempted.
        Assert.All(initial.Lessons, lesson => Assert.False(lesson.HasAttempted));

        foreach (var index in new[] { 0, 1, 3, 4 })
            db.ExerciseResults.Add(new ExerciseResult
            {
                UserId = index < 3 ? fixture.UserId : otherUserId, LessonId = lessons[index].LessonId,
                Score = 0, CorrectAnswers = 0, TotalQuestions = 1
            });
        foreach (var index in new[] { 2, 5 })
            db.SpeakingAttempts.Add(new SpeakingAttempt
            {
                UserId = index < 3 ? fixture.UserId : otherUserId, LessonId = lessons[index].LessonId,
                AudioUrl = "https://example.test/attempt.wav", OverallScore = 0
            });
        await db.SaveChangesAsync();

        var updated = (await client.GetFromJsonAsync<CourseDetailResponse>(url))!;
        var ownIds = lessons.Take(3).Select(lesson => lesson.LessonId).ToHashSet();
        Assert.All(updated.Lessons, lesson => Assert.Equal(ownIds.Contains(lesson.LessonId), lesson.HasAttempted));
        Assert.NotNull(updated.Lessons.Single(lesson => lesson.LessonId == lessons[0].LessonId).ListeningStatus);
        Assert.Null(updated.Lessons.Single(lesson => lesson.LessonId == lessons[1].LessonId).ListeningStatus);
        Assert.Equal(1, updated.ListeningProgress!.CompletedLessons);
        Assert.Equal(2, updated.ListeningProgress.TotalLessons);
    }
}
