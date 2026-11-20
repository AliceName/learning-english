using System.ComponentModel.DataAnnotations;
using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services;
using EnglishLearning.Api.Services.AiCourses;
using EnglishLearning.Api.Services.CloudinaryMedia;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace EnglishLearning.Api.Tests;

public sealed class AiCourseMultiSkillTests
{
    [Theory]
    [InlineData("[]", false)]
    [InlineData("[\"reading\",\"grammar\"]", true)]
    [InlineData("[\"reading\",\"reading\"]", false)]
    [InlineData("[\"unknown\"]", false)]
    [InlineData("null", false)]
    public void Skill_selection_rejects_empty_duplicate_and_unknown_values(string json, bool expected)
    {
        var config = new AiCourseConfig { Goal = "Learn English from this document", Skills = JsonSerializer.Deserialize<string[]>(json)! };
        Assert.Equal(expected, Validator.TryValidateObject(config, new ValidationContext(config), [], true));
    }

    [Fact]
    public void Outline_must_cover_each_selected_skill_and_keep_legacy_jobs_readable()
    {
        var legacy = JsonSerializer.Deserialize<AiCourseJob>("""{"config":{"goal":"Improve listening"},"outline":{"lessons":[{"title":"Listening"}]}}""", AiCourseStore.Json)!;
        Assert.Equal(["listening"], legacy.Config.Skills);
        Assert.Equal("listening", legacy.Outline!.Lessons[0].SkillType);
        var current = new AiCourseJob { ProtocolVersion = 2, Status = "generating" };
        var stored = JsonSerializer.Serialize(current, AiCourseStore.Json);
        Assert.Equal("v2:generating", JsonDocument.Parse(stored).RootElement.GetProperty("status").GetString());
        Assert.Equal("generating", JsonSerializer.Deserialize<AiCourseJob>(stored, AiCourseStore.Json)!.Status);
        var config = new AiCourseConfig { Skills = ["reading", "grammar"], LessonCount = 2 };
        Assert.True(AiCourseContent.MatchesSelection(config, [new() { SkillType = "reading" }, new() { SkillType = "grammar" }, new() { SkillType = "reading" }, new() { SkillType = "grammar" }]));
        Assert.False(AiCourseContent.MatchesSelection(config, [new() { SkillType = "reading" }, new() { SkillType = "grammar" }, new() { SkillType = "reading" }, new() { SkillType = "speaking" }]));
    }

    [Theory]
    [InlineData("all", 1, false, false)]
    [InlineData("all", 1, true, false)]
    [InlineData("reading,grammar", 2, false, false)]
    [InlineData("writing", 1, false, false)]
    [InlineData("all", 2, false, true)]
    public async Task Selected_skills_generate_complete_usable_private_lessons_with_tts_only_for_listening(string selected, int perSkill, bool failLastStepOnce, bool invalidReadingOnce)
    {
        var skills = selected == "all" ? AiCourseContent.Skills : selected.Split(',');
        var root = Path.Combine(Path.GetTempPath(), "els-multi-tests-" + Guid.NewGuid().ToString("N"));
        var database = Guid.NewGuid().ToString();
        var providerCalls = 0; var ttsCalls = 0; var writingCalls = 0; var injectedFailure = 0; var badReading = 0; var repairFeedback = 0;
        await using (var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Development")
            .ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(new Dictionary<string, string?> {
                ["Jwt:SigningKey"] = TestJwt.SigningKey, ["ConnectionStrings:DefaultConnection"] = "test-only",
                ["CourseGeneration:DataRoot"] = root, ["CourseGeneration:WorkerEnabled"] = "true", ["CourseGenerationAi:ApiKey"] = "fake-test-key",
                ["CourseGenerationAi:Model"] = "gemini-test", ["CourseGenerationAi:TtsModel"] = "gemini-test-tts",
                ["Cloudinary:Enabled"] = skills.Contains("listening").ToString(), ["Cloudinary:CloudName"] = "test", ["Cloudinary:ApiKey"] = "12345", ["Cloudinary:ApiSecret"] = "test-secret"
            }))
            .ConfigureServices(services => {
                services.RemoveAll<EnglishLearningDbContext>();
                services.AddScoped(_ => new EnglishLearningDbContext(new DbContextOptionsBuilder<EnglishLearningDbContext>().UseInMemoryDatabase(database).Options));
                services.AddHttpClient<GeminiCourseClient>().ConfigurePrimaryHttpMessageHandler(() => new Handler(request => {
                    Interlocked.Increment(ref providerCalls);
                    if (request.RequestUri!.AbsolutePath.Contains("-tts:")) {
                        Interlocked.Increment(ref ttsCalls);
                        return Provider(new { inlineData = new { mimeType = "audio/wav", data = Convert.ToBase64String(GeminiCourseClient.ToWav(new byte[24000 * 2 * 6], "audio/L16;rate=24000")) } });
                    }
                    using var body = JsonDocument.Parse(request.Content!.ReadAsStringAsync().GetAwaiter().GetResult());
                    using var input = JsonDocument.Parse(body.RootElement.GetProperty("contents")[0].GetProperty("parts")[0].GetProperty("text").GetString()!);
                    if (failLastStepOnce && input.RootElement.TryGetProperty("skillType", out var failingType) && failingType.GetString() == "grammar"
                        && Interlocked.Exchange(ref injectedFailure, 1) == 0)
                        return new(HttpStatusCode.ServiceUnavailable) { Content = JsonContent.Create(new { error = new { status = "UNAVAILABLE" } }) };
                    object value = input.RootElement.TryGetProperty("skillType", out var type) ? Sample(type.GetString()!) :
                        new { title = "Khóa học tổng hợp", summary = "Tài liệu về thói quen học.", description = "Đủ những kỹ năng đã chọn.",
                            lessons = skills.SelectMany(skill => Enumerable.Range(0, perSkill).Select(index => new { skillType = skill, title = $"{skill} {index + 1}", objective = "Phát triển kỹ năng theo chủ đề." })) };
                    if (invalidReadingOnce && type.ValueKind == JsonValueKind.String && type.GetString() == "reading" && Interlocked.Exchange(ref badReading, 1) == 0) {
                        var broken = JsonSerializer.SerializeToNode(value, AiCourseStore.Json)!;
                        broken["questions"]![0]!["reference"] = "A fabricated quote that is absent from the passage.";
                        return Provider(new { text = broken.ToJsonString() });
                    }
                    if (input.RootElement.TryGetProperty("validationFeedback", out var feedback)) {
                        Assert.Contains("reference_mismatch", feedback.GetRawText()); Interlocked.Increment(ref repairFeedback);
                    }
                    return Provider(new { text = JsonSerializer.Serialize(value, AiCourseStore.Json) });
                }));
                services.AddHttpClient<WritingAiClient>().ConfigurePrimaryHttpMessageHandler(() => new Handler(_ => {
                    Interlocked.Increment(ref writingCalls); return new(HttpStatusCode.OK) { Content = JsonContent.Create(new WritingAnalysis("B1", null, [], [])) };
                }));
                services.RemoveAll<ICloudMediaStore>(); services.AddSingleton<ICloudMediaStore, FakeMedia>();
            })))
        {
            using var client = factory.CreateClient();
            // The ten-lesson fixture needs more than the pilot's ten calls/minute;
            // quota behavior is covered separately with deliberately small limits.
            var testStore = factory.Services.GetRequiredService<AiCourseStore>();
            testStore.Write(testStore.PolicyFile, new AiApiPolicy { RequestsPerMinute = 100 });
            User owner, other;
            using (var scope = factory.Services.CreateScope()) {
                var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
                owner = new() { FullName = "Owner", Email = "owner@test.local", PasswordHash = "test" };
                other = new() { FullName = "Other", Email = "other@test.local", PasswordHash = "test" };
                db.Users.AddRange(owner, other); await db.SaveChangesAsync();
            }
            void Login(User user) => client.DefaultRequestHeaders.Authorization = new("Bearer", factory.Services.GetRequiredService<JwtTokenService>().CreateToken(user).AccessToken);
            Login(owner);
            var id = Guid.NewGuid(); var path = "/api/v1/ai-course-generations/" + id;
            client.DefaultRequestHeaders.Add("Idempotency-Key", id.ToString());
            using var form = new MultipartFormDataContent {
                { new ByteArrayContent(Document()), "file", "source.docx" },
                { new StringContent(JsonSerializer.Serialize(new AiCourseConfig { Goal = "Build every selected English skill", Skills = skills, LessonCount = perSkill }, AiCourseStore.Json)), "config" }
            };
            var accepted = await client.PostAsync("/api/v1/ai-course-generations", form);
            Assert.Equal(HttpStatusCode.Accepted, accepted.StatusCode);
            async Task<JsonElement> Wait(string target) {
                using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(25));
                while (true) {
                    var job = await client.GetFromJsonAsync<JsonElement>(path, deadline.Token);
                    if (job.GetProperty("status").GetString() == target) return job;
                    Assert.NotEqual("failed", job.GetProperty("status").GetString());
                    await Task.Delay(100, deadline.Token);
                }
            }
            var outline = await Wait("awaiting_outline");
            var planned = outline.GetProperty("outline").GetProperty("lessons").EnumerateArray().ToArray();
            Assert.Equal(skills.Length * perSkill, planned.Length);
            var incompleteEdit = await client.PutAsJsonAsync(path + "/outline", new { revision = 1, title = "Invalid", description = "Missing skill", lessons = planned.Skip(1).Select(lesson => new { id = lesson.GetProperty("id").GetGuid(), title = "Title", objective = "Goal" }) });
            Assert.Equal(HttpStatusCode.BadRequest, incompleteEdit.StatusCode);
            var edited = await client.PutAsJsonAsync(path + "/outline", new { revision = 1, title = "Khóa tôi chọn", description = "Nội dung đã duyệt.", lessons = planned.Select(lesson => new {
                id = lesson.GetProperty("id").GetGuid(), title = lesson.GetProperty("title").GetString(), objective = "Mục tiêu đã sửa.", skillType = "hacked"
            }) });
            Assert.Equal(HttpStatusCode.OK, edited.StatusCode);
            Assert.Equal(HttpStatusCode.Accepted, (await client.PostAsJsonAsync(path + "/generate", new { revision = 2 })).StatusCode);
            var review = await Wait("awaiting_review");
            Assert.Equal(planned.Length, review.GetProperty("completedLessons").GetInt32());
            Assert.Equal(skills.Contains("listening") ? perSkill : 0, ttsCalls);
            Assert.Equal(1 + planned.Length + ttsCalls + (failLastStepOnce ? 1 : 0) + (invalidReadingOnce ? 1 : 0), providerCalls);
            if (invalidReadingOnce) {
                Assert.Equal(1, repairFeedback);
                var calls = factory.Services.GetRequiredService<AiCourseStore>().Calls();
                var failed = Assert.Single(calls, call => call.ContentOutcome == "invalid");
                Assert.Equal("reference_mismatch", failed.ContentFailureCode);
                Assert.Equal(2, calls.Count(call => call.OperationId == failed.OperationId));
                Assert.All(calls.Where(call => call.OperationId != failed.OperationId), call => Assert.Equal(1, call.AttemptNo));
            }
            if (failLastStepOnce) {
                var stored = factory.Services.GetRequiredService<AiCourseStore>();
                var attempts = stored.Calls().Where(call => call.Operation == "grammar_text").OrderBy(call => call.AttemptNo).ToArray();
                Assert.Equal(2, attempts.Length);
                Assert.Equal(attempts[0].OperationId, attempts[1].OperationId);
                Assert.Equal(503, attempts[0].HttpStatus); Assert.Equal(200, attempts[1].HttpStatus);
                Assert.Equal(0, stored.Read<AiCourseJob>(stored.JobFile(id))!.TransientRetryCount);
            }
            var activation = await client.PostAsJsonAsync(path + "/activate", new { revision = 2 });
            Assert.Equal(HttpStatusCode.OK, activation.StatusCode);
            var saved = await activation.Content.ReadFromJsonAsync<JsonElement>(); var courseId = saved.GetProperty("courseId").GetInt32();
            Lesson[] lessons;
            using (var scope = factory.Services.CreateScope()) {
                var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
                lessons = await db.Lessons.AsNoTracking().OrderBy(lesson => lesson.OrderIndex).ToArrayAsync();
                Assert.Equal(planned.Length, lessons.Length);
                Assert.All(skills, skill => Assert.Equal(perSkill, lessons.Count(lesson => lesson.SkillType == skill)));
                Assert.All(lessons.Where(lesson => lesson.SkillType != "listening"), lesson => Assert.Null(lesson.AudioUrl));
                Assert.Equal(owner.UserId, (await db.Courses.SingleAsync()).CreatedBy);
            }
            foreach (var lesson in lessons) {
                if (lesson.SkillType == "speaking") Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/api/v1/speaking/lessons/{lesson.LessonId}")).StatusCode);
                if (lesson.SkillType == "grammar") Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/api/v1/courses/{courseId}/lessons/{lesson.LessonId}/grammar")).StatusCode);
                if (lesson.SkillType == "reading") {
                    var url = $"/api/v1/courses/{courseId}/lessons/{lesson.LessonId}/reading";
                    var data = await client.GetFromJsonAsync<JsonElement>(url);
                    Assert.Equal(JsonValueKind.Null, data.GetProperty("translation").ValueKind);
                    Assert.False(data.GetProperty("questions")[0].TryGetProperty("correctOptionIndex", out _));
                    var response = await client.PostAsJsonAsync(url + "/submissions", new { contentVersion = data.GetProperty("contentVersion").GetString(), answers = new[] { new { questionId = 0, optionIndex = 0 }, new { questionId = 1, optionIndex = 0 }, new { questionId = 2, optionIndex = 0 } } });
                    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
                    Assert.Equal(100m, (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("result").GetProperty("score").GetDecimal());
                    Login(other); Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(url)).StatusCode); Login(owner);
                }
                if (lesson.SkillType == "writing") {
                    var url = $"/api/v1/courses/{courseId}/lessons/{lesson.LessonId}/writing";
                    var data = await client.GetFromJsonAsync<JsonElement>(url);
                    var invalid = await client.PostAsJsonAsync(url + "/submissions", new { contentVersion = data.GetProperty("contentVersion").GetString(), originalText = "Too short" });
                    Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
                    var response = await client.PostAsJsonAsync(url + "/submissions", new { contentVersion = data.GetProperty("contentVersion").GetString(), originalText = string.Join(" ", Enumerable.Repeat("I study English every morning.", 10)) });
                    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
                    Assert.Equal("B1", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("cefrLevel").GetString());
                    using var scope = factory.Services.CreateScope();
                    Assert.Contains(await scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>().WritingSubmissions.ToListAsync(), item => item.LessonId == lesson.LessonId && item.UserId == owner.UserId);
                    Login(other); Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(url)).StatusCode); Login(owner);
                }
            }
            Assert.Equal(skills.Contains("writing") ? perSkill : 0, writingCalls);
            Login(other); Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(path)).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/v1/courses/{courseId}")).StatusCode);
        }
        if (Directory.Exists(root)) Directory.Delete(root, true);
    }

    private static object Sample(string skill) => skill switch {
        "listening" => new ListeningContent { Transcript = Passage, Questions = Enumerable.Range(0, 3).Select(_ => new ListeningQuestion { Prompt = "When does she study?", Options = ["Morning", "Evening"], CorrectOptionIndex = 0, Explanation = "Học vào buổi sáng." }).ToArray() },
        "speaking" => new SpeakingContent { Goals = "Luyện nói về thói quen.", Sentences = [new() { Text = "I study English every morning." }, new() { Text = "We read books at the library." }, new() { Text = "Small steps make a big difference." }] },
        "reading" => new ReadingContent { PassageTitle = "Study habits", Passage = Passage, Translation = "Linh học vào buổi sáng.", Vocabulary = [new() { Word = "morning", Meaning = "buổi sáng" }], Questions = Enumerable.Range(0, 3).Select(_ => new ReadingQuestion { Prompt = "When does she study?", Options = ["Morning", "Evening"], CorrectOptionIndex = 0, Explanation = "Học buổi sáng.", Reference = "every morning" }).ToArray() },
        "grammar" => new GrammarContent { Topic = "Present simple", Rules = "Dùng hiện tại đơn cho thói quen. Example: I study every day.", Questions = Enumerable.Range(0, 3).Select(_ => new GrammarQuestion { Prompt = "Choose the correct sentence.", Options = ["She studies.", "She study."], CorrectOptionIndex = 0, Explanation = "She dùng studies." }).ToArray() },
        "writing" => new WritingContent { TaskType = "paragraph", Topic = "Study habits", Prompt = "Describe your study habits.", Instructions = "Viết một đoạn văn.", MinWords = 40, MaxWords = 80, SampleAnswer = string.Join(" ", Enumerable.Repeat("I study English every morning.", 10)), Rubric = [new() { Name = "Content", Weight = 50 }, new() { Name = "Grammar", Weight = 50 }] },
        _ => throw new InvalidOperationException()
    };
    private const string Passage = "Linh studies English every morning. She reads stories and reviews new words. On Saturdays she meets her friend at the library to practise speaking.";
    private static HttpResponseMessage Provider(object part) => new(HttpStatusCode.OK) { Content = JsonContent.Create(new {
        candidates = new[] { new { finishReason = "STOP", content = new { parts = new[] { part } } } }, usageMetadata = new { totalTokenCount = 100 }
    }) };
    private static byte[] Document() {
        using var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, true))
        using (var writer = new StreamWriter(zip.CreateEntry("word/document.xml").Open())) writer.Write($"<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>{Passage}</w:t></w:r></w:p></w:body></w:document>");
        return stream.ToArray();
    }
    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> reply) : HttpMessageHandler {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) => Task.FromResult(reply(request));
    }
    private sealed class FakeMedia : ICloudMediaStore {
        public Task<CloudMediaManifest> StoreAsync(CloudMediaKind kind, string reference, ReadOnlyMemory<byte> bytes, string format, AudioAttribution? attribution, CancellationToken token) => Task.FromResult(new CloudMediaManifest(1, kind, reference, new("test", "test", "video", "upload", "wav", "1", bytes.Length), CloudMediaNames.Digest(bytes.Span), "audio/wav", bytes.Length, DateTime.UtcNow, null));
        public Task<CloudMediaManifest?> FindAsync(CloudMediaKind kind, string reference, CancellationToken token) => Task.FromResult<CloudMediaManifest?>(null);
        public Task<CloudMediaRead> OpenAsync(CloudMediaKind kind, string reference, string? range, CancellationToken token) => throw new NotSupportedException();
    }
}
