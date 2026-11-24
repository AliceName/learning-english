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

namespace EnglishLearning.Api.Tests;

public sealed class WritingPracticeDeleteTests
{
    private const string Submissions = "/api/v1/writing/submissions";

    [Fact]
    public async Task Deleting_a_round_removes_all_its_versions_only_for_the_owner()
    {
        var database = Guid.NewGuid().ToString();
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseEnvironment("Development")
                .ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Jwt:SigningKey"] = TestJwt.SigningKey, ["ConnectionStrings:DefaultConnection"] = "test-only"
                }))
                .ConfigureServices(services =>
                {
                    services.RemoveAll<EnglishLearningDbContext>();
                    services.AddScoped(_ => new EnglishLearningDbContext(new DbContextOptionsBuilder<EnglishLearningDbContext>()
                        .UseInMemoryDatabase(database).Options));
                    services.AddHttpClient<WritingAiClient>().ConfigurePrimaryHttpMessageHandler(() => new WritingVersionTests.WritingHandler());
                }));
        using var owner = factory.CreateClient();
        using var other = factory.CreateClient();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
            var a = new User { Email = "owner@example.test", FullName = "Owner", PasswordHash = "test", IsActive = true };
            var b = new User { Email = "other@example.test", FullName = "Other", PasswordHash = "test", IsActive = true };
            db.Users.AddRange(a, b);
            await db.SaveChangesAsync();
            var tokens = scope.ServiceProvider.GetRequiredService<JwtTokenService>();
            owner.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.CreateToken(a).AccessToken);
            other.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.CreateToken(b).AccessToken);
        }

        var first = await Submit(owner, new { topic = "Round one", originalText = "First version." });
        var second = await Submit(owner, new { parentSubmissionId = first.SubmissionId, originalText = "Second version." });
        var kept = await Submit(owner, new { topic = "Round two", originalText = "Another round." });

        Assert.Equal(HttpStatusCode.NotFound, (await other.DeleteAsync($"/api/v1/writing/practices/{first.SubmissionId}")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.DeleteAsync($"/api/v1/writing/practices/{second.SubmissionId}")).StatusCode);

        using var deleted = await owner.DeleteAsync($"/api/v1/writing/practices/{first.SubmissionId}");
        Assert.Equal(HttpStatusCode.OK, deleted.StatusCode);
        var body = (await deleted.Content.ReadFromJsonAsync<WritingPracticeDeleted>())!;
        Assert.Equal((first.SubmissionId, 2), (body.PracticeRootId, body.DeletedSubmissions));
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync($"{Submissions}/{first.SubmissionId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync($"{Submissions}/{second.SubmissionId}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.GetAsync($"{Submissions}/{kept.SubmissionId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.DeleteAsync($"/api/v1/writing/practices/{first.SubmissionId}")).StatusCode);
    }

    private static async Task<WritingSubmissionResponse> Submit(HttpClient client, object request)
    {
        using var result = await client.PostAsJsonAsync(Submissions, request);
        Assert.Equal(HttpStatusCode.Created, result.StatusCode);
        return (await result.Content.ReadFromJsonAsync<WritingSubmissionResponse>())!;
    }
}
