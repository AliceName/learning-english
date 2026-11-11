using System.ComponentModel.DataAnnotations;
using System.Net;
using System.Net.Http.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Services;

namespace EnglishLearning.Api.Tests;

public sealed class WritingAiTests
{
    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> reply) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(reply(request));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Blank_essays_are_rejected(string text)
    {
        var request = new SubmitWritingRequest { OriginalText = text };
        Assert.False(Validator.TryValidateObject(request, new ValidationContext(request), [], true));
    }

    [Fact]
    public async Task Sends_original_and_corrections_without_topic_or_user_identity()
    {
        string? body = null;
        using var http = new HttpClient(new Handler(r =>
        {
            Assert.Equal("/internal/writing/analyze", r.RequestUri!.AbsolutePath);
            body = r.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = JsonContent.Create(new WritingAnalysis("B1", null, [], ["Experimental"]))
            };
        })) { BaseAddress = new Uri("http://127.0.0.1:8000/") };
        var result = await new WritingAiClient(http).AnalyzeAsync(new SubmitWritingRequest
            { OriginalText = "Synthetic original", Topic = "Private topic", Corrections = true }, default);
        Assert.Equal("B1", result.Cefr);
        Assert.Contains("Synthetic original", body);
        Assert.DoesNotContain("Private topic", body);
    }

    [Theory]
    [InlineData(422, 422)]
    [InlineData(429, 429)]
    [InlineData(500, 503)]
    public async Task Unavailable_or_over_budget_responses_cannot_be_saved_as_grades(int status, int expected)
    {
        using var http = new HttpClient(new Handler(_ => new HttpResponseMessage((HttpStatusCode)status)))
            { BaseAddress = new Uri("http://127.0.0.1:8000/") };
        var error = await Assert.ThrowsAsync<WritingAiException>(() => new WritingAiClient(http)
            .AnalyzeAsync(new SubmitWritingRequest { OriginalText = "Synthetic" }, default));
        Assert.Equal(expected, error.StatusCode);
    }

    [Theory]
    [InlineData("{\"cefr\":\"B3\",\"errors\":[],\"warnings\":[]}")]
    [InlineData("{\"cefr\":\"B1\"}")]
    [InlineData("not-json")]
    public async Task Invalid_model_results_are_rejected(string json)
    {
        using var http = new HttpClient(new Handler(_ => new HttpResponseMessage(HttpStatusCode.OK)
            { Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json") }))
            { BaseAddress = new Uri("http://127.0.0.1:8000/") };
        await Assert.ThrowsAsync<WritingAiException>(() => new WritingAiClient(http)
            .AnalyzeAsync(new SubmitWritingRequest { OriginalText = "Synthetic" }, default));
    }

    [Fact]
    public async Task Valid_coverage_and_guard_version_survive_core_analysis()
    {
        var coverage = new WritingGecCoverage(22, 1, 15, 1, 1, 2, 2);
        var analysis = new WritingAnalysis("B1", "Synthetic corrected sentence.",
            [new("Synthetic original sentence.", "Synthetic corrected sentence.")], [],
            new(GuardVersion: "gec-safety-v1"), GecCoverage: coverage);
        using var http = new HttpClient(new Handler(_ => new HttpResponseMessage(HttpStatusCode.OK)
            { Content = JsonContent.Create(analysis) })) { BaseAddress = new Uri("http://127.0.0.1:8000/") };
        var result = await new WritingAiClient(http).AnalyzeAsync(new SubmitWritingRequest
            { OriginalText = "Synthetic original sentence.", Corrections = true }, default);
        Assert.Equal(coverage, result.GecCoverage);
        Assert.Equal("gec-safety-v1", result.Provenance?.GuardVersion);
    }

    [Theory]
    [InlineData("{\"totalBodySentences\":1,\"changed\":0,\"unchanged\":1,\"rejected\":0,\"inputOverBudget\":0,\"incomplete\":0,\"sentenceLimit\":1}")]
    [InlineData("{\"totalBodySentences\":1,\"changed\":0,\"unchanged\":2,\"rejected\":0,\"inputOverBudget\":0,\"incomplete\":0,\"sentenceLimit\":0}")]
    [InlineData("{\"totalBodySentences\":1,\"changed\":0,\"unchanged\":1,\"rejected\":-1,\"inputOverBudget\":1,\"incomplete\":0,\"sentenceLimit\":0}")]
    [InlineData("{\"totalBodySentences\":1,\"changed\":1,\"unchanged\":0,\"rejected\":0,\"inputOverBudget\":0,\"incomplete\":0,\"sentenceLimit\":0}")]
    [InlineData("{\"totalBodySentences\":21,\"changed\":0,\"unchanged\":21,\"rejected\":0,\"inputOverBudget\":0,\"incomplete\":0,\"sentenceLimit\":0}")]
    [InlineData("{\"totalBodySentences\":0}")]
    [InlineData("{\"totalBodySentences\":1.5,\"changed\":0,\"unchanged\":1,\"rejected\":0,\"inputOverBudget\":0,\"incomplete\":0,\"sentenceLimit\":0}")]
    public async Task Invalid_or_incomplete_coverage_is_rejected(string coverage)
    {
        var json = "{\"cefr\":\"B1\",\"correctedText\":\"Synthetic.\",\"errors\":[],\"warnings\":[],\"gecCoverage\":" + coverage + "}";
        using var http = new HttpClient(new Handler(_ => new HttpResponseMessage(HttpStatusCode.OK)
            { Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json") }))
            { BaseAddress = new Uri("http://127.0.0.1:8000/") };
        await Assert.ThrowsAsync<WritingAiException>(() => new WritingAiClient(http).AnalyzeAsync(
            new SubmitWritingRequest { OriginalText = "Synthetic.", Corrections = true }, default));
    }

    [Theory]
    [InlineData(false, "Synthetic.")]
    [InlineData(true, null)]
    public async Task Coverage_requires_requested_corrections_and_a_corrected_result(bool corrections, string? corrected)
    {
        using var http = new HttpClient(new Handler(_ => new HttpResponseMessage(HttpStatusCode.OK)
            { Content = JsonContent.Create(new WritingAnalysis("B1", corrected, [], [],
                GecCoverage: new(1, 0, 1, 0, 0, 0, 0))) })) { BaseAddress = new Uri("http://127.0.0.1:8000/") };
        await Assert.ThrowsAsync<WritingAiException>(() => new WritingAiClient(http).AnalyzeAsync(
            new SubmitWritingRequest { OriginalText = "Synthetic.", Corrections = corrections }, default));
    }
}
