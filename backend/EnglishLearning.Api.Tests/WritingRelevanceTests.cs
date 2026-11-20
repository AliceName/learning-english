using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Services;

namespace EnglishLearning.Api.Tests;

public sealed class WritingRelevanceTests
{
    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> reply) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(reply(request));
    }

    private static WritingAiClient Client(Func<HttpRequestMessage, HttpResponseMessage> reply) =>
        new(new HttpClient(new Handler(reply)) { BaseAddress = new Uri("http://127.0.0.1:8000/") });

    private const string Essay = "Hi Ken, thank you. We went to the beach.";

    private static object Valid(int score = 4, string evidence = "Hi Ken, thank you.") => new
    {
        score, offTopic = score == 0, topicSimilarity = 0.45, pointsCovered = 1, pointsTotal = 2,
        points = new[] { new { point = "thank Ken", covered = true, evidence }, new { point = "meet", covered = false, evidence = (string?)null } },
        keywords = new[] { "ken", "beach" }, thresholdsVersion = "relevance-minilm-v1", model = "sentence-transformers/all-MiniLM-L6-v2@1110a243",
    };

    [Fact]
    public async Task Sends_only_text_and_prompt_and_returns_a_validated_score()
    {
        string? body = null;
        var result = await Client(request =>
        {
            Assert.Equal("/internal/writing/relevance", request.RequestUri!.AbsolutePath);
            body = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(Valid()) };
        }).RelevanceAsync(Essay, "Write to Ken.", default);
        Assert.NotNull(result);
        Assert.Equal(4, result!.Score);
        Assert.Equal(2, result.Points.Length);
        using var json = JsonDocument.Parse(body!);
        Assert.Equal(["text", "prompt"], json.RootElement.EnumerateObject().Select(p => p.Name));
    }

    [Theory]
    [InlineData(6, "Hi Ken, thank you.")]
    [InlineData(4, "A sentence that is not in the essay.")]
    public async Task Rejects_out_of_range_scores_or_evidence_not_taken_from_the_essay(int score, string evidence)
    {
        var result = await Client(_ => new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(Valid(score, evidence)) })
            .RelevanceAsync(Essay, "Write to Ken.", default);
        Assert.Null(result);
    }

    [Fact]
    public async Task Failures_return_no_score_instead_of_failing_the_submission()
    {
        Assert.Null(await Client(_ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)).RelevanceAsync(Essay, "p", default));
        Assert.Null(await Client(_ => throw new HttpRequestException("down")).RelevanceAsync(Essay, "p", default));
    }
}
