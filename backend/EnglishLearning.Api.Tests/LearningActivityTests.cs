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
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Tests;

public sealed class LearningActivityTests
{
    [Fact]
    public async Task Calendar_groups_activity_by_Vietnam_day_and_keeps_user_history_private()
    {
        var clock = new StudyClock(new DateTimeOffset(2026, 12, 31, 16, 59, 0, TimeSpan.Zero));
        var database = Guid.NewGuid().ToString();
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder
            .UseEnvironment("Development")
            .ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:SigningKey"] = TestJwt.SigningKey, ["ConnectionStrings:DefaultConnection"] = "test-only",
            }))
            .ConfigureServices(services =>
            {
                services.RemoveAll<EnglishLearningDbContext>();
                services.AddScoped(_ => new EnglishLearningDbContext(new DbContextOptionsBuilder<EnglishLearningDbContext>()
                    .UseInMemoryDatabase(database).Options));
                services.RemoveAll<TimeProvider>();
                services.AddSingleton<TimeProvider>(clock);
            }));
        using var client = factory.CreateClient();
        const string endpoint = "/api/v1/learning-activity";
        User owner = new() { Email = "learner@example.test", FullName = "Learner", CreatedAt = new DateTime(2025, 12, 31) };
        User other = new() { Email = "other@example.test", FullName = "Other", CreatedAt = owner.CreatedAt };
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
            db.Users.AddRange(owner, other);
            await db.SaveChangesAsync();
            db.WritingSubmissions.Add(new WritingSubmission
            {
                UserId = owner.UserId, OriginalText = "An old lesson.", CreatedAt = new DateTime(2025, 12, 31),
            });
            await db.SaveChangesAsync();
        }

        var jwt = new JwtTokenService(factory.Services.GetRequiredService<IOptions<JwtOptions>>(), TimeProvider.System);
        void SignIn(User user) =>
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", jwt.CreateToken(user).AccessToken);

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(endpoint)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync(endpoint + "/reading", null)).StatusCode);
        SignIn(owner);
        Assert.Empty((await client.GetFromJsonAsync<LearningCalendar>(endpoint + "?year=2025"))!.Days);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync(endpoint + "?year=2024")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync(endpoint + "/translation", null)).StatusCode);
        foreach (var kind in new[] { "reading", "reading", "grammar" })
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync(endpoint + "/" + kind, null)).StatusCode);
        var firstDay = (await client.GetFromJsonAsync<LearningCalendar>(endpoint))!;
        Assert.Equal(new DateOnly(2026, 12, 31), firstDay.Today);
        Assert.Equal(new DateOnly(2025, 12, 31), firstDay.FirstDay);
        Assert.Equal(new StreakSummary(1, 1, true), firstDay.Streak);
        Assert.Equal(new[] { "reading", "grammar" }, Assert.Single(firstDay.Days).Activities);

        clock.UtcNow = clock.UtcNow.AddMinutes(1);
        var newYear = (await client.GetFromJsonAsync<LearningCalendar>(endpoint))!;
        Assert.Equal(2027, newYear.Year);
        Assert.Equal(new StreakSummary(1, 1, false), newYear.Streak);
        Assert.Empty(newYear.Days);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync(endpoint + "/flashcards", null)).StatusCode);
        Assert.Equal(new StreakSummary(2, 2, true), (await client.GetFromJsonAsync<LearningCalendar>(endpoint))!.Streak);
        Assert.Equal(2, (await client.GetFromJsonAsync<CurrentUserResponse>("/api/v1/auth/me"))!.CurrentStreak);

        clock.UtcNow = clock.UtcNow.AddDays(2);
        Assert.Equal(new StreakSummary(0, 2, false), (await client.GetFromJsonAsync<LearningCalendar>(endpoint))!.Streak);
        Assert.Equal(0, (await client.GetFromJsonAsync<CurrentUserResponse>("/api/v1/auth/me"))!.CurrentStreak);
        SignIn(other);
        var isolated = (await client.GetFromJsonAsync<LearningCalendar>(endpoint))!;
        Assert.Empty(isolated.Days);
        Assert.Equal(new StreakSummary(0, 0, false), isolated.Streak);
    }

    private sealed class StudyClock(DateTimeOffset instant) : TimeProvider
    {
        public DateTimeOffset UtcNow { get; set; } = instant;
        public override DateTimeOffset GetUtcNow() => UtcNow;
    }
}

public sealed partial class RegistrationSqlServerTests
{
    [SqlServerFact]
    public async Task Daily_activity_is_deduplicated_in_SqlServer()
    {
        var login = await SignIn(await RegisterLoginUser());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);
        const string endpoint = "/api/v1/learning-activity";
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync(endpoint + "/reading", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync(endpoint + "/reading", null)).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync(endpoint + "/flashcards", null)).StatusCode);
        var after = (await client.GetFromJsonAsync<LearningCalendar>(endpoint))!;
        Assert.Equal(new[] { "reading", "flashcards" }, Assert.Single(after.Days).Activities);
        Assert.Equal(new StreakSummary(1, 1, true), after.Streak);
    }
}
