using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace EnglishLearning.Api.Tests;

public sealed class AdminContentStatsTests : IAsyncLifetime
{
    private const string TaskOne = "11111111-1111-4111-8111-111111111111", TaskTwo = "22222222-2222-4222-8222-222222222222";
    private readonly string root = Path.Combine(Path.GetTempPath(), "lewa-admin-stats-" + Guid.NewGuid().ToString("N"));
    private WebApplicationFactory<Program> factory = null!;
    private HttpClient admin = null!, learner = null!;
    private int courseId, otherCourseId, grammarId, speakingId;

    public async Task InitializeAsync()
    {
        var database = Guid.NewGuid().ToString();
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseEnvironment("Development")
                .ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Jwt:SigningKey"] = TestJwt.SigningKey, ["ConnectionStrings:DefaultConnection"] = "test-only",
                    ["AdminAudit:Root"] = Path.Combine(root, "audit"), ["CourseGeneration:DataRoot"] = Path.Combine(root, "ai"),
                    // No catalogue: tasks are named from the snapshot saved with each essay.
                    ["WritingTasks:CataloguePath"] = Path.Combine(root, "missing-catalogue.json"),
                }))
                .ConfigureServices(services =>
                {
                    services.RemoveAll<EnglishLearningDbContext>();
                    services.AddScoped(_ => new EnglishLearningDbContext(new DbContextOptionsBuilder<EnglishLearningDbContext>()
                        .UseInMemoryDatabase(database).ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning)).Options));
                }));
        admin = factory.CreateClient();
        learner = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var a = new User { Email = "admin@school.vn", FullName = "Quản trị", PasswordHash = "x", IsActive = true, Role = UserRoles.Admin };
        var b = new User { Email = "lan@gmail.com", FullName = "Nguyễn Lan", PasswordHash = "x", IsActive = true };
        var c = new User { Email = "minh@gmail.com", FullName = "Trần Minh", PasswordHash = "x", IsActive = true };
        var d = new User { Email = "d@example.test", FullName = "Người D", PasswordHash = "x", IsActive = true };
        db.Users.AddRange(a, b, c, d);
        var course = new Course { Title = "Khóa hệ thống", SourceType = "system", IsPublished = true };
        var other = new Course { Title = "Khóa AI", SourceType = "ai", IsPublished = true };
        db.Courses.AddRange(course, other);
        await db.SaveChangesAsync();
        var grammar = new Lesson { CourseId = course.CourseId, Title = "Thì hiện tại", SkillType = "grammar", OrderIndex = 0, Content = "{}" };
        var speaking = new Lesson { CourseId = course.CourseId, Title = "Nói về bản thân", SkillType = "speaking", OrderIndex = 1, Content = "{}" };
        db.Lessons.AddRange(grammar, speaking);
        await db.SaveChangesAsync();
        (courseId, otherCourseId, grammarId, speakingId) = (course.CourseId, other.CourseId, grammar.LessonId, speaking.LessonId);

        var first = Essay(b.UserId, TaskOne, null, "PREP", "VERB", offTopic: false);
        db.WritingSubmissions.Add(first);
        await db.SaveChangesAsync();
        db.WritingSubmissions.AddRange(
            Essay(b.UserId, TaskOne, first.SubmissionId, "PREP", null, offTopic: false),
            Essay(c.UserId, TaskOne, null, null, null, offTopic: true),
            Essay(c.UserId, TaskTwo, null, null, null, offTopic: null),
            Essay(d.UserId, TaskOne, null, "SPELL", null, offTopic: true));

        db.UserCourses.AddRange(new UserCourse { UserId = b.UserId, CourseId = course.CourseId },
            new UserCourse { UserId = c.UserId, CourseId = course.CourseId }, new UserCourse { UserId = d.UserId, CourseId = course.CourseId });
        var version = GrammarGradingService.ContentVersion(grammar);
        db.ExerciseResults.AddRange(
            Result(b.UserId, 90, 60, $$"""{"version":1,"contentVersion":"{{version}}","questions":[{"questionId":2,"prompt":"Chọn dạng đúng của động từ"}]}"""),
            Result(c.UserId, 50, 120, $$"""{"version":1,"contentVersion":"{{version}}","questions":[{"questionId":2},{"questionId":3}]}"""),
            // Answers to older content are not counted in the most-missed list.
            Result(b.UserId, 70, null, """{"version":1,"contentVersion":"OLD","questions":[{"questionId":9}]}"""),
            Result(d.UserId, 0, 30, $$"""{"version":1,"contentVersion":"{{version}}","questions":[{"questionId":7}]}"""));
        db.SpeakingAttempts.Add(new SpeakingAttempt { UserId = b.UserId, LessonId = speaking.LessonId, AudioUrl = "a.wav", OverallScore = 85, DurationSeconds = 9 });
        await db.SaveChangesAsync();
        var tokens = scope.ServiceProvider.GetRequiredService<JwtTokenService>();
        admin.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.CreateToken(a).AccessToken);
        learner.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.CreateToken(b).AccessToken);
    }

    private ExerciseResult Result(int user, decimal score, int? seconds, string wrong) => new()
    { UserId = user, LessonId = grammarId, Score = score, TotalQuestions = 5, CorrectAnswers = 3, TimeSpentSeconds = seconds, WrongAnswersJson = wrong };

    /// <summary>Ten words, with up to two corrections of the given categories.</summary>
    private static WritingSubmission Essay(int user, string task, int? rootId, string? category1, string? category2, bool? offTopic)
    {
        var explanations = string.Join(",", new[] { category1, category2 }.OfType<string>().Select(category => $$"""{"category":"{{category}}"}"""));
        var relevance = offTopic is null ? "" : $$""","relevance":{"offTopic":{{(offTopic.Value ? "true" : "false")}}}""";
        return new WritingSubmission
        {
            UserId = user, OriginalText = "I have listened their songs for many years and I'm happy.",
            CreatedAt = DateTime.UtcNow,
            ErrorsJson = $$"""{"task":{"id":"{{task}}","title":"Đề {{task[..1]}}","genre":"A letter","level":"Intermediate","topic":"Music"},"practice":{"rootSubmissionId":{{(rootId?.ToString() ?? "null")}}},"errors":[{"explanations":[{{explanations}}]}]{{relevance}}}""",
        };
    }

    public async Task DisposeAsync()
    {
        await factory.DisposeAsync();
        if (Directory.Exists(root)) Directory.Delete(root, true);
    }

    [Fact]
    public async Task Writing_task_stats_use_first_versions_of_real_learners_and_never_return_text()
    {
        using var response = await admin.GetAsync("/api/v1/admin/stats/writing-tasks");
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, body);
        Assert.DoesNotContain("listened their songs", body);
        var report = (await response.Content.ReadFromJsonAsync<AdminWritingTaskReport>())!;
        Assert.False(report.CatalogueLoaded);
        Assert.Equal((2, 2), (report.CountedLearners, report.ExcludedAccounts));
        var one = report.Tasks[0];
        Assert.Equal((TaskOne, "Đề 1", false), (one.TaskId, one.Title, one.InCatalogue));
        // b and c wrote it; d is a test account. b revised once.
        Assert.Equal((2, 2, 1), (one.Learners, one.Rounds, one.RevisedRounds));
        // "I'm" is one word: 11 words per essay, 2 corrections over 22 words.
        Assert.Equal((22, 2, 9.1m), (one.WordsChecked, one.Errors, one.ErrorsPer100Words));
        Assert.Equal((2, 1), (one.RelevanceChecked, one.OffTopic));
        Assert.Equal(["PREP", "VERB"], one.TopCategories.Select(item => item.Category));
        var two = Assert.Single(report.Tasks, task => task.TaskId == TaskTwo);
        Assert.Equal((1, 0, 0), (two.Learners, two.RelevanceChecked, two.Errors));
        Assert.Equal(HttpStatusCode.Forbidden, (await learner.GetAsync("/api/v1/admin/stats/writing-tasks")).StatusCode);
    }

    [Fact]
    public async Task Course_stats_count_real_learners_and_only_current_content_for_missed_questions()
    {
        var stats = (await admin.GetFromJsonAsync<AdminCourseStats>($"/api/v1/admin/courses/{courseId}/stats"))!;
        Assert.Equal(2, stats.Enrolled);
        var grammar = Assert.Single(stats.Lessons, lesson => lesson.LessonId == grammarId);
        Assert.Equal((2, 3, 70m, 90, 33m, 0), (grammar.Learners, grammar.Attempts, grammar.AverageScore, grammar.AverageSeconds, grammar.PassRate, grammar.NotStarted));
        Assert.Equal(2, grammar.CurrentVersionAttempts);
        Assert.Equal([(2, 2), (3, 1)], grammar.MostMissed.Select(item => (item.QuestionId, item.Misses)));
        Assert.Equal("Chọn dạng đúng của động từ", grammar.MostMissed[0].Prompt);

        var speaking = Assert.Single(stats.Lessons, lesson => lesson.LessonId == speakingId);
        Assert.Equal((1, 85m, 1), (speaking.Learners, speaking.AverageScore, speaking.NotStarted));

        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"/api/v1/admin/courses/{otherCourseId}/stats")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await learner.GetAsync($"/api/v1/admin/courses/{courseId}/stats")).StatusCode);
    }
}
