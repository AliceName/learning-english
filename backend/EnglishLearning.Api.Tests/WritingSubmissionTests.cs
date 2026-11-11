using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace EnglishLearning.Api.Tests;

public sealed partial class RegistrationSqlServerTests
{
    private sealed class WritingHandler(bool fail) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(fail ? new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)
                : new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = JsonContent.Create(new WritingAnalysis("B1", "Synthetic corrected sentence.",
                        [new WritingSuggestion("Synthetic original sentence.", "Synthetic corrected sentence.")], ["Experimental"]))
                });
    }

    private sealed class FeedbackWritingHandler : HttpMessageHandler
    {
        public int FeedbackCalls;
        public bool Unavailable;
        public Func<Task>? BeforeFeedback;
        public string? SavedFeedbackBody;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.RequestUri!.AbsolutePath.EndsWith("/feedback", StringComparison.Ordinal))
            {
                Interlocked.Increment(ref FeedbackCalls);
                SavedFeedbackBody = await request.Content!.ReadAsStringAsync(cancellationToken);
                if (BeforeFeedback is not null) await BeforeFeedback();
                return new(HttpStatusCode.OK) { Content = JsonContent.Create(Unavailable
                    ? WritingAiClient.UnavailableFeedback()
                    : ReadyFeedback()) };
            }
            return new(HttpStatusCode.OK) { Content = JsonContent.Create(new WritingAnalysis("B1", "Synthetic corrected sentence.",
                [new("Synthetic original sentence.", "Synthetic corrected sentence.")], ["Experimental"],
                new("cefr-synthetic", new string('a', 64), "gec-synthetic", new string('b', 64), "rules-v1", "gec-safety-v1"),
                GecCoverage: new(1, 1, 0, 0, 0, 0, 0))) };
        }
    }

    private static WritingFeedback ReadyFeedback() => new("ready",
        [new("organization", "Synthetic original sentence.", "Nhận xét thử nghiệm.", "Thêm câu giải thích ý tưởng.")],
        "Gợi ý chưa được chuyên gia kiểm chứng.", "Qwen/Qwen2.5-1.5B-Instruct-GGUF", new string('c', 64), "feedback-v1");

    private async Task<(HttpClient Client, int Id)> SubmitForFeedback(Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program> writingFactory,
        string accessToken)
    {
        var writingClient = writingFactory.CreateClient();
        writingClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        var response = await writingClient.PostAsJsonAsync("/api/v1/writing/submissions", new SubmitWritingRequest
            { Topic = "A saved topic", OriginalText = "Synthetic original sentence.", Corrections = true });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<WritingSubmissionResponse>())!;
        return (writingClient, result.SubmissionId);
    }

    [SqlServerFact]
    public async Task Writing_saves_existing_columns_and_only_the_owner_can_read_the_submission()
    {
        var login = await SignIn(await RegisterLoginUser());
        await using var writingFactory = factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
            services.AddHttpClient<WritingAiClient>().ConfigurePrimaryHttpMessageHandler(() => new WritingHandler(false))));
        using var writingClient = writingFactory.CreateClient();
        writingClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);
        var response = await writingClient.PostAsJsonAsync("/api/v1/writing/submissions", new SubmitWritingRequest
            { Topic = "  A synthetic topic  ", OriginalText = "Synthetic original sentence.", Corrections = true });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore);
        var result = (await response.Content.ReadFromJsonAsync<WritingSubmissionResponse>())!;
        Assert.Equal("B1", result.CefrLevel);
        Assert.Equal("A synthetic topic", result.Topic);
        Assert.Single(result.Errors);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var saved = await db.WritingSubmissions.AsNoTracking().SingleAsync(s => s.SubmissionId == result.SubmissionId);
        Assert.Equal(login.User.UserId, saved.UserId);
        Assert.Equal("Synthetic original sentence.", saved.OriginalText);
        Assert.Null(saved.Score);
        Assert.Null(saved.Feedback);
        Assert.Null(saved.LessonId);
        Assert.True(saved.CreatedAt > DateTime.MinValue);
        Assert.Equal(HttpStatusCode.OK, (await writingClient.GetAsync(response.Headers.Location)).StatusCode);
        var otherLogin = await SignIn(await RegisterLoginUser());
        writingClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", otherLogin.AccessToken);
        Assert.Equal(HttpStatusCode.NotFound, (await writingClient.GetAsync(response.Headers.Location)).StatusCode);
        writingClient.DefaultRequestHeaders.Authorization = null;
        Assert.Equal(HttpStatusCode.Unauthorized, (await writingClient.GetAsync(response.Headers.Location)).StatusCode);
    }

    [SqlServerFact]
    public async Task Writing_does_not_save_a_fake_result_when_AI_is_unavailable()
    {
        var login = await SignIn(await RegisterLoginUser());
        await using var writingFactory = factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
            services.AddHttpClient<WritingAiClient>().ConfigurePrimaryHttpMessageHandler(() => new WritingHandler(true))));
        using var writingClient = writingFactory.CreateClient();
        writingClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);
        var response = await writingClient.PostAsJsonAsync("/api/v1/writing/submissions", new SubmitWritingRequest
            { OriginalText = "Synthetic original sentence." });
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        Assert.False(await db.WritingSubmissions.AnyAsync(s => s.UserId == login.User.UserId));
    }

    [SqlServerFact]
    public async Task Feedback_uses_owned_saved_content_persists_then_reloads_without_changing_core()
    {
        var login = await SignIn(await RegisterLoginUser());
        var handler = new FeedbackWritingHandler();
        await using var writingFactory = factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
            services.AddHttpClient<WritingAiClient>().ConfigurePrimaryHttpMessageHandler(() => handler)));
        var (writingClient, id) = await SubmitForFeedback(writingFactory, login.AccessToken);
        using (writingClient)
        {
            var route = $"/api/v1/writing/submissions/{id}/feedback";
            var response = await writingClient.PostAsync(route, null);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.True(response.Headers.CacheControl?.NoStore);
            var result = (await response.Content.ReadFromJsonAsync<WritingSubmissionResponse>())!;
            Assert.Equal("ready", result.Feedback?.Status);
            Assert.Equal("B1", result.CefrLevel);
            Assert.Equal("Synthetic original sentence.", result.OriginalText);
            Assert.Equal("Synthetic corrected sentence.", result.CorrectedText);
            Assert.Equal("cefr-synthetic", result.Provenance?.CefrRun);
            Assert.Equal("gec-safety-v1", result.Provenance?.GuardVersion);
            Assert.Equal(new WritingGecCoverage(1, 1, 0, 0, 0, 0, 0), result.GecCoverage);
            using var body = JsonDocument.Parse(handler.SavedFeedbackBody!);
            Assert.Equal("A saved topic", body.RootElement.GetProperty("topic").GetString());
            Assert.Equal(result.OriginalText, body.RootElement.GetProperty("text").GetString());
            Assert.Equal(HttpStatusCode.OK, (await writingClient.PostAsync(route, null)).StatusCode);
            Assert.Equal(1, handler.FeedbackCalls);
            var loaded = (await writingClient.GetFromJsonAsync<WritingSubmissionResponse>($"/api/v1/writing/submissions/{id}"))!;
            Assert.Equal("ready", loaded.Feedback?.Status);
            Assert.Equal(result.Provenance, loaded.Provenance);
            Assert.Equal(result.GecCoverage, loaded.GecCoverage);
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
            var stored = await db.WritingSubmissions.AsNoTracking().SingleAsync(s => s.SubmissionId == id);
            Assert.Null(stored.Score);
            Assert.Null(stored.Feedback);
            Assert.Equal(result.OriginalText, stored.OriginalText);
            Assert.Equal(HttpStatusCode.BadRequest, (await writingClient.PostAsJsonAsync(route, new { text = "Replacement" })).StatusCode);
            var other = await SignIn(await RegisterLoginUser());
            writingClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", other.AccessToken);
            Assert.Equal(HttpStatusCode.NotFound, (await writingClient.PostAsync(route, null)).StatusCode);
            writingClient.DefaultRequestHeaders.Authorization = null;
            Assert.Equal(HttpStatusCode.Unauthorized, (await writingClient.PostAsync(route, null)).StatusCode);
            Assert.Equal(1, handler.FeedbackCalls);
        }
    }

    [SqlServerFact]
    public async Task Unavailable_feedback_keeps_legacy_analysis_readable_and_can_be_retried()
    {
        var login = await SignIn(await RegisterLoginUser());
        var handler = new FeedbackWritingHandler { Unavailable = true };
        await using var writingFactory = factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
            services.AddHttpClient<WritingAiClient>().ConfigurePrimaryHttpMessageHandler(() => handler)));
        var (writingClient, id) = await SubmitForFeedback(writingFactory, login.AccessToken);
        using (writingClient)
        {
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
            const string legacy = "{\"cefr\":\"B1\",\"correctedText\":\"Synthetic corrected sentence.\",\"errors\":[{\"original\":\"Synthetic original sentence.\",\"suggestion\":\"Synthetic corrected sentence.\"}],\"warnings\":[\"Experimental\"]}";
            await db.WritingSubmissions.Where(s => s.SubmissionId == id).ExecuteUpdateAsync(s => s.SetProperty(x => x.ErrorsJson, legacy));
            var route = $"/api/v1/writing/submissions/{id}/feedback";
            var response = await writingClient.PostAsync(route, null);
            var result = (await response.Content.ReadFromJsonAsync<WritingSubmissionResponse>())!;
            Assert.Equal("unavailable", result.Feedback?.Status);
            Assert.Equal("B1", result.CefrLevel);
            Assert.Single(result.Errors);
            Assert.Null(result.Provenance);
            Assert.Null(result.GecCoverage);
            handler.Unavailable = false;
            var retry = await writingClient.PostAsync(route, null);
            Assert.Equal("ready", (await retry.Content.ReadFromJsonAsync<WritingSubmissionResponse>())?.Feedback?.Status);
            Assert.Equal(2, handler.FeedbackCalls);
        }
    }

    [SqlServerFact]
    public async Task Simultaneous_feedback_for_same_submission_returns_busy_without_duplicate_generation()
    {
        var login = await SignIn(await RegisterLoginUser());
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var handler = new FeedbackWritingHandler { BeforeFeedback = async () => { entered.TrySetResult(); await release.Task; } };
        await using var writingFactory = factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
            services.AddHttpClient<WritingAiClient>().ConfigurePrimaryHttpMessageHandler(() => handler)));
        var (writingClient, id) = await SubmitForFeedback(writingFactory, login.AccessToken);
        using (writingClient)
        {
            var route = $"/api/v1/writing/submissions/{id}/feedback";
            var first = writingClient.PostAsync(route, null);
            try
            {
                await entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
                Assert.Equal(HttpStatusCode.TooManyRequests, (await writingClient.PostAsync(route, null)).StatusCode);
                Assert.Equal(1, handler.FeedbackCalls);
            }
            finally { release.TrySetResult(); }
            Assert.Equal(HttpStatusCode.OK, (await first).StatusCode);
        }
    }

    [SqlServerFact]
    public async Task Stale_unavailable_response_cannot_overwrite_an_already_saved_ready_feedback()
    {
        var login = await SignIn(await RegisterLoginUser());
        var handler = new FeedbackWritingHandler { Unavailable = true };
        await using var writingFactory = factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
            services.AddHttpClient<WritingAiClient>().ConfigurePrimaryHttpMessageHandler(() => handler)));
        var (writingClient, id) = await SubmitForFeedback(writingFactory, login.AccessToken);
        using (writingClient)
        {
            handler.BeforeFeedback = async () =>
            {
                using var scope = factory.Services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
                var current = await db.WritingSubmissions.AsNoTracking().SingleAsync(s => s.SubmissionId == id);
                var analysis = JsonSerializer.Deserialize<WritingAnalysis>(current.ErrorsJson!, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
                var newer = JsonSerializer.Serialize(analysis with { Feedback = ReadyFeedback() }, new JsonSerializerOptions(JsonSerializerDefaults.Web));
                await db.WritingSubmissions.Where(s => s.SubmissionId == id).ExecuteUpdateAsync(s => s.SetProperty(x => x.ErrorsJson, newer));
            };
            var response = await writingClient.PostAsync($"/api/v1/writing/submissions/{id}/feedback", null);
            Assert.Equal("ready", (await response.Content.ReadFromJsonAsync<WritingSubmissionResponse>())?.Feedback?.Status);
        }
    }
}
