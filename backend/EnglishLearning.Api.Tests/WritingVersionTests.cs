using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
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

public sealed class WritingVersionTests
{
    private const string Submissions = "/api/v1/writing/submissions";

    [Fact]
    public async Task Versions_branch_from_old_sources_keep_targets_and_replay_safely()
    {
        var database = Guid.NewGuid().ToString();
        var ai = new WritingHandler();
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
                    services.AddHttpClient<WritingAiClient>().ConfigurePrimaryHttpMessageHandler(() => ai);
                }));
        await VerifyVersions(factory, ai, "owner@example.test", "other@example.test");
    }

    internal static async Task VerifyVersions(WebApplicationFactory<Program> factory, WritingHandler ai, string ownerEmail, string otherEmail)
    {
        using var ownerClient = factory.CreateClient();
        using var otherClient = factory.CreateClient();
        int legacyId;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
            var owner = new User { Email = ownerEmail, FullName = "Owner", PasswordHash = "test", TargetLevel = "B2", IsActive = true };
            var other = new User { Email = otherEmail, FullName = "Other", PasswordHash = "test", IsActive = true };
            db.Users.AddRange(owner, other);
            await db.SaveChangesAsync();
            var legacyRow = new WritingSubmission { UserId = owner.UserId, Topic = "Shared topic", OriginalText = "Legacy text.",
                ErrorsJson = """[{"original":"Legacy text.","suggestion":"Earlier text."}]""", CorrectedText = "Earlier text.", CefrLevel = "A2" };
            db.WritingSubmissions.Add(legacyRow);
            await db.SaveChangesAsync();
            legacyId = legacyRow.SubmissionId;
            var tokens = scope.ServiceProvider.GetRequiredService<JwtTokenService>();
            ownerClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.CreateToken(owner).AccessToken);
            otherClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.CreateToken(other).AccessToken);
        }

        var key = Guid.NewGuid();
        var firstRequest = new { topic = "Shared topic", originalText = "My first version.", corrections = true, requestId = key };
        var first = await Submit(ownerClient, firstRequest);
        Assert.Equal(1, first.VersionNumber);
        Assert.Equal("B2", first.TargetCefr);
        Assert.Equal("A2", first.CefrLevel);
        Assert.Equal(first.SubmissionId, first.PracticeRootId);
        Assert.Null(first.ParentSubmissionId);
        Assert.Equal("My first version. Corrected.", first.CorrectedText);
        async Task SetProfileTarget(string? targetLevel)
        {
            using var updated = await ownerClient.PutAsJsonAsync("/api/v1/auth/me", new { fullName = "Owner", targetLevel });
            Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        }

        Assert.Equal(HttpStatusCode.BadRequest, (await ownerClient.PostAsJsonAsync(Submissions,
            new { originalText = "Cannot override the profile.", targetCefr = "A1" })).StatusCode);
        await SetProfileTarget("C1");
        var second = await Submit(ownerClient, new { parentSubmissionId = first.SubmissionId, originalText = "Second version." });
        var third = await Submit(ownerClient, new { parentSubmissionId = second.SubmissionId, originalText = "Third version." });
        var fourth = await Submit(ownerClient, new { parentSubmissionId = first.SubmissionId, originalText = "From version one." });
        Assert.Equal(new int?[] { 2, 3, 4 }, new[] { second.VersionNumber, third.VersionNumber, fourth.VersionNumber });
        Assert.Equal("C1", second.TargetCefr);
        Assert.Equal("C1", third.TargetCefr);
        Assert.Equal(first.SubmissionId, fourth.ParentSubmissionId);
        Assert.Equal(1, fourth.ParentVersionNumber);
        Assert.Equal(first.SubmissionId, fourth.PracticeRootId);
        Assert.Equal("C1", fourth.TargetCefr);
        Assert.Equal("B2", (await ownerClient.GetFromJsonAsync<WritingSubmissionResponse>(Submissions + "/" + first.SubmissionId))!.TargetCefr);
        var calls = ai.Calls;
        var replay = await Submit(ownerClient, firstRequest, HttpStatusCode.OK);
        Assert.Equal(first.SubmissionId, replay.SubmissionId);
        Assert.Equal(calls, ai.Calls);
        Assert.Equal(HttpStatusCode.Conflict, (await ownerClient.PostAsJsonAsync(Submissions, new { originalText = "Different text.", requestId = key })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherClient.PostAsJsonAsync(Submissions,
            new { parentSubmissionId = first.SubmissionId, originalText = "Another learner's text." })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherClient.GetAsync(Submissions + "/" + first.SubmissionId)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherClient.GetAsync(Submissions + "?practiceRootId=" + first.SubmissionId)).StatusCode);
        var legacy = (await ownerClient.GetFromJsonAsync<WritingSubmissionResponse>(Submissions + "/" + legacyId))!;
        Assert.False(legacy.TargetRecorded);
        Assert.Null(legacy.TargetCefr);
        Assert.Single(legacy.Errors);
        Assert.Equal(1, legacy.VersionNumber);
        Assert.Equal(calls, ai.Calls);

        Assert.Equal("B2", replay.TargetCefr);
        await SetProfileTarget(null);
        var twinRequest = new { parentSubmissionId = first.SubmissionId, originalText = "Concurrent retries.", requestId = Guid.NewGuid() };
        var replies = await Task.WhenAll(ownerClient.PostAsJsonAsync(Submissions, twinRequest), ownerClient.PostAsJsonAsync(Submissions, twinRequest));
        Assert.Contains(replies, reply => reply.StatusCode == HttpStatusCode.Created);
        Assert.Contains(replies, reply => reply.StatusCode == HttpStatusCode.OK);
        var twins = await Task.WhenAll(replies.Select(reply => reply.Content.ReadFromJsonAsync<WritingSubmissionResponse>()));
        Assert.Equal(twins[0]!.SubmissionId, twins[1]!.SubmissionId);
        Assert.Equal(5, twins[0]!.VersionNumber);
        Assert.Null(twins[0]!.TargetCefr);
        Assert.True(twins[0]!.TargetRecorded);
        var next = await Task.WhenAll(Submit(ownerClient, new { parentSubmissionId = second.SubmissionId, originalText = "Parallel first." }),
            Submit(ownerClient, new { parentSubmissionId = third.SubmissionId, originalText = "Parallel second." }));
        Assert.Equal(new int?[] { 6, 7 }, next.Select(row => row.VersionNumber).Order());
        var history = (await ownerClient.GetFromJsonAsync<WritingHistory>(Submissions + $"?practiceRootId={first.SubmissionId}"))!;
        Assert.Equal(Enumerable.Range(1, 7).Reverse().Select(i => (int?)i), history.Items.Select(row => row.VersionNumber));
        Assert.Equal(new string?[] { null, null, null, "C1", "C1", "C1", "B2" }, history.Items.Select(row => row.TargetCefr));
        Assert.DoesNotContain(history.Items, row => row.SubmissionId == legacyId);
        var original = (await ownerClient.GetFromJsonAsync<WritingSubmissionResponse>(Submissions + "/" + first.SubmissionId))!;
        Assert.Equal(first.OriginalText, original.OriginalText);
        Assert.Equal(first.CorrectedText, original.CorrectedText);
        Assert.Equal(first.Provenance, original.Provenance);
    }

    private static async Task<WritingSubmissionResponse> Submit(HttpClient client, object request, HttpStatusCode status = HttpStatusCode.Created)
    {
        using var result = await client.PostAsJsonAsync(Submissions, request);
        Assert.Equal(status, result.StatusCode);
        return (await result.Content.ReadFromJsonAsync<WritingSubmissionResponse>())!;
    }

    internal sealed class WritingHandler : HttpMessageHandler
    {
        private int calls;
        public int Calls => calls;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref calls);
            using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken));
            Assert.Equal(2, body.RootElement.EnumerateObject().Count());
            var text = body.RootElement.GetProperty("text").GetString()!;
            var corrected = body.RootElement.GetProperty("corrections").GetBoolean() ? text + " Corrected." : null;
            return new(HttpStatusCode.OK)
            {
                Content = JsonContent.Create(new WritingAnalysis("A2", corrected, corrected is null ? [] : [new(text, corrected)],
                    [], new("synthetic-cefr", new string('a', 64))))
            };
        }
    }
}
