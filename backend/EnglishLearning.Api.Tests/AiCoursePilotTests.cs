using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services.AiCourses;
using EnglishLearning.Api.Services.CloudinaryMedia;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;

namespace EnglishLearning.Api.Tests;

public sealed class AiCoursePilotTests
{
    [Theory]
    [InlineData(400, false)]
    [InlineData(401, false)]
    [InlineData(403, false)]
    [InlineData(404, false)]
    [InlineData(429, true)]
    [InlineData(500, true)]
    [InlineData(503, true)]
    [InlineData(504, true)]
    public async Task Provider_errors_classify_transient_failures_and_keep_retry_after_and_usage(int status, bool retryable)
    {
        using var directory = new TestDirectory();
        var store = directory.Store;
        using var http = new HttpClient(new Handler(_ => {
            var response = JsonResponse(new { error = new { status = "UNAVAILABLE" } });
            response.StatusCode = (HttpStatusCode)status;
            response.Headers.RetryAfter = new RetryConditionHeaderValue(TimeSpan.FromSeconds(120));
            return response;
        }));
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> {
            ["CourseGenerationAi:ApiKey"] = "test-key", ["CourseGenerationAi:Model"] = "gemini-test"
        }).Build();
        var client = new GeminiCourseClient(http, configuration, Gateway(store));
        var error = await Assert.ThrowsAsync<AiCourseException>(() => client.PlanAsync(new AiCourseJob { Id = Guid.NewGuid(), UserId = 1 }, default));
        Assert.Equal(retryable, error.Retryable);
        Assert.Equal(120, error.RetryAfter);
        var call = Assert.Single(store.Calls());
        Assert.Equal(status, call.HttpStatus);
        Assert.Equal(call.OperationId, error.OperationId);
    }

    [Fact]
    public void Automatic_retries_back_off_stop_after_three_and_survive_serialization()
    {
        var now = DateTimeOffset.UtcNow;
        var operation = Guid.NewGuid();
        var failure = new AiCourseException(503, "ai_provider_error", "Busy", retryable: true) { OperationId = operation };
        var job = new AiCourseJob { ProtocolVersion = 2 };
        foreach (var expectedMinimum in new[] { 5, 10, 20 }) {
            Assert.True(AiCourseRetryPolicy.TrySchedule(job, failure, now));
            Assert.InRange((job.NextAttemptAt!.Value - now).TotalSeconds, expectedMinimum, expectedMinimum + 2);
            job = JsonSerializer.Deserialize<AiCourseJob>(JsonSerializer.Serialize(job, AiCourseStore.Json), AiCourseStore.Json)!;
        }
        Assert.False(AiCourseRetryPolicy.TrySchedule(job, failure, now));
        Assert.Null(job.NextAttemptAt);
        Assert.Equal(3, job.TransientRetryCount);
        var nextStep = new AiCourseException(503, "ai_provider_error", "Busy", retryAfter: 120, retryable: true) { OperationId = Guid.NewGuid() };
        Assert.True(AiCourseRetryPolicy.TrySchedule(job, nextStep, now));
        Assert.Equal(now.AddSeconds(120), job.NextAttemptAt);
        Assert.Equal(1, job.TransientRetryCount);
        Assert.False(AiCourseRetryPolicy.TrySchedule(job, new(503, "ai_configuration_error", "Bad key"), now));
        AiCourseRetryPolicy.Clear(job);
        Assert.Equal(0, job.TransientRetryCount);
        Assert.Null(job.RetryOperationId);
    }

    [Fact]
    public void Extracts_word_source_and_rejects_scan_or_malformed_input()
    {
        Assert.Contains("Healthy study", AiCourseSource.Extract(Document(), "docx", default));
        Assert.Equal("document_unreadable", Assert.Throws<AiCourseException>(() => AiCourseSource.Extract([1, 2], "pdf", default)).Code);
        Assert.Equal("document_unreadable", Assert.Throws<AiCourseException>(() => AiCourseSource.Extract([1, 2], "docx", default)).Code);
        Assert.Equal("source_too_short", Assert.Throws<AiCourseException>(() => AiCourseSource.Extract(Document("Too short"), "docx", default)).Code);
    }

    [Fact]
    public void Pcm_audio_is_wrapped_without_changing_samples_and_duration_is_validated()
    {
        var pcm = new byte[24000 * 2 * 6];
        var wav = GeminiCourseClient.ToWav(pcm, "audio/L16;codec=pcm;rate=24000");
        Assert.Equal(6m, GeminiCourseClient.WavSeconds(wav));
        Assert.Equal(pcm, wav[44..]);
        Assert.Same(wav, GeminiCourseClient.ToWav(wav, "audio/wav"));
        Assert.Throws<AiCourseException>(() => GeminiCourseClient.ToWav(pcm, "audio/mpeg"));
        Assert.Throws<AiCourseException>(() => GeminiCourseClient.WavSeconds(wav[..50]));
    }

    [Fact]
    public void Pdf_text_is_extracted_and_scanned_or_oversized_pdf_is_rejected()
    {
        using var document = new UglyToad.PdfPig.Writer.PdfDocumentBuilder();
        var page = document.AddPage(600, 800);
        var font = document.AddStandard14Font(UglyToad.PdfPig.Fonts.Standard14Fonts.Standard14Font.Helvetica);
        page.AddText("Healthy study habits help learners practise English every day.", 12, new(30, 750), font);
        page.AddText("Linh studies in the morning and meets Mai at the library on Saturdays.", 12, new(30, 730), font);
        Assert.Contains("Healthy study", AiCourseSource.Extract(document.Build(), "pdf", default));
        using var scan = new UglyToad.PdfPig.Writer.PdfDocumentBuilder();
        scan.AddPage(600, 800);
        Assert.Equal("source_too_short", Assert.Throws<AiCourseException>(() => AiCourseSource.Extract(scan.Build(), "pdf", default)).Code);
        for (var i = 0; i < 29; i++) scan.AddPage(600, 800);
        Assert.Equal("source_too_short", Assert.Throws<AiCourseException>(() => AiCourseSource.Extract(scan.Build(), "pdf", default)).Code);
        scan.AddPage(600, 800);
        Assert.Equal("too_many_pages", Assert.Throws<AiCourseException>(() => AiCourseSource.Extract(scan.Build(), "pdf", default)).Code);
    }

    [Fact]
    public async Task Gateway_reserves_atomically_across_instances_and_retains_unknown_usage()
    {
        using var directory = new TestDirectory();
        var store = directory.Store;
        store.Write(store.PolicyFile, new AiApiPolicy { CallsPerDay = 2, RequestsPerMinute = 100 });
        var calls = 0;
        using var http = new HttpClient(new Handler(_ => { Interlocked.Increment(ref calls); return JsonResponse(new { usageMetadata = new { totalTokenCount = "unknown", promptTokenCount = -1 } }); }));
        var context = new AiCallContext(Guid.NewGuid(), null, 1, "course_generation", "outline", "fake", 12000);
        async Task<bool> Send()
        {
            try { using var response = await Gateway(store).SendAsync(http, new(HttpMethod.Post, "https://test.invalid"), context, default); return true; }
            catch (AiCourseException error) { Assert.Equal(429, error.Status); return false; }
        }
        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Send()));
        Assert.Equal(2, results.Count(success => success));
        Assert.Equal(2, calls);
        Assert.Equal(new[] { 1, 2 }, store.Calls().OrderBy(call => call.AttemptNo).Select(call => call.AttemptNo));
        Assert.All(store.Calls(), call => { Assert.Null(call.TotalTokens); Assert.Equal(12000, call.ReservedTokens); });
        Assert.Equal(6, File.ReadLines(Path.Combine(store.Root, "quota-decisions.jsonl")).Count());
    }

    [Fact]
    public async Task Provider_cooldown_and_policy_version_survive_gateway_recreation()
    {
        using var directory = new TestDirectory();
        var store = directory.Store;
        using var http = new HttpClient(new Handler(_ => {
            var response = JsonResponse(new { error = "private provider message" }); response.StatusCode = HttpStatusCode.TooManyRequests;
            response.Headers.RetryAfter = new RetryConditionHeaderValue(TimeSpan.FromSeconds(30)); return response;
        }));
        using var first = await Gateway(store).SendAsync(http, new(HttpMethod.Post, "https://test.invalid"),
            new(Guid.NewGuid(), null, 1, "course_generation", "outline", "fake", 12000), default);
        var rejected = await Assert.ThrowsAsync<AiCourseException>(() => Gateway(store).SendAsync(http,
            new(HttpMethod.Post, "https://test.invalid"), new(Guid.NewGuid(), null, 1, "course_generation", "outline", "fake", 12000), default));
        Assert.Equal("ai_provider_cooldown", rejected.Code);
        Assert.Single(store.Calls());
        var updated = await Gateway(store).UpdatePolicyAsync(new(1, false, 5, 50, 10, 100000, "Pause testing"), 2, default);
        Assert.Equal(2, updated.Version);
        Assert.NotNull(updated.CooldownUntil);
        Assert.Equal(409, (await Assert.ThrowsAsync<AiCourseException>(() => Gateway(store).UpdatePolicyAsync(
            new(1, true, 5, 50, 10, 100000, "stale edit"), 2, default))).Status);
    }

    [Fact]
    public async Task Full_http_flow_is_private_idempotent_reviewed_and_logged()
    {
        using var directory = new TestDirectory();
        var database = Guid.NewGuid().ToString();
        var providerCalls = 0;
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Development")
            .ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(new Dictionary<string, string?> {
                ["Jwt:SigningKey"] = TestJwt.SigningKey, ["ConnectionStrings:DefaultConnection"] = "test-only",
                ["CourseGeneration:DataRoot"] = directory.Path, ["CourseGeneration:WorkerEnabled"] = "true", ["CourseGenerationAi:ApiKey"] = "fake-test-key",
                ["CourseGenerationAi:Model"] = "gemini-test", ["CourseGenerationAi:TtsModel"] = "gemini-test-tts",
                ["Cloudinary:Enabled"] = "true", ["Cloudinary:CloudName"] = "test", ["Cloudinary:ApiKey"] = "12345", ["Cloudinary:ApiSecret"] = "test-secret"
            }))
            .ConfigureServices(services => {
                services.RemoveAll<EnglishLearningDbContext>();
                services.AddScoped(_ => new EnglishLearningDbContext(new DbContextOptionsBuilder<EnglishLearningDbContext>().UseInMemoryDatabase(database).Options));
                services.AddHttpClient<GeminiCourseClient>().ConfigurePrimaryHttpMessageHandler(() => new Handler(request => {
                    var index = Interlocked.Increment(ref providerCalls);
                    if (index == 1) return GeminiText(new { title = "Thói quen học", summary = "Luyện nghe về thói quen.", description = "Bài học dựa trên tài liệu nguồn.", lessons = new[] { new { title = "Mỗi ngày học một ít", objective = "Nghe hiểu thói quen hằng ngày." } } });
                    if (index == 2) return GeminiText(Content());
                    var wav = GeminiCourseClient.ToWav(new byte[24000 * 2 * 6], "audio/L16;rate=24000");
                    return JsonResponse(new { candidates = new[] { new { finishReason = "STOP", content = new { parts = new[] { new { inlineData = new { mimeType = "audio/wav", data = Convert.ToBase64String(wav) } } } } } }, usageMetadata = new { promptTokenCount = 20, candidatesTokenCount = 40, totalTokenCount = 60 } });
                }));
                services.RemoveAll<ICloudMediaStore>(); services.AddSingleton<ICloudMediaStore, FakeMedia>();
            }));
        using var client = factory.CreateClient();
        User owner, other, admin;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
            owner = new() { Email = "owner@example.com", FullName = "Owner", PasswordHash = "test" };
            other = new() { Email = "other@example.com", FullName = "Other", PasswordHash = "test" };
            admin = new() { Email = "admin@example.com", FullName = "Admin", Role = "admin", PasswordHash = "test" };
            db.Users.AddRange(owner, other, admin); await db.SaveChangesAsync();
        }
        void SignIn(User user) => client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", factory.Services.GetRequiredService<JwtTokenService>().CreateToken(user).AccessToken);
        const string api = "/api/v1/ai-course-generations";
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(api)).StatusCode);
        SignIn(owner);
        var id = Guid.NewGuid(); client.DefaultRequestHeaders.Add("Idempotency-Key", id.ToString());
        var sourceBytes = Document();
        async Task<HttpResponseMessage> Create(string goal = "Listen to healthy study habits")
        {
            using var form = new MultipartFormDataContent {
                { new ByteArrayContent(sourceBytes), "file", "source.docx" },
                { new StringContent(JsonSerializer.Serialize(new AiCourseConfig { Goal = goal }, AiCourseStore.Json)), "config" }
            };
            return await client.PostAsync(api, form);
        }
        Assert.Equal(HttpStatusCode.Accepted, (await Create()).StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, (await Create()).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Create("A different goal")).StatusCode);
        async Task<JsonElement> WaitFor(string status)
        {
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(25));
            while (true)
            {
                var result = await client.GetFromJsonAsync<JsonElement>($"{api}/{id}", deadline.Token);
                if (result.GetProperty("status").GetString() == status) return result;
                Assert.NotEqual("failed", result.GetProperty("status").GetString());
                await Task.Delay(100, deadline.Token);
            }
        }
        var outline = await WaitFor("awaiting_outline");
        Assert.Equal(1, providerCalls);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync($"{api}/{id}/generate", new { revision = 99 })).StatusCode);
        SignIn(other); Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"{api}/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"{api}/{id}/source")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/v1/admin/ai/overview")).StatusCode);
        SignIn(owner);
        var originalLesson = outline.GetProperty("outline").GetProperty("lessons")[0];
        var edited = await client.PutAsJsonAsync($"{api}/{id}/outline", new {
            revision = 1, title = "Khóa riêng của tôi", description = "Nội dung đã duyệt.",
            lessons = new[] { new { id = originalLesson.GetProperty("id").GetGuid(), title = "Thói quen", objective = "Hiểu ý chính." } }
        });
        Assert.Equal(HttpStatusCode.OK, edited.StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostAsJsonAsync($"{api}/{id}/generate", new { revision = 2 })).StatusCode);
        var review = await WaitFor("awaiting_review");
        Assert.Equal(3, providerCalls);
        var lessonId = originalLesson.GetProperty("id").GetGuid();
        using var audioRequest = new HttpRequestMessage(HttpMethod.Get, $"{api}/{id}/audio/{lessonId}");
        audioRequest.Headers.Range = new RangeHeaderValue(0, 43);
        var audio = await client.SendAsync(audioRequest);
        Assert.Equal(HttpStatusCode.PartialContent, audio.StatusCode);
        Assert.Equal(44, (await audio.Content.ReadAsByteArrayAsync()).Length);
        var activation = await client.PostAsJsonAsync($"{api}/{id}/activate", new { revision = 2 });
        Assert.Equal(HttpStatusCode.OK, activation.StatusCode);
        var activated = await activation.Content.ReadFromJsonAsync<JsonElement>();
        var courseId = activated.GetProperty("courseId").GetInt32();
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync($"{api}/{id}/activate", new { revision = 2 })).StatusCode);
        string media;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
            var course = await db.Courses.SingleAsync(); Assert.Equal("user_upload", course.SourceType); Assert.Equal(owner.UserId, course.CreatedBy);
            Assert.Equal(AiCourseService.CoverUrl, course.CoverImageUrl);
            media = (await db.Lessons.SingleAsync()).AudioUrl!;
            Assert.Single(await db.UploadedDocuments.ToListAsync());
        }
        SignIn(other);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/v1/courses/{courseId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"{api}/{id}/audio/{lessonId}")).StatusCode);
        SignIn(admin);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"{api}/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(media.Replace("/api/media/", "/api/v1/media/"))).StatusCode);
        var usage = await client.GetFromJsonAsync<JsonElement>("/api/v1/admin/ai/overview");
        Assert.Equal(3, usage.GetProperty("counts").GetProperty("calls").GetInt32());
        Assert.Equal(1, usage.GetProperty("counts").GetProperty("ttsCalls").GetInt32());
        Assert.Equal(180, usage.GetProperty("tokens").GetProperty("reportedTotal").GetInt32());
        Assert.Equal(3, providerCalls);
    }

    private static ListeningContent Content() => new() {
        Transcript = "Linh studies for twenty minutes every morning. She meets Mai at the library on Saturdays.",
        Questions = [
            new() { Type = "multiple_choice", Prompt = "When does Linh study?", Options = ["Morning", "Evening"], CorrectOptionIndex = 0, Explanation = "Cô học vào buổi sáng." },
            new() { Type = "fill_blank", Prompt = "She studies for [blank] minutes.", Answer = "twenty", Explanation = "Thời lượng là hai mươi phút." },
            new() { Type = "multiple_choice", Prompt = "Where does she meet Mai?", Options = ["Library", "Park"], CorrectOptionIndex = 0, Explanation = "Hai người gặp ở thư viện." }
        ]
    };
    private static HttpResponseMessage GeminiText(object value) => JsonResponse(new {
        candidates = new[] { new { finishReason = "STOP", content = new { parts = new[] { new { text = JsonSerializer.Serialize(value, AiCourseStore.Json) } } } } },
        usageMetadata = new { promptTokenCount = 20, candidatesTokenCount = 40, totalTokenCount = 60 }
    });
    private static HttpResponseMessage JsonResponse(object value) => new(HttpStatusCode.OK) { Content = JsonContent.Create(value) };
    private static AiApiGateway Gateway(AiCourseStore store) => new(store, TimeProvider.System, NullLogger<AiApiGateway>.Instance);
    private static byte[] Document(string text = "Healthy study habits help learners practise English every day. Linh studies for twenty minutes in the morning and meets Mai at the library on Saturdays.")
    {
        using var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, true))
        using (var writer = new StreamWriter(zip.CreateEntry("word/document.xml").Open()))
            writer.Write($"<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>{System.Security.SecurityElement.Escape(text)}</w:t></w:r></w:p></w:body></w:document>");
        return stream.ToArray();
    }
    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) => Task.FromResult(respond(request));
    }
    private sealed class TestDirectory : IDisposable
    {
        public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "els-ai-tests-" + Guid.NewGuid().ToString("N"));
        public AiCourseStore Store => new(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["CourseGeneration:DataRoot"] = Path }).Build(), new TestEnvironment());
        public void Dispose() { if (Directory.Exists(Path)) Directory.Delete(Path, true); }
    }
    private sealed class TestEnvironment : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "Test"; public string EnvironmentName { get; set; } = "Testing";
        public string WebRootPath { get; set; } = ""; public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string ContentRootPath { get; set; } = ""; public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
    private sealed class FakeMedia : ICloudMediaStore
    {
        public Task<CloudMediaManifest> StoreAsync(CloudMediaKind kind, string reference, ReadOnlyMemory<byte> bytes, string format, AudioAttribution? attribution, CancellationToken token) => Task.FromResult(new CloudMediaManifest(1, kind, reference, new("test", "test", "video", "upload", "wav", "1", bytes.Length), CloudMediaNames.Digest(bytes.Span), "audio/wav", bytes.Length, DateTime.UtcNow, null));
        public Task<CloudMediaManifest?> FindAsync(CloudMediaKind kind, string reference, CancellationToken token) => Task.FromResult<CloudMediaManifest?>(null);
        public Task<CloudMediaRead> OpenAsync(CloudMediaKind kind, string reference, string? range, CancellationToken token) => throw new NotSupportedException();
    }
}
