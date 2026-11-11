using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Services;
using Microsoft.Extensions.DependencyInjection;

namespace EnglishLearning.Api.Tests;

public sealed partial class RegistrationSqlServerTests
{
    private sealed class WritingToolsHandler : HttpMessageHandler
    {
        public int Calls;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            Calls++;
            object result;
            if (request.RequestUri!.AbsolutePath.EndsWith("capabilities"))
                result = new WritingCapabilities("ready", true, false, "disabled", 512, 384, 20, false);
            else
            {
                using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(token));
                var text = body.RootElement.GetProperty("text").GetString()!;
                result = new WritingPreflight(12, 512, true, true, 384, 20, [new(0, 0, text.Length, 12, "ready")]);
            }
            return new(HttpStatusCode.OK) { Content = JsonContent.Create(result) };
        }
    }

    [SqlServerFact]
    public async Task Writing_tools_require_authentication_keep_no_store_and_reject_extra_input()
    {
        var handler = new WritingToolsHandler();
        await using var writingFactory = factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
            services.AddHttpClient<WritingAiClient>().ConfigurePrimaryHttpMessageHandler(() => handler)));
        using var tools = writingFactory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await tools.GetAsync("/api/v1/writing/capabilities")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await tools.PostAsJsonAsync("/api/v1/writing/preflight",
            new { originalText = "I read books.", corrections = true })).StatusCode);
        Assert.Equal(0, handler.Calls);
        var login = await SignIn(await RegisterLoginUser());
        tools.DefaultRequestHeaders.Authorization = new("Bearer", login.AccessToken);
        var capability = await tools.GetAsync("/api/v1/writing/capabilities");
        Assert.True(capability.Headers.CacheControl?.NoStore);
        Assert.False((await capability.Content.ReadFromJsonAsync<WritingCapabilities>())!.FeedbackEnabled);
        var preflight = await tools.PostAsJsonAsync("/api/v1/writing/preflight",
            new { originalText = "🙂 I read books.", corrections = true });
        Assert.Equal(HttpStatusCode.OK, preflight.StatusCode);
        Assert.True(preflight.Headers.CacheControl?.NoStore);
        Assert.Equal(16, (await preflight.Content.ReadFromJsonAsync<WritingPreflight>())!.Sentences[0].End);
        var invalid = await tools.PostAsJsonAsync("/api/v1/writing/preflight",
            new { originalText = "I read books.", corrections = true, topic = "Must not be forwarded" });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Equal(2, handler.Calls);
    }

    [SqlServerFact]
    public async Task Writing_history_is_owner_only_newest_first_and_cursor_does_not_skip_or_repeat_items()
    {
        var owner = await SignIn(await RegisterLoginUser());
        var other = await SignIn(await RegisterLoginUser());
        await using var writingFactory = factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
            services.AddHttpClient<WritingAiClient>().ConfigurePrimaryHttpMessageHandler(() => new WritingHandler(false))));
        using var history = writingFactory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await history.GetAsync("/api/v1/writing/submissions")).StatusCode);
        history.DefaultRequestHeaders.Authorization = new("Bearer", other.AccessToken);
        var otherId = (await SubmitForFeedback(writingFactory, other.AccessToken));
        otherId.Client.Dispose();
        history.DefaultRequestHeaders.Authorization = new("Bearer", owner.AccessToken);
        var ids = new List<int>();
        for (var i = 0; i < 3; i++)
        {
            var (createdClient, id) = await SubmitForFeedback(writingFactory, owner.AccessToken);
            createdClient.Dispose(); ids.Add(id);
        }
        var response = await history.GetAsync("/api/v1/writing/submissions?limit=2");
        Assert.True(response.Headers.CacheControl?.NoStore);
        var first = (await response.Content.ReadFromJsonAsync<WritingHistory>())!;
        Assert.Equal(new[] { ids[2], ids[1] }, first.Items.Select(item => item.SubmissionId));
        Assert.Equal(ids[1], first.NextBeforeId);
        Assert.All(first.Items, item => Assert.True(item.Preview.Length <= 160));
        var second = (await history.GetFromJsonAsync<WritingHistory>($"/api/v1/writing/submissions?limit=2&beforeId={first.NextBeforeId}"))!;
        Assert.Equal(ids[0], Assert.Single(second.Items).SubmissionId);
        Assert.Null(second.NextBeforeId);
        Assert.DoesNotContain(first.Items.Concat(second.Items), item => item.SubmissionId == otherId.Id);
        history.DefaultRequestHeaders.Authorization = new("Bearer", other.AccessToken);
        var otherPage = (await history.GetFromJsonAsync<WritingHistory>("/api/v1/writing/submissions"))!;
        Assert.Equal(otherId.Id, Assert.Single(otherPage.Items).SubmissionId);
        Assert.Equal(HttpStatusCode.BadRequest, (await history.GetAsync("/api/v1/writing/submissions?limit=0")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await history.GetAsync("/api/v1/writing/submissions?beforeId=-1")).StatusCode);
    }
}
