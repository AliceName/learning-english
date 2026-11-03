using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
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

public sealed class SpeakingFlowTests
{
    [Fact]
    public async Task Authenticated_flow_binds_reference_persists_history_and_prevents_cross_user_audio_access()
    {
        var root = Path.Combine(Path.GetTempPath(), "englishlearning-speaking-tests-" + Guid.NewGuid().ToString("N"));
        var databaseName = Guid.NewGuid().ToString(); var scorer = new FakeScorer();
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseEnvironment("Development").ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?> {
                    ["Jwt:SigningKey"] = TestJwt.SigningKey, ["ConnectionStrings:DefaultConnection"] = "test-only",
                    ["SpeakingStorage:RootPath"] = root }))
            .ConfigureServices(services => {
                services.RemoveAll<EnglishLearningDbContext>();
                services.AddScoped(_ => new EnglishLearningDbContext(new DbContextOptionsBuilder<EnglishLearningDbContext>().UseInMemoryDatabase(databaseName).Options));
                services.RemoveAll<ISpeakingScorer>(); services.AddSingleton<ISpeakingScorer>(scorer);
            }));
        try
        {
            using var client = factory.CreateClient();
            User owner, other; Lesson published, draft, personal;
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
                owner = new User { Email = "owner@example.com", FullName = "Owner", PasswordHash = "test-only" };
                other = new User { Email = "other@example.com", FullName = "Other", PasswordHash = "test-only" };
                db.Users.AddRange(owner, other); await db.SaveChangesAsync();
                var courses = new[] { new Course { Title = "Public", SourceType = "system", IsPublished = true },
                    new Course { Title = "Draft", SourceType = "system", IsPublished = false },
                    new Course { Title = "Personal", SourceType = "user_upload", CreatedBy = other.UserId, IsPublished = true } };
                db.Courses.AddRange(courses); await db.SaveChangesAsync();
                Lesson Create(int id) => new() { CourseId = id, Title = "Speaking", SkillType = "speaking", Content = "{\"version\":1,\"speaking\":{\"goals\":\"Practice\",\"sentences\":[{\"text\":\"We.\"}]}}" };
                published = Create(courses[0].CourseId); draft = Create(courses[1].CourseId); personal = Create(courses[2].CourseId);
                db.Lessons.AddRange(published, draft, personal); await db.SaveChangesAsync();
            }
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync($"/api/v1/speaking/lessons/{published.LessonId}")).StatusCode);
            void SignIn(User user) => client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", factory.Services.GetRequiredService<JwtTokenService>().CreateToken(user).AccessToken);
            SignIn(owner);
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/v1/speaking/lessons/{draft.LessonId}")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/v1/speaking/lessons/{personal.LessonId}")).StatusCode);
            using (var wrong = Form(published.LessonId, 99))
                Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/v1/speaking/attempts", wrong)).StatusCode);
            using var form = Form(published.LessonId, 0);
            var response = await client.PostAsync("/api/v1/speaking/attempts", form);
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
            var attempt = (await response.Content.ReadFromJsonAsync<SpeakingAttemptResponse>())!;
            Assert.Equal("We.", scorer.LastText); Assert.Equal("We.", attempt.ReferenceText);
            Assert.Single((await client.GetFromJsonAsync<SpeakingAttemptResponse[]>($"/api/v1/speaking/lessons/{published.LessonId}/attempts"))!);
            using var audioRequest = new HttpRequestMessage(HttpMethod.Get, attempt.AudioUrl.Replace("/api/", "/api/v1/"));
            audioRequest.Headers.Range = new RangeHeaderValue(0, 15);
            Assert.Equal(HttpStatusCode.PartialContent, (await client.SendAsync(audioRequest)).StatusCode);
            SignIn(other);
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/v1/speaking/attempts/{attempt.AttemptId}")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(attempt.AudioUrl.Replace("/api/", "/api/v1/"))).StatusCode);
            Assert.Empty((await client.GetFromJsonAsync<SpeakingAttemptResponse[]>($"/api/v1/speaking/lessons/{published.LessonId}/attempts"))!);
            SignIn(owner); scorer.Fail = true;
            using (var retry = Form(published.LessonId, 0))
                Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.PostAsync("/api/v1/speaking/attempts", retry)).StatusCode);
            using var verify = factory.Services.CreateScope();
            Assert.Equal(1, await verify.ServiceProvider.GetRequiredService<EnglishLearningDbContext>().SpeakingAttempts.CountAsync());
            Assert.Single(Directory.GetFiles(root));
        }
        finally
        {
            var absolute = Path.GetFullPath(root);
            if (!absolute.StartsWith(Path.GetFullPath(Path.GetTempPath()), StringComparison.OrdinalIgnoreCase)
                || !Path.GetFileName(absolute).StartsWith("englishlearning-speaking-tests-", StringComparison.Ordinal))
                throw new InvalidOperationException("Unexpected test storage path");
            if (Directory.Exists(absolute)) Directory.Delete(absolute, recursive: true);
        }
    }
    private static MultipartFormDataContent Form(int lesson, int sentence)
    {
        var form = new MultipartFormDataContent();
        form.Add(new StringContent(lesson.ToString()), "lessonId"); form.Add(new StringContent(sentence.ToString()), "sentenceIndex");
        form.Add(new StringContent("Injected reference must be ignored"), "text");
        using var memory = new MemoryStream(); using var writer = new BinaryWriter(memory);
        writer.Write("RIFF"u8); writer.Write(36 + 32000); writer.Write("WAVEfmt "u8); writer.Write(16); writer.Write((short)1); writer.Write((short)1);
        writer.Write(16000); writer.Write(32000); writer.Write((short)2); writer.Write((short)16); writer.Write("data"u8); writer.Write(32000);
        for (var i = 0; i < 16000; i++) writer.Write((short)(3000 * Math.Sin(2 * Math.PI * 200 * i / 16000)));
        form.Add(new ByteArrayContent(memory.ToArray()), "file", "recording.wav"); return form;
    }
    private sealed class FakeScorer : ISpeakingScorer
    {
        public bool Fail; public string? LastText;
        public Task<SpeakingAssessment> ScoreAsync(byte[] wav, string text, CancellationToken ct)
        {
            LastText = text;
            if (Fail) throw new SpeakingException(503, "Test service unavailable");
            return Task.FromResult(new SpeakingAssessment("scored", "test-model", 1, 75, 1, 2,
                [new(0, "We", "scored", 1.5, [new("W", "w", 1, .1, .2), new("IY1", "iː", 2, .3, .4)], null)], [], "Nghe lại bản ghi."));
        }
    }
}
