using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Services;

namespace EnglishLearning.Api.Tests;

public sealed class WritingFeedbackTests
{
    private const string Original = "Synthetic original sentence.";
    private static readonly WritingSuggestion[] Errors = [new(Original, "Synthetic corrected sentence.")];
    private static WritingFeedback Ready(params WritingFeedbackItem[] items) => new("ready", items,
        "Nhận xét thử nghiệm.", "Qwen/Qwen2.5-1.5B-Instruct-GGUF", new string('a', 64), "feedback-v1");

    private sealed class Handler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> reply) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            reply(request, cancellationToken);
    }

    private static HttpClient Client(object feedback) => new(new Handler((_, _) => Task.FromResult(
        new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(feedback) })))
        { BaseAddress = new Uri("http://127.0.0.1:8000/") };

    [Fact]
    public async Task Feedback_sends_saved_topic_and_changes_to_separate_route()
    {
        using var http = new HttpClient(new Handler(async (request, token) =>
        {
            Assert.Equal("/internal/writing/feedback", request.RequestUri!.AbsolutePath);
            using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(token));
            Assert.Equal(Original, body.RootElement.GetProperty("text").GetString());
            Assert.Equal("Saved topic", body.RootElement.GetProperty("topic").GetString());
            Assert.Equal(1, body.RootElement.GetProperty("errors").GetArrayLength());
            Assert.False(body.RootElement.TryGetProperty("userId", out _));
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(
                Ready(new WritingFeedbackItem("grammar", "original sentence", "Xem gợi ý đã lưu.", "Đọc lại bản sửa.", 0))) };
        })) { BaseAddress = new Uri("http://127.0.0.1:8000/") };
        var result = await new WritingAiClient(http).FeedbackAsync(Original, "Saved topic", Errors, default);
        Assert.Equal("ready", result.Status);
        Assert.Equal(0, Assert.Single(result.Items).SuggestionIndex);
    }

    public static IEnumerable<object[]> InvalidFeedback()
    {
        yield return [Ready(new WritingFeedbackItem("content", "invented quotation", "Nhận xét.", "Thử lại."))];
        yield return [Ready(new WritingFeedbackItem("unknown", "original", "Nhận xét.", "Thử lại."))];
        yield return [Ready(new WritingFeedbackItem("organization", "original", "Nhận xét.", "Thử lại."),
            new("organization", "sentence", "Nhận xét.", "Thử lại."))];
        yield return [Ready(new WritingFeedbackItem("grammar", "original", "Nhận xét.", "Thử lại.", null))];
        yield return [Ready(new WritingFeedbackItem("grammar", "original", "Nhận xét.", "Thử lại.", 5))];
        yield return [Ready(new WritingFeedbackItem("vocabulary", "original", "Nhận xét.", "Thử lại.", 0))];
        yield return [Ready(new WritingFeedbackItem("organization", "original", "", "Thử lại."))];
        yield return [Ready()];
        yield return [Ready(new WritingFeedbackItem("organization", "original", "Nhận xét.", "Thử lại.")) with { ModelSha256 = "not-a-hash" }];
        yield return [Ready(new WritingFeedbackItem("organization", "original", "Nhận xét.", "Thử lại.")) with { ModelId = null }];
        yield return [new WritingFeedback("unavailable", [new("organization", "original", "Nhận xét.", "Thử lại.")], "Chưa khả dụng.")];
    }

    [Theory]
    [MemberData(nameof(InvalidFeedback))]
    public async Task Invalid_feedback_becomes_unavailable_without_a_fake_result(WritingFeedback feedback)
    {
        using var http = Client(feedback);
        var result = await new WritingAiClient(http).FeedbackAsync(Original, "Saved topic", Errors, default);
        Assert.Equal("unavailable", result.Status);
        Assert.Empty(result.Items);
    }

    [Fact]
    public async Task Content_feedback_without_a_topic_is_rejected()
    {
        using var http = Client(Ready(new WritingFeedbackItem("content", "original", "Nhận xét.", "Thử lại.")));
        Assert.Equal("unavailable", (await new WritingAiClient(http).FeedbackAsync(Original, null, Errors, default)).Status);
    }

    [Theory]
    [InlineData("not-json")]
    [InlineData("{\"status\":\"ready\",\"items\":[],\"message\":\"x\",\"score\":9}")]
    public async Task Invalid_schema_or_score_field_is_rejected(string json)
    {
        using var http = new HttpClient(new Handler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            { Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json") })))
            { BaseAddress = new Uri("http://127.0.0.1:8000/") };
        Assert.Equal("unavailable", (await new WritingAiClient(http).FeedbackAsync(Original, null, Errors, default)).Status);
    }

    [Fact]
    public async Task Busy_feedback_keeps_retryable_status()
    {
        using var http = new HttpClient(new Handler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.TooManyRequests))))
            { BaseAddress = new Uri("http://127.0.0.1:8000/") };
        var error = await Assert.ThrowsAsync<WritingAiException>(() => new WritingAiClient(http).FeedbackAsync(Original, null, Errors, default));
        Assert.Equal(429, error.StatusCode);
    }

    [Fact]
    public async Task Timed_out_or_disconnected_feedback_is_unavailable()
    {
        using var http = new HttpClient(new Handler((_, _) => throw new TaskCanceledException()))
            { BaseAddress = new Uri("http://127.0.0.1:8000/") };
        Assert.Equal("unavailable", (await new WritingAiClient(http).FeedbackAsync(Original, null, Errors, default)).Status);
    }

    [Theory]
    [InlineData(422)]
    [InlineData(500)]
    [InlineData(503)]
    public async Task Feedback_service_failure_does_not_turn_into_a_core_grade_failure(int code)
    {
        using var http = new HttpClient(new Handler((_, _) => Task.FromResult(new HttpResponseMessage((HttpStatusCode)code))))
            { BaseAddress = new Uri("http://127.0.0.1:8000/") };
        var result = await new WritingAiClient(http).FeedbackAsync(Original, null, Errors, default);
        Assert.Equal("unavailable", result.Status);
        Assert.Empty(result.Items);
    }

    [Fact]
    public async Task Caller_cancellation_is_propagated_instead_of_saving_unavailable()
    {
        using var deadline = new CancellationTokenSource();
        using var http = new HttpClient(new Handler(async (_, token) =>
        {
            deadline.Cancel();
            await Task.Delay(Timeout.InfiniteTimeSpan, token);
            throw new InvalidOperationException();
        })) { BaseAddress = new Uri("http://127.0.0.1:8000/") };
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => new WritingAiClient(http)
            .FeedbackAsync(Original, null, Errors, deadline.Token));
    }

    [Fact]
    public void Legacy_analysis_without_optional_fields_still_deserializes()
    {
        var value = JsonSerializer.Deserialize<WritingAnalysis>(
            "{\"cefr\":\"B1\",\"correctedText\":null,\"errors\":[],\"warnings\":[]}",
            new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        Assert.Null(value.Feedback);
        Assert.Null(value.Provenance);
        Assert.Null(value.GecCoverage);
    }

    [Fact]
    public async Task Accepted_explanations_and_model_provenance_survive_core_analysis()
    {
        var provenance = new WritingProvenance("cefr-v1", new string('a', 64), "gec-v1", new string('b', 64), "rules-v1");
        var errors = new[] { new WritingSuggestion(Original, "Synthetic corrected sentence.",
            [new("OTHER", "original", "corrected", "Gợi ý thay từ trong câu.", "rules-v1")]) };
        using var http = Client(new WritingAnalysis("B1", "Synthetic corrected sentence.", errors, [], provenance));
        var result = await new WritingAiClient(http).AnalyzeAsync(new SubmitWritingRequest { OriginalText = Original }, default);
        Assert.Equal(provenance, result.Provenance);
        Assert.Equal("OTHER", Assert.Single(Assert.Single(result.Errors).Explanations!).Category);
    }

    [Fact]
    public async Task Explanation_that_does_not_describe_actual_change_is_rejected()
    {
        using var http = Client(new WritingAnalysis("B1", "Synthetic corrected sentence.",
            [new(Original, "Synthetic corrected sentence.", [new("OTHER", "invented", "corrected", "Gợi ý.", "rules-v1")])], []));
        await Assert.ThrowsAsync<WritingAiException>(() => new WritingAiClient(http)
            .AnalyzeAsync(new SubmitWritingRequest { OriginalText = Original }, default));
    }
}
