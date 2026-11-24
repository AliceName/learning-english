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

public sealed class AdminOverviewTests : IAsyncLifetime
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "lewa-admin-overview-" + Guid.NewGuid().ToString("N"));
    private WebApplicationFactory<Program> factory = null!;
    private HttpClient admin = null!, learner = null!;

    public async Task InitializeAsync()
    {
        var database = Guid.NewGuid().ToString();
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseEnvironment("Development")
                .ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Jwt:SigningKey"] = TestJwt.SigningKey, ["ConnectionStrings:DefaultConnection"] = "test-only",
                    ["AdminAudit:Root"] = Path.Combine(root, "audit"), ["CourseGeneration:DataRoot"] = Path.Combine(root, "ai"),
                    // Nothing listens on port 1: both local AI services must show as down, not fail the request.
                    ["WritingAi:BaseUrl"] = "http://127.0.0.1:1/", ["SpeakingAi:BaseUrl"] = "http://127.0.0.1:1", ["SpeakingAi:ApiToken"] = "",
                    ["CourseGenerationAi:ApiKey"] = "", ["TranslationAi:ApiKey"] = "",
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
        var now = DateTime.UtcNow;
        var a = new User { Email = "admin@school.vn", FullName = "Quản trị", PasswordHash = "x", IsActive = true, Role = UserRoles.Admin, CreatedAt = now };
        var b = new User { Email = "lan@gmail.com", FullName = "Nguyễn Lan", PasswordHash = "x", IsActive = true, CreatedAt = now.AddDays(-2) };
        var c = new User { Email = "c@example.test", FullName = "Người C", PasswordHash = "x", IsActive = true, CreatedAt = now };
        var d = new User { Email = "d@school.vn", FullName = "Học viên Test", PasswordHash = "x", IsActive = true, CreatedAt = now };
        var e = new User { Email = "minh@gmail.com", FullName = "Trần Minh", PasswordHash = "x", IsActive = false, CreatedAt = now.AddDays(-40) };
        db.Users.AddRange(a, b, c, d, e);
        await db.SaveChangesAsync();
        var today = DateOnly.FromDateTime(now.AddHours(7));
        db.UserLearningDays.AddRange(
            new UserLearningDay { UserId = b.UserId, StudyDate = today, Kind = LearningKind.Writing },
            new UserLearningDay { UserId = b.UserId, StudyDate = today.AddDays(-1), Kind = LearningKind.Flashcards },
            new UserLearningDay { UserId = c.UserId, StudyDate = today, Kind = LearningKind.Writing },
            new UserLearningDay { UserId = e.UserId, StudyDate = today.AddDays(-10), Kind = LearningKind.Speaking },
            new UserLearningDay { UserId = e.UserId, StudyDate = today.AddDays(-45), Kind = LearningKind.Speaking });
        db.WritingSubmissions.AddRange(
            new WritingSubmission { UserId = b.UserId, OriginalText = "x", CreatedAt = now, ErrorsJson = """{"practice":{"rootSubmissionId":null}}""" },
            new WritingSubmission { UserId = b.UserId, OriginalText = "x", CreatedAt = now, ErrorsJson = """{"practice":{"rootSubmissionId":5}}""" },
            new WritingSubmission { UserId = b.UserId, OriginalText = "x", CreatedAt = now.AddDays(-20) },
            new WritingSubmission { UserId = c.UserId, OriginalText = "x", CreatedAt = now });
        await db.SaveChangesAsync();
        var tokens = scope.ServiceProvider.GetRequiredService<JwtTokenService>();
        admin.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.CreateToken(a).AccessToken);
        learner.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.CreateToken(b).AccessToken);
    }

    public async Task DisposeAsync()
    {
        await factory.DisposeAsync();
        if (Directory.Exists(root)) Directory.Delete(root, true);
    }

    [Fact]
    public async Task Overview_counts_only_real_learners_and_is_admin_only()
    {
        var overview = (await admin.GetFromJsonAsync<AdminOverview>("/api/v1/admin/overview"))!;
        // Admin, the @example.test account and the "Test" name are left out.
        Assert.Equal((2, 3), (overview.CountedLearners, overview.ExcludedAccounts));
        var activity = overview.Activity;
        Assert.Equal((1, 1, 2), (activity.LearnersToday, activity.Learners7Days, activity.Learners30Days));
        Assert.Equal((1, 1), (activity.NewAccounts7Days, activity.NewAccounts30Days));
        Assert.Equal((2, 1, 3), (activity.Essays7Days, activity.Revisions7Days, activity.Essays30Days));
        Assert.Equal((0, 0), (activity.AiCalls7Days, activity.AiErrors7Days));

        Assert.Equal(AdminOverviewService.DailyWindow, overview.Daily.Count);
        Assert.Equal((overview.Today, 1), (overview.Daily[^1].Date, overview.Daily[^1].Learners));
        Assert.Equal(["flashcards", "speaking", "writing"], overview.Skills.Select(skill => skill.Kind).Order().ToArray());
        var locked = Assert.Single(overview.Attention);
        Assert.Equal(("locked_accounts", 1), (locked.Kind, locked.Count));

        Assert.Equal(HttpStatusCode.Forbidden, (await learner.GetAsync("/api/v1/admin/overview")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await learner.GetAsync("/api/v1/admin/overview/services")).StatusCode);
    }

    [Fact]
    public async Task Services_report_unreachable_ai_as_down_never_call_outside_providers_and_are_cached()
    {
        var report = (await admin.GetFromJsonAsync<AdminServiceReport>("/api/v1/admin/overview/services"))!;
        var status = report.Services.ToDictionary(service => service.Key, service => service.Status);
        Assert.Equal("ok", status["database"]);
        Assert.Equal(("down", "down"), (status["writing_ai"], status["speaking_ai"]));
        Assert.Equal(("unconfigured", "unconfigured"), (status["course_ai"], status["translation_ai"]));

        var again = (await admin.GetFromJsonAsync<AdminServiceReport>("/api/v1/admin/overview/services?refresh=true"))!;
        // A refresh within a few seconds returns the cached report instead of probing again.
        Assert.Equal(report.CheckedAt, again.CheckedAt);
    }
}
