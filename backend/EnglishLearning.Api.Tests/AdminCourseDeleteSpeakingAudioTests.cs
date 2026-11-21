using System.Net;
using System.Net.Http.Headers;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services;
using EnglishLearning.Api.Services.CloudinaryMedia;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Tests;

public sealed class AdminCourseDeleteSpeakingAudioTests
{
    [Fact]
    public async Task Deleting_a_course_removes_its_admin_test_recordings_from_cloud_storage()
    {
        var remote = new MemoryCloudTransport();
        await using var factory = Factory(remote, failCourseDelete: false);
        var (course, deleted, kept) = await SeedAsync(factory);
        Assert.Equal(4, remote.Items.Count);

        using var response = await Admin(factory).DeleteAsync($"/api/v1/admin/courses/{course}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.DoesNotContain("els/test/speaking/recordings/" + Reference(deleted), remote.Items.Keys);
        Assert.DoesNotContain("els/test/speaking/references/" + Reference(deleted) + ".json", remote.Items.Keys);
        Assert.Contains("els/test/speaking/recordings/" + Reference(kept), remote.Items.Keys);
        Assert.Equal(2, remote.Items.Count);
    }

    [Fact]
    public async Task A_failed_course_delete_keeps_the_recordings_its_attempts_still_point_to()
    {
        var remote = new MemoryCloudTransport();
        await using var factory = Factory(remote, failCourseDelete: true);
        var (course, deleted, _) = await SeedAsync(factory);

        using var response = await Admin(factory).DeleteAsync($"/api/v1/admin/courses/{course}");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Contains("els/test/speaking/recordings/" + Reference(deleted), remote.Items.Keys);
        Assert.Equal(4, remote.Items.Count);
    }

    private static string Reference(string url) => url[^36..^4];

    private static WebApplicationFactory<Program> Factory(MemoryCloudTransport remote, bool failCourseDelete)
    {
        var database = Guid.NewGuid().ToString();
        return new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseEnvironment("Development").ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?> {
                    ["Jwt:SigningKey"] = TestJwt.SigningKey, ["ConnectionStrings:DefaultConnection"] = "test-only",
                    ["Cloudinary:Enabled"] = "true", ["Cloudinary:AllowLegacyReads"] = "false",
                    ["SpeakingStorage:RootPath"] = Path.Combine(Path.GetTempPath(), "els-course-delete-" + Guid.NewGuid().ToString("N")) }))
            .ConfigureServices(services => {
                services.RemoveAll<EnglishLearningDbContext>();
                services.AddScoped(_ =>
                {
                    var options = new DbContextOptionsBuilder<EnglishLearningDbContext>().UseInMemoryDatabase(database)
                        .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning));
                    if (failCourseDelete) options.AddInterceptors(new FailCourseRemoval());
                    return new EnglishLearningDbContext(options.Options);
                });
                services.RemoveAll<ICloudMediaStore>();
                services.AddSingleton<ICloudMediaStore>(_ => new CloudinaryMediaStore(remote,
                    Options.Create(new CloudinarySettings { EnvironmentPrefix = "els/test" }), Options.Create(new CloudinaryMediaOptions()), TimeProvider.System));
            }));
    }

    /// <summary>A hidden course with one recorded and one unrecorded admin attempt, and another course's recording.</summary>
    private static async Task<(int Course, string Deleted, string Kept)> SeedAsync(WebApplicationFactory<Program> factory)
    {
        var storage = factory.Services.GetRequiredService<SpeakingStorage>();
        var deleted = await storage.SaveAsync(AudioFixture.Wave(), default);
        var kept = await storage.SaveAsync(AudioFixture.Wave(), default);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var admin = new User { Email = "admin@example.test", FullName = "Admin", PasswordHash = "test", IsActive = true, Role = UserRoles.Admin };
        db.Users.Add(admin);
        var hidden = new Course { Title = "Hidden", SourceType = "system", IsPublished = false };
        var other = new Course { Title = "Other", SourceType = "system", IsPublished = false };
        db.Courses.AddRange(hidden, other);
        await db.SaveChangesAsync();
        var lesson = new Lesson { CourseId = hidden.CourseId, Title = "Speaking", SkillType = "speaking" };
        var otherLesson = new Lesson { CourseId = other.CourseId, Title = "Speaking", SkillType = "speaking" };
        db.Lessons.AddRange(lesson, otherLesson);
        await db.SaveChangesAsync();
        db.SpeakingAttempts.AddRange(
            new SpeakingAttempt { UserId = admin.UserId, LessonId = lesson.LessonId, AudioUrl = deleted, Feedback = "" },
            new SpeakingAttempt { UserId = admin.UserId, LessonId = lesson.LessonId, AudioUrl = "", Feedback = "" },
            new SpeakingAttempt { UserId = admin.UserId, LessonId = otherLesson.LessonId, AudioUrl = kept, Feedback = "" });
        await db.SaveChangesAsync();
        return (hidden.CourseId, deleted, kept);
    }

    private static HttpClient Admin(WebApplicationFactory<Program> factory)
    {
        using var scope = factory.Services.CreateScope();
        var admin = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>().Users.Single(user => user.Role == UserRoles.Admin);
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer",
            factory.Services.GetRequiredService<JwtTokenService>().CreateToken(admin).AccessToken);
        return client;
    }

    /// <summary>Fails the save that removes the course, after its attempts were already removed in an earlier save.</summary>
    private sealed class FailCourseRemoval : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result,
            CancellationToken cancellationToken = default) =>
            eventData.Context!.ChangeTracker.Entries<Course>().Any(entry => entry.State == EntityState.Deleted)
                ? throw new DbUpdateException("Simulated failure while deleting the course.")
                : ValueTask.FromResult(result);
    }
}
