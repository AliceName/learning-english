using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace EnglishLearning.Api.Tests;

/// <summary>Business rules of course deletion. Foreign-key order is exercised only on SQL Server.</summary>
public sealed class AdminCourseDeleteTests
{
    private sealed record Seed(HttpClient Admin, HttpClient Learner, WebApplicationFactory<Program> Factory, int AdminId, int LearnerId);

    private static async Task<Seed> Start()
    {
        var database = Guid.NewGuid().ToString();
        var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseEnvironment("Development")
                .ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Jwt:SigningKey"] = TestJwt.SigningKey, ["ConnectionStrings:DefaultConnection"] = "test-only"
                }))
                .ConfigureServices(services =>
                {
                    services.RemoveAll<EnglishLearningDbContext>();
                    services.AddScoped(_ => new EnglishLearningDbContext(new DbContextOptionsBuilder<EnglishLearningDbContext>()
                        .UseInMemoryDatabase(database).ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning)).Options));
                }));
        var admin = factory.CreateClient();
        var learner = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var a = new User { Email = "admin@example.test", FullName = "Admin", PasswordHash = "test", IsActive = true, Role = UserRoles.Admin };
        var b = new User { Email = "learner@example.test", FullName = "Learner", PasswordHash = "test", IsActive = true };
        db.Users.AddRange(a, b);
        await db.SaveChangesAsync();
        var tokens = scope.ServiceProvider.GetRequiredService<JwtTokenService>();
        admin.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.CreateToken(a).AccessToken);
        learner.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.CreateToken(b).AccessToken);
        return new(admin, learner, factory, a.UserId, b.UserId);
    }

    private static async Task<(int Course, int Lesson)> AddCourse(Seed seed, bool published, string source = "system")
    {
        using var scope = seed.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var course = new Course { Title = "Course", SourceType = source, IsPublished = published, CreatedBy = seed.AdminId };
        db.Courses.Add(course);
        await db.SaveChangesAsync();
        var lesson = new Lesson { CourseId = course.CourseId, Title = "Grammar 1", SkillType = "grammar" };
        db.Lessons.Add(lesson);
        await db.SaveChangesAsync();
        return (course.CourseId, lesson.LessonId);
    }

    private static async Task Use(Seed seed, Func<EnglishLearningDbContext, Task> action)
    {
        using var scope = seed.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        await action(db);
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Hidden_course_with_only_admin_test_data_is_deleted_with_its_lessons_results_and_decks()
    {
        var seed = await Start();
        await using var _ = seed.Factory;
        var (course, lesson) = await AddCourse(seed, published: false);
        var (other, otherLesson) = await AddCourse(seed, published: false);
        await Use(seed, async db =>
        {
            db.ExerciseResults.Add(new ExerciseResult { UserId = seed.AdminId, LessonId = lesson, Score = 100, TotalQuestions = 1, CorrectAnswers = 1 });
            var deck = new FlashcardDeck { UserId = seed.AdminId, CourseId = course, Title = "Course deck" };
            db.FlashcardDecks.Add(deck);
            await db.SaveChangesAsync();
            db.Flashcards.Add(new Flashcard { DeckId = deck.DeckId, FrontText = "word", BackText = "từ" });
        });

        using var response = await seed.Admin.DeleteAsync($"/api/v1/admin/courses/{course}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(course, (await response.Content.ReadFromJsonAsync<AdminCourseDeleted>())!.CourseId);
        await Use(seed, async db =>
        {
            Assert.False(await db.Courses.AnyAsync(item => item.CourseId == course));
            Assert.False(await db.Lessons.AnyAsync(item => item.LessonId == lesson));
            Assert.False(await db.ExerciseResults.AnyAsync(item => item.LessonId == lesson));
            Assert.False(await db.FlashcardDecks.AnyAsync(item => item.CourseId == course));
            Assert.True(await db.Lessons.AnyAsync(item => item.LessonId == otherLesson && item.CourseId == other));
        });
    }

    [Fact]
    public async Task Published_courses_learner_data_non_admins_and_personal_courses_are_refused()
    {
        var seed = await Start();
        await using var _ = seed.Factory;
        var (published, _) = await AddCourse(seed, published: true);
        Assert.Equal(HttpStatusCode.Conflict, (await seed.Admin.DeleteAsync($"/api/v1/admin/courses/{published}")).StatusCode);

        var (used, usedLesson) = await AddCourse(seed, published: false);
        await Use(seed, db => { db.ExerciseResults.Add(new ExerciseResult { UserId = seed.LearnerId, LessonId = usedLesson, Score = 50, TotalQuestions = 2, CorrectAnswers = 1 }); return Task.CompletedTask; });
        Assert.Equal(HttpStatusCode.Conflict, (await seed.Admin.DeleteAsync($"/api/v1/admin/courses/{used}")).StatusCode);

        var (copied, _) = await AddCourse(seed, published: false);
        await Use(seed, db => { db.FlashcardDecks.Add(new FlashcardDeck { UserId = seed.LearnerId, CourseId = copied, Title = "My copy" }); return Task.CompletedTask; });
        Assert.Equal(HttpStatusCode.Conflict, (await seed.Admin.DeleteAsync($"/api/v1/admin/courses/{copied}")).StatusCode);

        var (hidden, _) = await AddCourse(seed, published: false);
        Assert.Equal(HttpStatusCode.Forbidden, (await seed.Learner.DeleteAsync($"/api/v1/admin/courses/{hidden}")).StatusCode);
        var (personal, _) = await AddCourse(seed, published: false, source: "user_upload");
        Assert.Equal(HttpStatusCode.NotFound, (await seed.Admin.DeleteAsync($"/api/v1/admin/courses/{personal}")).StatusCode);

        await Use(seed, async db =>
        {
            foreach (var id in new[] { published, used, copied, hidden, personal })
                Assert.True(await db.Courses.AnyAsync(item => item.CourseId == id));
            Assert.True(await db.ExerciseResults.AnyAsync(item => item.LessonId == usedLesson));
        });
    }
}
