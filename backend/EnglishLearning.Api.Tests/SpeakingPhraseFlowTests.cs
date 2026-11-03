using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace EnglishLearning.Api.Tests;

public sealed class SpeakingPhraseFlowTests
{
    [Fact]
    public async Task Phrase_reference_is_server_bound_and_history_preserves_scope_and_ownership_without_SQL()
    {
        const string text = "There is probably titanium in your eyeglass frames .";
        var root = Path.Combine(Path.GetTempPath(), "englishlearning-speaking-phrase-" + Guid.NewGuid().ToString("N"));
        var databaseName = Guid.NewGuid().ToString(); var scorer = new FakeScorer();
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseEnvironment("Development").ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?> {
                ["Jwt:SigningKey"] = TestJwt.SigningKey, ["ConnectionStrings:DefaultConnection"] = "test-only", ["SpeakingStorage:RootPath"] = root }))
            .ConfigureServices(services => {
                services.RemoveAll<EnglishLearningDbContext>();
                services.AddScoped(_ => new EnglishLearningDbContext(new DbContextOptionsBuilder<EnglishLearningDbContext>().UseInMemoryDatabase(databaseName).Options));
                services.RemoveAll<ISpeakingScorer>(); services.AddSingleton<ISpeakingScorer>(scorer);
            }));
        try
        {
            using var client = factory.CreateClient(); User owner, other; Lesson lesson, personal;
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
                owner = new User { Email = "owner@example.com", FullName = "Owner", PasswordHash = "test-only" };
                other = new User { Email = "other@example.com", FullName = "Other", PasswordHash = "test-only" };
                db.Users.AddRange(owner, other); await db.SaveChangesAsync();
                var publicCourse = new Course { Title = "Public", SourceType = "system", IsPublished = true };
                var privateCourse = new Course { Title = "Personal", SourceType = "user_upload", IsPublished = true, CreatedBy = other.UserId };
                db.Courses.AddRange(publicCourse, privateCourse); await db.SaveChangesAsync();
                Lesson Create(int id) => new() { CourseId = id, Title = "Phrase practice", SkillType = "speaking",
                    Content = JsonSerializer.Serialize(new { version = 1, speaking = new { goals = "Practice", sentences = new[] { new { text } } } }) };
                lesson = Create(publicCourse.CourseId); personal = Create(privateCourse.CourseId);
                db.Lessons.AddRange(lesson, personal); await db.SaveChangesAsync();
            }
            void SignIn(User user) => client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", factory.Services.GetRequiredService<JwtTokenService>().CreateToken(user).AccessToken);
            using (var anonymous = Form(lesson.LessonId, 0))
                Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/api/v1/speaking/attempts", anonymous)).StatusCode);
            SignIn(owner);
            var description = (await client.GetFromJsonAsync<SpeakingLessonResponse>($"/api/v1/speaking/lessons/{lesson.LessonId}"))!;
            Assert.Equal("phrase-v1", description.SegmentationVersion);
            Assert.Equal(["There is probably titanium", "in your eyeglass frames ."], description.Segments![0].Select(part => part.Text));
            foreach (var invalid in new[] { -1, 2, 30 })
            {
                using var form = Form(lesson.LessonId, invalid);
                Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/v1/speaking/attempts", form)).StatusCode);
            }
            using (var privateForm = Form(personal.LessonId, 0))
                Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync("/api/v1/speaking/attempts", privateForm)).StatusCode);
            Assert.Equal(0, scorer.Calls);
            using var phraseForm = Form(lesson.LessonId, 1);
            var response = await client.PostAsync("/api/v1/speaking/attempts", phraseForm);
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
            var phrase = (await response.Content.ReadFromJsonAsync<SpeakingAttemptResponse>())!;
            Assert.Equal("in your eyeglass frames .", scorer.LastText); Assert.Equal(scorer.LastText, phrase.ReferenceText);
            Assert.Equal(new SpeakingAttemptScope("segment", 1, 4, 4, text, "phrase-v1"), phrase.Scope);
            var restored = (await client.GetFromJsonAsync<SpeakingAttemptResponse>($"/api/v1/speaking/attempts/{phrase.AttemptId}"))!;
            Assert.Equal(phrase.Scope, restored.Scope); Assert.Equal(phrase.ReferenceText, restored.ReferenceText);
            var history = (await client.GetFromJsonAsync<SpeakingAttemptResponse[]>($"/api/v1/speaking/lessons/{lesson.LessonId}/attempts"))!;
            Assert.Equal(phrase.Scope, Assert.Single(history).Scope);
            SignIn(other);
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/v1/speaking/attempts/{phrase.AttemptId}")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(phrase.AudioUrl.Replace("/api/", "/api/v1/"))).StatusCode);
            Assert.Empty((await client.GetFromJsonAsync<SpeakingAttemptResponse[]>($"/api/v1/speaking/lessons/{lesson.LessonId}/attempts"))!);
            SignIn(owner);
            using var wholeForm = Form(lesson.LessonId, null);
            var wholeResponse = await client.PostAsync("/api/v1/speaking/attempts", wholeForm);
            Assert.Equal(HttpStatusCode.Created, wholeResponse.StatusCode);
            var whole = (await wholeResponse.Content.ReadFromJsonAsync<SpeakingAttemptResponse>())!;
            Assert.Equal(text, scorer.LastText); Assert.Equal(text, whole.ReferenceText); Assert.Null(whole.Scope);
            using var verify = factory.Services.CreateScope();
            Assert.Equal(2, await verify.ServiceProvider.GetRequiredService<EnglishLearningDbContext>().SpeakingAttempts.CountAsync());
        }
        finally
        {
            var absolute = Path.GetFullPath(root);
            if (!absolute.StartsWith(Path.GetFullPath(Path.GetTempPath()), StringComparison.OrdinalIgnoreCase) || !Path.GetFileName(absolute).StartsWith("englishlearning-speaking-phrase-", StringComparison.Ordinal))
                throw new InvalidOperationException("Unexpected phrase test path");
            if (Directory.Exists(absolute)) Directory.Delete(absolute, recursive: true);
        }
    }

    [Fact]
    public void Existing_version_one_JSON_without_scope_still_deserializes_as_full_sentence()
    {
        var value = JsonSerializer.Deserialize<StoredSpeakingResult>("{\"version\":1,\"sentenceIndex\":0,\"referenceText\":\"We call it bear\",\"assessment\":null}", SpeakingLessonService.JsonOptions);
        Assert.NotNull(value); Assert.Null(value.Scope); Assert.Equal(1, value.Version);
    }

    private static MultipartFormDataContent Form(int lessonId, int? segment)
    {
        var form = new MultipartFormDataContent();
        form.Add(new StringContent(lessonId.ToString()), "lessonId"); form.Add(new StringContent("0"), "sentenceIndex");
        if (segment is { } index) form.Add(new StringContent(index.ToString()), "segmentIndex");
        form.Add(new StringContent("Attacker text must not be scored"), "text");
        form.Add(new ByteArrayContent([.. "RIFF"u8, 0, 0, 0, 0, .. "WAVE"u8, .. new byte[40]]), "file", "recording.wav");
        return form;
    }
    private sealed class FakeScorer : ISpeakingScorer
    {
        public string? LastText; public int Calls;
        public Task<SpeakingAssessment> ScoreAsync(byte[] wav, string text, CancellationToken ct)
        {
            Calls++; LastText = text;
            var words = Regex.Matches(text.Replace('’', '\''), @"[A-Za-z]+(?:'[A-Za-z]+)*").Select((match, index) =>
                new SpeakingWordResult(index, match.Value, "scored", 1.5, [new("W", "w", 1.5, index * .01, index * .01 + .01)], null)).ToArray();
            return Task.FromResult(new SpeakingAssessment("scored", "phrase-test", 1, 75, 1, words.Length, words, [], "Test feedback"));
        }
    }
}
