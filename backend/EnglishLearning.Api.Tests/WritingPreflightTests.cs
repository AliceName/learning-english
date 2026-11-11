using System.Net;
using System.Net.Http.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Services;

namespace EnglishLearning.Api.Tests;

public sealed class WritingPreflightTests
{
    [Fact]
    public async Task Input_eligibility_remains_distinct_from_token_budget_and_validated()
    {
        foreach (var status in new[] { "insufficient", "eligible" })
        {
            using var http = Client(_ => Json(new WritingPreflight(20, 512, true, false, null, 20, [],
                new(status, ["repetition"], [], "cefr-input-v1"))));
            var request = new WritingPreflightRequest { OriginalText = "A repeated English sentence." };
            if (status == "insufficient")
                Assert.Equal("insufficient", (await new WritingAiClient(http).PreflightAsync(request, default)).InputAssessment!.Status);
            else await Assert.ThrowsAsync<WritingAiException>(() => new WritingAiClient(http).PreflightAsync(request, default));
        }
    }

    [Fact]
    public async Task Analyze_422_preserves_actionable_eligibility_reason()
    {
        using var http = Client(_ => new(HttpStatusCode.UnprocessableEntity) {
            Content = JsonContent.Create(new { detail = "Bài lặp nội dung; hãy phát triển thêm ý." }) });
        var error = await Assert.ThrowsAsync<WritingAiException>(() => new WritingAiClient(http).AnalyzeAsync(
            new() { OriginalText = "Repeated text." }, default));
        Assert.Contains("lặp", error.Message);
    }

    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> reply) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) => Task.FromResult(reply(request));
    }

    private static HttpClient Client(Func<HttpRequestMessage, HttpResponseMessage> reply) =>
        new(new Handler(reply)) { BaseAddress = new Uri("http://127.0.0.1:8000/") };
    private static HttpResponseMessage Json(object value) => new(HttpStatusCode.OK) { Content = JsonContent.Create(value) };

    [Fact]
    public async Task Tokenizer_preflight_preserves_UTF16_spans_and_does_not_send_topic_or_identity()
    {
        var text = "🙂 I read books.\r\nI read books.";
        using var http = Client(request =>
        {
            Assert.Equal("/internal/writing/preflight", request.RequestUri!.AbsolutePath);
            var body = request.Content!.ReadAsStringAsync().Result;
            using var payload = System.Text.Json.JsonDocument.Parse(body);
            Assert.Equal(text, payload.RootElement.GetProperty("text").GetString());
            Assert.Equal(2, payload.RootElement.EnumerateObject().Count());
            Assert.DoesNotContain("topic", body);
            return Json(new WritingPreflight(34, 512, true, true, 384, 20,
                [new(0, 0, 16, 16, "ready"), new(1, 18, text.Length, 16, "ready")]));
        });
        var result = await new WritingAiClient(http).PreflightAsync(new() { OriginalText = text, Corrections = true }, default);
        Assert.Equal(text.Length, result.Sentences[^1].End);
    }

    [Fact]
    public async Task Capabilities_are_safe_and_unavailable_service_is_not_claimed_ready()
    {
        using var available = Client(_ => Json(new WritingCapabilities("ready", true, false, "disabled", 512, 384, 20, true)));
        var ready = await new WritingAiClient(available).CapabilitiesAsync(default);
        Assert.True(ready.Busy);
        Assert.False(ready.FeedbackEnabled);
        using var unavailable = Client(_ => new(HttpStatusCode.ServiceUnavailable));
        var offline = await new WritingAiClient(unavailable).CapabilitiesAsync(default);
        Assert.Equal("unavailable", offline.Status);
        Assert.Null(offline.CefrLimit);
    }

    [Theory]
    [InlineData("{\"status\":\"ready\",\"feedbackEnabled\":true}")]
    [InlineData("{\"status\":\"ready\",\"correctionsEnabled\":true,\"feedbackEnabled\":true,\"feedbackStatus\":\"disabled\",\"cefrLimit\":512,\"gecInputLimit\":384,\"gecSentenceLimit\":20,\"busy\":false}")]
    public async Task Malformed_capabilities_fail_closed(string json)
    {
        using var http = Client(_ => new(HttpStatusCode.OK) { Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json") });
        Assert.Equal("unavailable", (await new WritingAiClient(http).CapabilitiesAsync(default)).Status);
    }

    [Theory]
    [InlineData(0, 1, "ready")]
    [InlineData(1, 5, "ready")]
    [InlineData(0, 5, "sentenceLimit")]
    [InlineData(0, 500, "ready")]
    public async Task Invalid_surrogate_boundaries_ranges_and_statuses_are_rejected(int start, int end, string status)
    {
        using var http = Client(_ => Json(new WritingPreflight(10, 512, true, true, 384, 20, [new(0, start, end, 10, status)])));
        await Assert.ThrowsAsync<WritingAiException>(() => new WritingAiClient(http).PreflightAsync(
            new() { OriginalText = "🙂 Hi.", Corrections = true }, default));
    }

    [Fact]
    public async Task Source_offsets_are_optional_for_old_results_but_invalid_new_offsets_are_rejected()
    {
        using var http = Client(_ => Json(new WritingAnalysis("B1", "She goes.",
            [new("She go.", "She goes.", SourceStart: 1, SourceEnd: 8)], [])));
        await Assert.ThrowsAsync<WritingAiException>(() => new WritingAiClient(http).AnalyzeAsync(
            new() { OriginalText = "She go.", Corrections = true }, default));
    }

    [Fact]
    public async Task Feedback_transport_does_not_send_UI_source_offsets_to_the_strict_model_contract()
    {
        using var http = Client(request =>
        {
            Assert.Equal("/internal/writing/feedback", request.RequestUri!.AbsolutePath);
            using var payload = System.Text.Json.JsonDocument.Parse(request.Content!.ReadAsStringAsync().Result);
            var error = payload.RootElement.GetProperty("errors")[0];
            Assert.False(error.TryGetProperty("sourceStart", out _));
            Assert.False(error.TryGetProperty("sourceEnd", out _));
            Assert.Equal("She go.", error.GetProperty("original").GetString());
            return Json(WritingAiClient.UnavailableFeedback());
        });
        var result = await new WritingAiClient(http).FeedbackAsync("She go.", null,
            [new("She go.", "She goes.", SourceStart: 0, SourceEnd: 7)], default);
        Assert.Equal("unavailable", result.Status);
    }
}
