using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Tests;

public sealed class WritingApiTests
{
    private const string Essay = "She go to school every day. I like it.\nYesterday we eat rice.";

    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> reply) : HttpMessageHandler
    {
        public List<string> Bodies { get; } = [];
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Bodies.Add(request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken));
            return reply(request);
        }
    }

    private static HttpResponseMessage Gemini(object corrections) => new(HttpStatusCode.OK)
    {
        Content = JsonContent.Create(new
        {
            candidates = new[] { new { finishReason = "STOP", content = new { parts = new[] { new { text = JsonSerializer.Serialize(corrections) } } } } },
            usageMetadata = new { totalTokenCount = 42 }
        })
    };

    private static readonly object GoodAndBad = new
    {
        sentences = new object[]
        {
            new { original = "She go to school every day.", corrected = "She goes to school every day.",
                edits = new object[]
                {
                    new { original = "go", suggestion = "goes", category = "VERB:SVA", message = "Chủ ngữ số ít cần động từ thêm -s." },
                    new { original = "went", suggestion = "goes", category = "VERB:SVA", message = "Không có trong câu gốc." },
                    new { original = "go", suggestion = "goes", category = "STYLE", message = "Nhóm lạ." },
                } },
            new { original = "This sentence is not in the essay.", corrected = "Invented.", edits = Array.Empty<object>() },
            new { original = "Yesterday we eat rice.", corrected = "Yesterday we ate rice.",
                edits = new object[] { new { original = "we eat rice", suggestion = "we ate rice", category = "VERB:TENSE", message = "Có 'yesterday' nên dùng quá khứ." } } },
        },
        upgrades = new object[]
        {
            new { original = "I like it.", suggestion = "I really enjoy it.", kind = "vocabulary", level = "B2", term = "enjoy", message = "'Enjoy' cụ thể hơn 'like'." },
            new { original = "Not in the essay.", suggestion = "Better.", kind = "grammar", level = "B2", term = "", message = "Bịa." },
            new { original = "I like it.", suggestion = "I like it.", kind = "cohesion", level = "B2", term = "", message = "Không đổi gì." },
            new { original = "every day", suggestion = "on a daily basis", kind = "vocabulary", level = "C1", term = "absent term", message = "Term không có trong gợi ý." },
            new { original = "go to school", suggestion = "attend school", kind = "style", level = "B2", term = "", message = "Loại lạ." },
        }
    };

    private static IConfiguration Config(string? provider = null, string? key = "test-key") =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["WritingAi:Provider"] = provider, ["WritingAi:Api:ApiKey"] = key, ["WritingAi:Api:Model"] = "gemini-test",
        }).Build();

    private static WritingApiClient Api(Handler handler, IConfiguration configuration, int callsPerDay = 200)
    {
        var options = Options.Create(new WritingApiOptions { Model = "gemini-test", CallsPerDay = callsPerDay });
        return new(new HttpClient(handler), options, new WritingApiBudget(TimeProvider.System, options),
            TimeProvider.System, configuration, NullLogger<WritingApiClient>.Instance);
    }

    private static WritingAiClient Local(Handler handler) => new(new HttpClient(handler) { BaseAddress = new Uri("http://127.0.0.1:8000/") });

    private static Handler LocalService(string cefr = "B1") => new(request =>
    {
        var body = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
        var corrections = body.Contains("\"corrections\":true");
        return new(HttpStatusCode.OK)
        {
            Content = JsonContent.Create(new WritingAnalysis(cefr, corrections ? Essay.Replace("go to", "goes to") : null,
                corrections ? [new WritingSuggestion("She go to school every day.", "She goes to school every day.")] : [],
                ["CEFR là ước lượng thử nghiệm."], new WritingProvenance(CefrRun: "cefr-my-first-run", GecRun: "gec-local")))
        };
    });

    [Fact]
    public async Task Keeps_only_sentences_and_edits_that_quote_the_essay()
    {
        var result = await Api(new Handler(_ => Gemini(GoodAndBad)), Config()).CorrectAsync(Essay, null, default);

        Assert.Equal(2, result.Errors.Length);
        var first = result.Errors[0];
        Assert.Equal(0, first.SourceStart);
        Assert.Equal("She go to school every day.".Length, first.SourceEnd);
        var explanation = Assert.Single(first.Explanations!);
        Assert.Equal(("VERB:SVA", "go", "goes", WritingApiClient.TemplateVersion),
            (explanation.Category, explanation.Original, explanation.Suggestion, explanation.TemplateVersion));
        Assert.Equal(Essay.IndexOf("Yesterday", StringComparison.Ordinal), result.Errors[1].SourceStart);
        // Words shared on both sides are trimmed so the page can match the edit to its word-level change.
        var narrowed = Assert.Single(result.Errors[1].Explanations!);
        Assert.Equal(("eat", "ate"), (narrowed.Original, narrowed.Suggestion));
        Assert.Equal("She goes to school every day. I like it.\nYesterday we ate rice.", result.CorrectedText);
        Assert.Equal("gemini-test", result.Model);

        // Upgrades: kept only when they quote the essay, change it and use a known kind; a term must sit in the suggestion.
        Assert.Equal(2, result.Upgrades!.Length);
        var enjoy = result.Upgrades[0];
        Assert.Equal(("I like it.", "I really enjoy it.", "vocabulary", "B2", "enjoy"), (enjoy.Original, enjoy.Suggestion, enjoy.Kind, enjoy.Level, enjoy.Term));
        Assert.Equal("I like it.", Essay[enjoy.SourceStart..enjoy.SourceEnd]);
        Assert.Null(result.Upgrades[1].Term);
        Assert.Equal("on a daily basis", result.Upgrades[1].Suggestion);
    }

    [Fact]
    public async Task Tells_gemini_the_local_cefr_so_upgrades_aim_one_level_up()
    {
        var handler = new Handler(_ => Gemini(new { sentences = Array.Empty<object>(), upgrades = Array.Empty<object>() }));
        await Api(handler, Config()).CorrectAsync(Essay, "B1", default);
        Assert.Contains("estimated at B1", handler.Bodies.Single());
    }

    [Fact]
    public async Task Sends_only_the_essay_with_the_key_in_a_header()
    {
        string? key = null;
        var handler = new Handler(request => { key = request.Headers.GetValues("x-goog-api-key").Single(); return Gemini(new { sentences = Array.Empty<object>() }); });
        var result = await Api(handler, Config()).CorrectAsync(Essay, null, default);
        Assert.Empty(result.Errors);
        Assert.Equal(Essay, result.CorrectedText);
        Assert.Equal("test-key", key);
        Assert.DoesNotContain("test-key", handler.Bodies.Single());
    }

    [Fact]
    public async Task Missing_key_quota_and_provider_errors_are_reported_without_saving()
    {
        var calls = 0;
        var noKey = Api(new Handler(_ => { calls++; return Gemini(GoodAndBad); }), Config(key: null));
        Assert.Equal(503, (await Assert.ThrowsAsync<WritingAiException>(() => noKey.CorrectAsync(Essay, null, default))).StatusCode);
        Assert.Equal(0, calls);

        var limited = Api(new Handler(_ => Gemini(GoodAndBad)), Config(), callsPerDay: 1);
        await limited.CorrectAsync(Essay, null, default);
        await Assert.ThrowsAsync<WritingAiException>(() => limited.CorrectAsync(Essay, null, default));

        var throttled = Api(new Handler(_ => { calls++; return new HttpResponseMessage(HttpStatusCode.TooManyRequests); }), Config());
        await Assert.ThrowsAsync<WritingAiException>(() => throttled.CorrectAsync(Essay, null, default));
        await Assert.ThrowsAsync<WritingAiException>(() => throttled.CorrectAsync(Essay, null, default));
        Assert.Equal(1, calls); // paused after the first 429

        var broken = Api(new Handler(_ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"candidates\":[]}") }), Config());
        Assert.Equal(502, (await Assert.ThrowsAsync<WritingAiException>(() => broken.CorrectAsync(Essay, null, default))).StatusCode);
    }

    [Fact]
    public async Task Local_mode_is_unchanged_and_never_calls_the_api()
    {
        var api = new Handler(_ => throw new InvalidOperationException("API must not be called"));
        var local = LocalService();
        var router = new WritingAnalysisRouter(Local(local), Api(api, Config()), Config(), NullLogger<WritingAnalysisRouter>.Instance);
        var result = await router.AnalyzeAsync(new SubmitWritingRequest { OriginalText = Essay, Corrections = true }, default);
        Assert.Single(local.Bodies);
        Assert.Contains("\"corrections\":true", local.Bodies[0]);
        Assert.Equal("gec-local", result.Provenance!.GecRun);
        Assert.Null(result.Provenance.Provider);
    }

    [Fact]
    public async Task Api_mode_keeps_local_cefr_and_takes_corrections_from_gemini()
    {
        var local = LocalService("B2");
        var router = new WritingAnalysisRouter(Local(local), Api(new Handler(_ => Gemini(GoodAndBad)), Config()), Config("api"),
            NullLogger<WritingAnalysisRouter>.Instance);
        var result = await router.AnalyzeAsync(new SubmitWritingRequest { OriginalText = Essay, Corrections = true }, default);

        Assert.Contains("\"corrections\":false", Assert.Single(local.Bodies));
        Assert.Equal("B2", result.Cefr);
        Assert.Equal(2, result.Errors.Length);
        Assert.Null(result.GecCoverage);
        Assert.Equal("gemini", result.Provenance!.Provider);
        Assert.Equal("gemini:gemini-test", result.Provenance.GecRun);
        Assert.Equal("cefr-my-first-run", result.Provenance.CefrRun);
        Assert.Contains(WritingAnalysisRouter.ApiWarning, result.Warnings);
        Assert.Equal("enjoy", result.Upgrades![0].Term);
    }

    [Fact]
    public async Task Api_mode_reports_failures_while_auto_mode_falls_back_to_local()
    {
        var down = new Handler(_ => new HttpResponseMessage(HttpStatusCode.Forbidden));
        var apiOnly = new WritingAnalysisRouter(Local(LocalService()), Api(down, Config()), Config("api"), NullLogger<WritingAnalysisRouter>.Instance);
        await Assert.ThrowsAsync<WritingAiException>(() =>
            apiOnly.AnalyzeAsync(new SubmitWritingRequest { OriginalText = Essay, Corrections = true }, default));

        var local = LocalService();
        var auto = new WritingAnalysisRouter(Local(local), Api(down, Config()), Config("auto"), NullLogger<WritingAnalysisRouter>.Instance);
        var result = await auto.AnalyzeAsync(new SubmitWritingRequest { OriginalText = Essay, Corrections = true }, default);
        Assert.Equal(2, local.Bodies.Count);
        Assert.Equal("gec-local", result.Provenance!.GecRun);
        Assert.Contains(WritingAnalysisRouter.FallbackWarning, result.Warnings);
    }

    [Fact]
    public async Task Ineligible_essays_still_fail_before_the_api_is_called()
    {
        var apiCalls = 0;
        var local = new Handler(_ => new HttpResponseMessage(HttpStatusCode.UnprocessableEntity) { Content = JsonContent.Create(new { detail = "Quá ngắn." }) });
        var router = new WritingAnalysisRouter(Local(local), Api(new Handler(_ => { apiCalls++; return Gemini(GoodAndBad); }), Config()),
            Config("auto"), NullLogger<WritingAnalysisRouter>.Instance);
        var error = await Assert.ThrowsAsync<WritingAiException>(() =>
            router.AnalyzeAsync(new SubmitWritingRequest { OriginalText = "Hi.", Corrections = true }, default));
        Assert.Equal(422, error.StatusCode);
        Assert.Equal(0, apiCalls);
    }
}
