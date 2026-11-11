using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Tests;

public sealed class TranslationAiClientTests
{
    private const string GradedJson = """
        {"meaning":60,"grammar":25,"naturalness":15,"meaningCorrect":true,"grammarCorrect":true,
         "majorMeaningError":false,"feedback":"Bản dịch đúng.","correctedText":"I missed the train.","issues":[]}
        """;

    [Theory]
    [InlineData(null, null, null, "gemini-3.5-flash-lite")]
    [InlineData(null, "models/gemini-2.5-flash", "https://api.openai.com/v1/chat/completions", "gemini-2.5-flash")]
    [InlineData("Gemini", null, "https://api.openai.com/v1/chat/completions", "gemini-3.5-flash-lite")]
    public async Task Gemini_uses_Google_endpoint_and_reads_only_answer_parts(string? provider, string? model,
        string? staleEndpoint, string expectedModel)
    {
        using var http = new HttpClient(new FakeHandler(async request =>
        {
            Assert.Equal($"https://generativelanguage.googleapis.com/v1beta/models/{expectedModel}:generateContent", request.RequestUri!.AbsoluteUri);
            Assert.Equal("fixture-google-key", Assert.Single(request.Headers.GetValues("x-goog-api-key")));
            Assert.Null(request.Headers.Authorization);
            var body = await request.Content!.ReadFromJsonAsync<JsonElement>();
            Assert.True(body.TryGetProperty("systemInstruction", out _));
            var config = body.GetProperty("generationConfig");
            Assert.Equal("application/json", config.GetProperty("responseMimeType").GetString());
            var schema = config.GetProperty("responseJsonSchema");
            Assert.Contains(schema.GetProperty("required").EnumerateArray(), field => field.GetString() == "correctedText");
            Assert.Equal(25, schema.GetProperty("properties").GetProperty("grammar").GetProperty("maximum").GetInt32());
            Assert.Equal(expectedModel.StartsWith("gemini-3"), config.TryGetProperty("thinkingConfig", out _));
            using var input = JsonDocument.Parse(body.GetProperty("contents")[0].GetProperty("parts")[0].GetProperty("text").GetString()!);
            Assert.Equal("I missed the train.", input.RootElement.GetProperty("answer").GetString());

            return new(HttpStatusCode.OK) { Content = JsonContent.Create(new { candidates = new[]
                { new { finishReason = "STOP", content = new { parts = new[]
                    { new { text = "not the answer", thought = true }, new { text = GradedJson, thought = false } } } } } }) };
        }));
        var client = CreateClient(http, new() { Provider = provider, Model = model, Endpoint = staleEndpoint }, "fixture-google-key");
        var grade = await client.GradeAsync(new(1, "A2", "Đi lại", "Tôi đã lỡ tàu.", ""), [], [], "I missed the train.", default);
        Assert.Equal(60, grade.Meaning);
    }

    [Fact]
    public async Task Gemini_grade_survives_mismatched_issue_quotes_and_corrects_the_example_from_the_report()
    {
        const string response = """
            {"meaning":55,"grammar":11,"naturalness":7,"meaningCorrect":false,"grammarCorrect":false,
             "majorMeaningError":false,"feedback":"Dùng thì hiện tại hoàn thành để hỏi về trải nghiệm.",
             "correctedText":"Have you ever studied online?",
             "correctionExplanation":"Dùng have + studied và ever để hỏi về một trải nghiệm trước đây.",
             "alternative":{"text":"Have you ever done any online learning?","explanation":"Online learning bao quát cả tự học lẫn học theo lớp."},
             "issues":[
               {"original":"do you have learn online?","suggestion":"Have you ever studied online?","explanation":"Hỏi về trải nghiệm."},
               {"original":"did you study online","suggestion":"Have you studied online?","explanation":"Cụm này không có trong bài."},
               {"original":"online","suggestion":"online"}
             ]}
            """;
        using var http = new HttpClient(new FakeHandler(_ => Task.FromResult(GeminiAnswer(response))));
        var client = CreateClient(http, new() { ApiKey = "fixture-google-key" });
        const string answer = "Do you have learn online";
        var grade = await client.GradeAsync(new(1, "A2", "Học tập", "Bạn đã từng học trực tuyến chưa?", ""), [], [], answer, default);
        Assert.Equal("Have you ever studied online?", grade.CorrectedText);
        Assert.Contains("have + studied", grade.CorrectionExplanation);
        Assert.Equal("Have you ever done any online learning?", grade.Alternative?.Text);
        Assert.Contains("tự học lẫn học theo lớp", grade.Alternative?.Explanation);
        Assert.Equal(11, grade.Grammar);
        Assert.Equal(answer, Assert.Single(grade.Issues).Original);
    }

    [Theory]
    [InlineData(60, 25, 13, true)]
    [InlineData(60, 25, 12, false)]
    [InlineData(60, 24, 15, false)]
    [InlineData(59, 25, 15, false)]
    public async Task Translation_bank_only_queues_submitted_answers_that_meet_all_quality_thresholds(
        int meaning, int grammar, int naturalness, bool queued)
    {
        var gradeJson = JsonNode.Parse(GradedJson)!.AsObject();
        gradeJson["meaning"] = meaning;
        gradeJson["meaningCorrect"] = meaning == 60;
        gradeJson["grammar"] = grammar;
        gradeJson["grammarCorrect"] = grammar == 25;
        gradeJson["naturalness"] = naturalness;
        gradeJson["alternative"] = new JsonObject
        {
            ["text"] = "I didn't catch the train.",
            ["explanation"] = "Dùng didn't catch khi muốn nói mình không kịp lên tàu."
        };
        using var http = new HttpClient(new FakeHandler(_ => Task.FromResult(GeminiAnswer(gradeJson.ToJsonString()))));
        var client = CreateClient(http, new() { ApiKey = "fixture-google-key" });
        var dbOptions = new DbContextOptionsBuilder<EnglishLearningDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        await using var db = new EnglishLearningDbContext(dbOptions);
        db.TranslationPrompts.Add(new()
        {
            PromptId = 1, RotationKey = Guid.NewGuid(), VietnameseText = "Tôi đã lỡ tàu.", CefrLevel = "A2", Topic = "Đi lại",
            MeaningNotesJson = "[]", Availability = "active", NormalizedVietnameseHash = new byte[32]
        });
        await db.SaveChangesAsync();
        var protection = new EphemeralDataProtectionProvider();
        var token = protection.CreateProtector("TranslationPractice.Attempt.v1").ToTimeLimitedDataProtector()
            .Protect("42:1", TimeSpan.FromMinutes(5));
        var service = new TranslationPracticeService(db, client, protection, TimeProvider.System,
            new ConfigurationBuilder().Build(), NullLogger<TranslationPracticeService>.Instance);
        const string submitted = "I missed my train.";
        var result = await service.GradeAsync(42, new(token, submitted, Guid.NewGuid()), default);

        Assert.Equal(queued ? "pending" : "none", result.CandidateStatus);
        Assert.Equal("I didn't catch the train.", result.Alternative?.Text);
        if (meaning == 60 && grammar == 25) Assert.Equal(submitted, result.CorrectedText);
        var saved = await db.TranslationAcceptedAnswers.ToArrayAsync();
        if (queued) Assert.Equal(submitted, Assert.Single(saved).EnglishText);
        else Assert.Empty(saved);
    }

    [Fact]
    public async Task Gemini_conflicting_verdict_cannot_mark_an_answer_correct()
    {
        const string response = """
            {"meaning":60,"grammar":25,"naturalness":7,"meaningCorrect":true,"grammarCorrect":false,
             "majorMeaningError":true,"feedback":"Cần giữ nguyên ý chính và sửa ngữ pháp.","correctedText":"I missed the train."}
            """;
        using var http = new HttpClient(new FakeHandler(_ => Task.FromResult(GeminiAnswer(response))));
        var client = CreateClient(http, new() { ApiKey = "fixture-google-key" });
        var grade = await client.GradeAsync(new(1, "A2", "Đi lại", "Tôi đã lỡ tàu.", ""), [], [], "I miss the bus.", default);
        Assert.False(grade.MeaningCorrect);
        Assert.False(grade.GrammarCorrect);
        Assert.True(grade.MajorMeaningError);
        Assert.InRange(grade.Meaning, 0, 59);
        Assert.InRange(grade.Grammar, 0, 24);
        Assert.Empty(grade.Issues);
    }

    [Fact]
    public async Task Gemini_rejects_invalid_core_scores()
    {
        using var http = new HttpClient(new FakeHandler(_ => Task.FromResult(GeminiAnswer(GradedJson.Replace("\"meaning\":60", "\"meaning\":61")))));
        var client = CreateClient(http, new() { ApiKey = "fixture-google-key" });
        var error = await Assert.ThrowsAsync<TranslationPracticeException>(() =>
            client.GradeAsync(new(1, "A2", "Đi lại", "Tôi đã lỡ tàu.", ""), [], [], "I missed the train.", default));
        Assert.Equal(502, error.Status);
    }

    [Fact]
    public async Task Chat_Completions_remains_compatible_with_existing_custom_configuration()
    {
        using var http = new HttpClient(new FakeHandler(request =>
        {
            Assert.Equal("https://chat.example.com/v1/chat/completions", request.RequestUri!.AbsoluteUri);
            Assert.Equal(new AuthenticationHeaderValue("Bearer", "fixture-chat-key"), request.Headers.Authorization);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(new { choices = new[]
                { new { finish_reason = "stop", message = new { content = GradedJson } } } }) });
        }));
        var client = CreateClient(http, new() { Model = "chat-model", ApiKey = "fixture-chat-key", Endpoint = "https://chat.example.com/v1/chat/completions" });
        var grade = await client.GradeAsync(new(1, "A2", "Đi lại", "Tôi đã lỡ tàu.", ""), [], [], "I missed the train.", default);
        Assert.True(grade.GrammarCorrect);
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest, "ai_configuration_error")]
    [InlineData(HttpStatusCode.Forbidden, "ai_configuration_error")]
    [InlineData(HttpStatusCode.TooManyRequests, "ai_quota_limited")]
    public async Task Gemini_distinguishes_configuration_and_quota_errors(HttpStatusCode status, string code)
    {
        var calls = 0;
        using var http = new HttpClient(new FakeHandler(_ =>
        {
            calls++;
            return Task.FromResult(new HttpResponseMessage(status) { Headers = { RetryAfter = new(TimeSpan.FromSeconds(23)) } });
        }));
        var client = CreateClient(http, new() { ApiKey = "fixture-google-key" });
        var error = await Assert.ThrowsAsync<TranslationPracticeException>(() => client.GenerateAsync("A2", "Giao thông", 1, default));
        Assert.Equal(code, error.Code);
        if (status == HttpStatusCode.TooManyRequests)
        {
            Assert.Equal(23, error.RetryAfter);
            var retry = await Assert.ThrowsAsync<TranslationPracticeException>(() => client.GenerateAsync("A2", "Giao thông", 1, default));
            Assert.Equal(code, retry.Code);
            Assert.Equal(1, calls);
        }
    }

    private static TranslationAiClient CreateClient(HttpClient http, TranslationAiOptions values, string? geminiEnvKey = null)
    {
        var options = Options.Create(values);
        var clock = TimeProvider.System;
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["GEMINI_API_KEY"] = geminiEnvKey }).Build();
        return new(http, options, new(clock, options), clock, config, NullLogger<TranslationAiClient>.Instance);
    }

    private static HttpResponseMessage GeminiAnswer(string text) => new(HttpStatusCode.OK)
    {
        Content = JsonContent.Create(new { candidates = new[] { new { finishReason = "STOP", content = new { parts = new[] { new { text } } } } } })
    };

    private sealed class FakeHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => send(request);
    }
}
