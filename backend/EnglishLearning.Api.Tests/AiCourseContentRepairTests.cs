using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Services.AiCourses;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearning.Api.Tests;

public sealed class AiCourseContentRepairTests
{
    [Theory]
    [InlineData("en-US")]
    [InlineData("vi-VN")]
    [InlineData("fr-FR")]
    public void Reading_question_points_validate_with_the_same_limits_in_each_culture(string culture)
    {
        var previous = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo(culture);
            foreach (var points in new[] { 0.09m, 0.1m, 1m, 10m, 10.01m })
            {
                var question = new ReadingQuestion { Type = "short_answer", Prompt = "What is the topic?", Answer = "Travel", Points = points };
                var errors = new List<ValidationResult>();
                var valid = Validator.TryValidateObject(question, new ValidationContext(question), errors, true);
                Assert.Equal(points >= 0.1m && points <= 10m, valid);
            }
        }
        finally { CultureInfo.CurrentCulture = previous; }
    }

    [Fact]
    public async Task Reading_repairs_the_same_unit_with_field_feedback_and_audits_both_calls()
    {
        using var fixture = new Fixture();
        var requests = new List<JsonElement>();
        var prior = new AiOutlineLesson { SkillType = "reading", Reading = Reading() };
        var target = new AiOutlineLesson { SkillType = "reading", Title = "Next lesson" };
        var job = Job(); job.Outline = new() { Lessons = [prior, target] };
        var priorJson = JsonSerializer.Serialize(prior, AiCourseStore.Json);
        using var http = new HttpClient(new Handler(request => {
            using var body = JsonDocument.Parse(request.Content!.ReadAsStringAsync().GetAwaiter().GetResult());
            var root = body.RootElement;
            var questions = root.GetProperty("generationConfig").GetProperty("responseJsonSchema").GetProperty("properties").GetProperty("questions");
            Assert.Equal(3, questions.GetProperty("minItems").GetInt32()); Assert.Equal(3, questions.GetProperty("maxItems").GetInt32());
            var branches = questions.GetProperty("items").GetProperty("anyOf");
            Assert.Equal(2, branches.GetArrayLength());
            Assert.Equal(0, branches[1].GetProperty("properties").GetProperty("options").GetProperty("maxItems").GetInt32());
            requests.Add(JsonDocument.Parse(root.GetProperty("contents")[0].GetProperty("parts")[0].GetProperty("text").GetString()!).RootElement.Clone());
            return Text(requests.Count == 1 ? Reading("THIS_PRIVATE_INVALID_QUOTE_MUST_NOT_BE_LOGGED") : Reading());
        }));
        await fixture.Client(http).GenerateLessonAsync(job, target, default);
        Assert.NotNull(target.Reading);
        Assert.Equal(priorJson, JsonSerializer.Serialize(prior, AiCourseStore.Json));
        Assert.Equal(2, requests.Count);
        Assert.False(requests[0].TryGetProperty("validationFeedback", out _));
        var feedback = requests[1].GetProperty("validationFeedback").GetProperty("errors")[0];
        Assert.Equal("reference_mismatch", feedback.GetProperty("code").GetString());
        Assert.Equal("$.questions[0].reference", feedback.GetProperty("path").GetString());
        Assert.Contains("exact contiguous", feedback.GetProperty("hint").GetString());
        Assert.Equal(requests[0].GetProperty("source").GetString(), requests[1].GetProperty("source").GetString());
        Assert.DoesNotContain("THIS_PRIVATE_INVALID_QUOTE", requests[1].GetRawText());
        var calls = fixture.Store.Calls().OrderBy(call => call.AttemptNo).ToArray();
        Assert.Equal(2, calls.Length); Assert.Equal(calls[0].OperationId, calls[1].OperationId);
        Assert.Equal("invalid", calls[0].ContentOutcome); Assert.Equal("reference_mismatch", calls[0].ContentFailureCode);
        Assert.Equal("$.questions[0].reference", calls[0].ContentFailurePath); Assert.Equal("STOP", calls[0].ProviderFinishReason);
        Assert.Equal("valid_content", calls[1].ContentOutcome); Assert.Null(calls[1].ContentFailureCode);
        Assert.DoesNotContain("THIS_PRIVATE_INVALID_QUOTE", string.Join("", calls.Select(call => File.ReadAllText(fixture.Store.CallFile(call.Id)))));
    }

    [Theory]
    [InlineData("reference", "reference_mismatch", "$.questions[0].reference")]
    [InlineData("count", "question_count", "$.questions")]
    [InlineData("options", "choice_options", "$.questions[0].options")]
    [InlineData("blank", "blank_placeholder", "$.questions[0].prompt")]
    public async Task Persistent_invalid_content_stops_after_one_repair_without_committing_a_bad_lesson(string fault, string code, string path)
    {
        using var fixture = new Fixture();
        var count = 0;
        using var http = new HttpClient(new Handler(_ => {
            count++; var value = JsonSerializer.SerializeToNode(Reading(), AiCourseStore.Json)!;
            switch (fault) {
                case "reference": value["questions"]![0]!["reference"] = "Invented evidence"; break;
                case "count": value["questions"]!.AsArray().RemoveAt(2); break;
                case "options": value["questions"]![0]!["options"] = new JsonArray("Morning", " morning "); break;
                case "blank":
                    var question = value["questions"]![0]!;
                    question["type"] = "fill_blank"; question["prompt"] = "She [blank] English [blank]."; question["options"] = new JsonArray();
                    question["correctOptionIndex"] = null; question["answer"] = "studies"; break;
            }
            return Text(value);
        }));
        var lesson = new AiOutlineLesson { SkillType = "reading" };
        var error = await Assert.ThrowsAsync<AiCourseException>(() => fixture.Client(http).GenerateLessonAsync(Job(), lesson, default));
        Assert.Equal(GeminiCourseClient.MaxTextAttempts, count); Assert.Null(lesson.Reading);
        Assert.Equal("invalid_generated_content", error.Code); Assert.False(error.Retryable); Assert.NotNull(error.OperationId);
        Assert.Contains(error.ContentIssues, issue => issue.Code == code && issue.Path == path);
        Assert.Contains(path, error.Message); Assert.Contains("sau 2 lần", error.Message);
        Assert.All(fixture.Store.Calls(), call => Assert.Equal("invalid", call.ContentOutcome));
    }

    [Theory]
    [InlineData("json", "invalid_json", "STOP")]
    [InlineData("empty", "missing_candidate", null)]
    [InlineData("null", "null_content", "STOP")]
    [InlineData("truncated", "incomplete_response", "MAX_TOKENS")]
    public async Task Malformed_empty_and_truncated_responses_are_classified_and_repaired(string fault, string code, string? finish)
    {
        using var fixture = new Fixture(); var attempts = 0;
        using var http = new HttpClient(new Handler(_ => {
            if (++attempts > 1) return Text(Reading());
            return fault switch {
                "empty" => Json(new { candidates = Array.Empty<object>() }),
                "null" => RawText("null"),
                "truncated" => RawText("{", "MAX_TOKENS"),
                _ => RawText("```json\n{ broken json")
            };
        }));
        var lesson = new AiOutlineLesson { SkillType = "reading" };
        await fixture.Client(http).GenerateLessonAsync(Job(), lesson, default);
        Assert.NotNull(lesson.Reading); Assert.Equal(2, attempts);
        var failed = fixture.Store.Calls().Single(call => call.AttemptNo == 1);
        Assert.Equal(code, failed.ContentFailureCode); Assert.Equal(finish, failed.ProviderFinishReason);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Provider_blocks_are_recorded_without_attempting_to_repair_or_bypass_them(bool promptBlocked)
    {
        using var fixture = new Fixture(); var attempts = 0;
        using var http = new HttpClient(new Handler(_ => { attempts++; return promptBlocked ? Json(new { promptFeedback = new { blockReason = "SAFETY" } }) : RawText("", "SAFETY"); }));
        var error = await Assert.ThrowsAsync<AiCourseException>(() => fixture.Client(http).GenerateLessonAsync(Job(), new() { SkillType = "reading" }, default));
        Assert.Equal(1, attempts); Assert.False(error.Retryable);
        Assert.Equal(promptBlocked ? "PROMPT_BLOCKED" : "SAFETY", Assert.Single(fixture.Store.Calls()).ProviderFinishReason);
    }

    [Fact]
    public async Task A_repair_cannot_bypass_gateway_quota()
    {
        using var fixture = new Fixture(); fixture.Store.Write(fixture.Store.PolicyFile, new AiApiPolicy { CallsPerDay = 1 }); var attempts = 0;
        using var http = new HttpClient(new Handler(_ => { attempts++; return Text(Reading("Wrong evidence")); }));
        var lesson = new AiOutlineLesson { SkillType = "reading" };
        var error = await Assert.ThrowsAsync<AiCourseException>(() => fixture.Client(http).GenerateLessonAsync(Job(), lesson, default));
        Assert.Equal("ai_daily_limit", error.Code); Assert.Equal(1, attempts); Assert.Null(lesson.Reading);
        Assert.Equal("invalid", Assert.Single(fixture.Store.Calls()).ContentOutcome);
    }

    [Theory]
    [InlineData(400)]
    [InlineData(429)]
    [InlineData(503)]
    public async Task Http_errors_are_not_misclassified_as_content_repair_failures(int status)
    {
        using var fixture = new Fixture(); var attempts = 0;
        using var http = new HttpClient(new Handler(_ => { attempts++; return new((HttpStatusCode)status) { Content = JsonContent.Create(new { error = "provider" }) }; }));
        var error = await Assert.ThrowsAsync<AiCourseException>(() => fixture.Client(http).GenerateLessonAsync(Job(), new() { SkillType = "reading" }, default));
        Assert.Equal(1, attempts); Assert.NotEqual("invalid_generated_content", error.Code);
        Assert.Equal(status != 400, error.Retryable);
    }

    [Fact]
    public async Task Valid_content_does_not_consume_an_extra_call()
    {
        using var fixture = new Fixture(); using var http = new HttpClient(new Handler(_ => Text(Reading())));
        await fixture.Client(http).GenerateLessonAsync(Job(), new() { SkillType = "reading" }, default);
        Assert.Equal("valid_content", Assert.Single(fixture.Store.Calls()).ContentOutcome);
    }

    [Fact]
    public void Evidence_allows_harmless_formatting_but_rejects_paraphrases_and_reports_nested_nulls()
    {
        var reading = Reading("Anna studies English every morning.");
        var formatted = new ReadingContent { PassageTitle = reading.PassageTitle, Passage = "Anna studies\nEnglish every\u00a0morning.", Translation = reading.Translation, Vocabulary = reading.Vocabulary, Questions = reading.Questions };
        AiCourseContent.Validate(new() { SkillType = "reading", Reading = formatted }, 3);
        var error = Assert.Throws<AiCourseException>(() => AiCourseContent.Validate(new() { SkillType = "reading", Reading = Reading("Anna learns English each morning.") }, 3));
        Assert.Contains(error.ContentIssues, issue => issue.Code == "reference_mismatch");
        var nested = new ReadingContent { PassageTitle = reading.PassageTitle, Passage = reading.Passage, Translation = reading.Translation, Vocabulary = [null!], Questions = reading.Questions };
        var nullError = Assert.Throws<AiCourseException>(() => AiCourseContent.Validate(new() { SkillType = "reading", Reading = nested }, 3));
        Assert.Contains(nullError.ContentIssues, issue => issue.Code == "null_entry" && issue.Path == "$.vocabulary[0]");
    }

    private static AiCourseJob Job() => new() { Id = Guid.NewGuid(), UserId = 7, SourceText = "Anna studies English every morning.", Config = new() { Goal = "Read about daily routines", Skills = ["reading"], QuestionsPerLesson = 3 } };
    private static ReadingContent Reading(string reference = "Anna studies English every morning.") => new() {
        PassageTitle = "Daily routines", Passage = "Anna studies English every morning. She walks to school.", Translation = "Anna học tiếng Anh mỗi sáng.",
        Vocabulary = [new() { Word = "morning", Meaning = "buổi sáng" }],
        Questions = Enumerable.Range(0, 3).Select(_ => new ReadingQuestion { Prompt = "When does Anna study?", Options = ["Morning", "Evening"], CorrectOptionIndex = 0, Explanation = "Anna học vào buổi sáng.", Reference = reference }).ToArray()
    };
    private static HttpResponseMessage Text(object value) => RawText(JsonSerializer.Serialize(value, AiCourseStore.Json));
    private static HttpResponseMessage RawText(string value, string finish = "STOP") => Json(new {
        candidates = new[] { new { finishReason = finish, content = new { parts = new[] { new { text = value } } } } }, usageMetadata = new { totalTokenCount = 100 }
    });
    private static HttpResponseMessage Json(object value) => new(HttpStatusCode.OK) { Content = JsonContent.Create(value) };
    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) => Task.FromResult(respond(request));
    }
    private sealed class Fixture : IDisposable {
        private readonly string directory = Path.Combine(Path.GetTempPath(), "els-content-repair-tests-" + Guid.NewGuid().ToString("N"));
        public AiCourseStore Store { get; }
        private readonly IConfiguration configuration;
        public Fixture() {
            configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["CourseGeneration:DataRoot"] = directory, ["CourseGenerationAi:ApiKey"] = "fake-key", ["CourseGenerationAi:Model"] = "gemini-test" }).Build();
            Store = new(configuration, new Environment());
        }
        public GeminiCourseClient Client(HttpClient http) => new(http, configuration, new(Store, TimeProvider.System, NullLogger<AiApiGateway>.Instance));
        public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
    private sealed class Environment : IWebHostEnvironment {
        public string ApplicationName { get; set; } = "Test"; public string EnvironmentName { get; set; } = "Testing";
        public string WebRootPath { get; set; } = ""; public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string ContentRootPath { get; set; } = ""; public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
