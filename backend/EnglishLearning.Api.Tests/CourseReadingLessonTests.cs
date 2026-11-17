using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services;
using EnglishLearning.Api.Services.AiCourses;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Tests;

public sealed class CourseReadingLessonTests
{
    [Theory]
    [InlineData("/api/media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png")]
    [InlineData("https://example.com/reading-chart.png")]
    [InlineData(null)]
    public async Task Learner_receives_authored_image_and_metadata_without_answers_translation_or_creating_an_attempt(string? imageUrl)
    {
        await using var db = Database();
        var content = new ReadingContent {
            PassageTitle = "A greener city", Passage = "Residents use electric buses.", Category = "Environment",
            ImageUrl = imageUrl, ImageAlt = "Public transport usage chart", ImageCaption = "Transport in Riverton",
            Translation = "Người dân sử dụng xe buýt điện.",
            Questions = [new() { Prompt = "What do residents use?", Options = ["Buses", "Trains"], CorrectOptionIndex = 0, Explanation = "Electric buses." }]
        };
        var lesson = await Seed(db, content);
        var service = Service(db);
        var result = await service.ReadingAsync(42, 1, 7, default);
        Assert.Equal(imageUrl, result.ImageUrl);
        Assert.Equal(content.ImageAlt, result.ImageAlt);
        Assert.Equal(content.ImageCaption, result.ImageCaption);
        Assert.Equal("Environment", result.Category);
        Assert.Equal(15, result.EstimatedMinutes);
        Assert.Null(result.Translation);
        Assert.Null(result.LatestResult);
        Assert.Empty(db.ExerciseResults);
        Assert.Empty(db.UserCourses);
        var json = JsonSerializer.Serialize(result, AiCourseStore.Json);
        Assert.DoesNotContain("correctOptionIndex", json);
        Assert.DoesNotContain("explanation", json);

        var submitted = await service.SubmitReadingAsync(42, 1, 7, new() {
            ContentVersion = result.ContentVersion, Answers = [new() { QuestionId = 0, OptionIndex = 0 }], TimeSpentSeconds = 30
        }, default);
        Assert.Equal(100, submitted.Result.Score);
        Assert.Equal(content.Translation, submitted.Translation);
        Assert.Single(db.ExerciseResults);
        var reloaded = await service.ReadingAsync(42, 1, 7, default);
        Assert.Equal(imageUrl, reloaded.ImageUrl);
        Assert.Equal(content.Translation, reloaded.Translation);
        Assert.Equal(100, reloaded.LatestResult!.Score);
        Assert.Equal(result.ContentVersion, ListeningGradingService.ContentVersion(lesson));
    }

    [Fact]
    public async Task Legacy_reading_without_image_fields_still_loads_and_hidden_or_private_lessons_remain_inaccessible()
    {
        await using var db = Database();
        var lesson = await Seed(db, new ReadingContent());
        lesson.Content = """{"version":1,"reading":{"passage":"An older reading lesson.","questions":[{"type":"multiple_choice","prompt":"Which lesson?","options":["Older","Newer"],"correctOptionIndex":0}]}}""";
        await db.SaveChangesAsync();
        var service = Service(db);
        var result = await service.ReadingAsync(42, 1, 7, default);
        Assert.Null(result.ImageUrl);
        Assert.Equal("", result.ImageAlt);
        var course = await db.Courses.SingleAsync();
        course.SourceType = "user_upload"; course.CreatedBy = 42;
        await db.SaveChangesAsync();
        Assert.Equal(404, (await Assert.ThrowsAsync<CourseTextLessonException>(() => service.ReadingAsync(43, 1, 7, default))).Status);
        lesson.IsActive = false;
        await db.SaveChangesAsync();
        Assert.Equal(404, (await Assert.ThrowsAsync<CourseTextLessonException>(() => service.ReadingAsync(42, 1, 7, default))).Status);
    }

    private static EnglishLearningDbContext Database() => new(new DbContextOptionsBuilder<EnglishLearningDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
    private static CourseTextLessonService Service(EnglishLearningDbContext db) => new(db,
        new(new ListeningGradingService(new EphemeralDataProtectionProvider())), new(new HttpClient()));
    private static async Task<Lesson> Seed(EnglishLearningDbContext db, ReadingContent content)
    {
        db.Courses.Add(new Course { CourseId = 1, Title = "Reading course" });
        var lesson = new Lesson { LessonId = 7, CourseId = 1, Title = "Reading lesson", SkillType = "reading", EstimatedMinutes = 15,
            Content = JsonSerializer.Serialize(new LessonContentDocument(1, null, null, Reading: content), AiCourseStore.Json) };
        db.Lessons.Add(lesson); await db.SaveChangesAsync(); return lesson;
    }
}
