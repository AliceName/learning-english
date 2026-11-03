using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
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

public sealed class SpeakingPhraseLiveTests
{
    [LiveSpeakingFact]
    public async Task Real_model_scores_server_selected_phrase_and_roundtrips_scope_without_SQL()
    {
        const string sentence = "We call it bear in the forest";
        var root = Path.Combine(Path.GetTempPath(), "englishlearning-phrase-live-" + Guid.NewGuid().ToString("N"));
        var database = Guid.NewGuid().ToString();
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseEnvironment("Development").ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?> {
                ["Jwt:SigningKey"] = TestJwt.SigningKey, ["ConnectionStrings:DefaultConnection"] = "test-only",
                ["SpeakingStorage:RootPath"] = root, ["SpeakingAi:BaseUrl"] = "http://127.0.0.1:8001" }))
            .ConfigureServices(services => {
                services.RemoveAll<EnglishLearningDbContext>();
                services.AddScoped(_ => new EnglishLearningDbContext(new DbContextOptionsBuilder<EnglishLearningDbContext>().UseInMemoryDatabase(database).Options));
            }));
        try
        {
            using var client = factory.CreateClient(); User user; Lesson lesson;
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
                user = new User { Email = "phrase-test@example.com", FullName = "Test", PasswordHash = "test-only" };
                db.Users.Add(user); await db.SaveChangesAsync();
                var course = new Course { Title = "Test only", SourceType = "system", IsPublished = true };
                db.Courses.Add(course); await db.SaveChangesAsync();
                lesson = new Lesson { CourseId = course.CourseId, Title = "Test only", SkillType = "speaking",
                    Content = JsonSerializer.Serialize(new { version = 1, speaking = new { goals = "Test", sentences = new[] { new { text = sentence } } } }) };
                db.Lessons.Add(lesson); await db.SaveChangesAsync();
            }
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", factory.Services.GetRequiredService<JwtTokenService>().CreateToken(user).AccessToken);
            var description = (await client.GetFromJsonAsync<SpeakingLessonResponse>($"/api/v1/speaking/lessons/{lesson.LessonId}"))!;
            Assert.Equal("We call it bear", description.Segments![0][0].Text);
            var bytes = await File.ReadAllBytesAsync(Environment.GetEnvironmentVariable("SPEAKING_LIVE_TEST_AUDIO")!);
            using var form = new MultipartFormDataContent();
            form.Add(new ByteArrayContent(bytes), "file", "recording.wav");
            form.Add(new StringContent(lesson.LessonId.ToString()), "lessonId"); form.Add(new StringContent("0"), "sentenceIndex");
            form.Add(new StringContent("0"), "segmentIndex"); form.Add(new StringContent("Untrusted text must be ignored"), "text");
            var response = await client.PostAsync("/api/v1/speaking/attempts", form);
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
            var result = (await response.Content.ReadFromJsonAsync<SpeakingAttemptResponse>())!;
            Assert.Equal("We call it bear", result.ReferenceText);
            Assert.Equal(new SpeakingAttemptScope("segment", 0, 0, 4, sentence, "phrase-v1"), result.Scope);
            Assert.StartsWith("gop-ctc-mlp-", result.Assessment.ModelVersion);
            Assert.NotNull(result.Assessment.Interpretation);
            Assert.True(SpeakingScorerClient.IsValid(result.Assessment, result.ReferenceText));
            var restored = (await client.GetFromJsonAsync<SpeakingAttemptResponse>($"/api/v1/speaking/attempts/{result.AttemptId}"))!;
            Assert.Equal(result.Scope, restored.Scope); Assert.Equal(result.Assessment.Interpretation, restored.Assessment.Interpretation);
            var history = (await client.GetFromJsonAsync<SpeakingAttemptResponse[]>($"/api/v1/speaking/lessons/{lesson.LessonId}/attempts"))!;
            Assert.Equal(result.Scope, Assert.Single(history).Scope);
            Assert.Equal(bytes, await client.GetByteArrayAsync(result.AudioUrl.Replace("/api/", "/api/v1/")));
            using var verify = factory.Services.CreateScope();
            Assert.Equal(1, await verify.ServiceProvider.GetRequiredService<EnglishLearningDbContext>().SpeakingAttempts.CountAsync());
        }
        finally
        {
            var absolute = Path.GetFullPath(root);
            if (!absolute.StartsWith(Path.GetFullPath(Path.GetTempPath()), StringComparison.OrdinalIgnoreCase) || !Path.GetFileName(absolute).StartsWith("englishlearning-phrase-live-", StringComparison.Ordinal))
                throw new InvalidOperationException("Unexpected phrase test path");
            if (Directory.Exists(absolute)) Directory.Delete(absolute, recursive: true);
        }
    }
}
