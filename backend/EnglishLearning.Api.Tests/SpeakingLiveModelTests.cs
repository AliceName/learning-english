using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace EnglishLearning.Api.Tests;

public sealed class LiveSpeakingFactAttribute : FactAttribute
{
    public LiveSpeakingFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("SPEAKING_LIVE_TEST_AUDIO")))
            Skip = "Set SPEAKING_LIVE_TEST_AUDIO and run the local Python model service to test real inference.";
    }
}

public sealed class SpeakingLiveModelTests
{
    [LiveSpeakingFact]
    public async Task Real_python_model_scores_audio_and_dotnet_persists_owned_result_without_SQL_writes()
    {
        var root = Path.Combine(Path.GetTempPath(), "englishlearning-speaking-live-" + Guid.NewGuid().ToString("N"));
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
                user = new User { Email = "test@example.com", FullName = "Test learner", PasswordHash = "test-only" };
                db.Users.Add(user); await db.SaveChangesAsync();
                var course = new Course { Title = "Test only", SourceType = "system", IsPublished = true };
                db.Courses.Add(course); await db.SaveChangesAsync();
                lesson = new Lesson { CourseId = course.CourseId, Title = "Test only", SkillType = "speaking",
                    Content = "{\"version\":1,\"speaking\":{\"goals\":\"Test\",\"sentences\":[{\"text\":\"We call it bear\"}]}}" };
                db.Lessons.Add(lesson); await db.SaveChangesAsync();
            }
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", factory.Services.GetRequiredService<JwtTokenService>().CreateToken(user).AccessToken);
            var audio = await File.ReadAllBytesAsync(Environment.GetEnvironmentVariable("SPEAKING_LIVE_TEST_AUDIO")!);
            using var form = new MultipartFormDataContent();
            form.Add(new ByteArrayContent(audio), "file", "recording.wav"); form.Add(new StringContent(lesson.LessonId.ToString()), "lessonId"); form.Add(new StringContent("0"), "sentenceIndex");
            var response = await client.PostAsync("/api/v1/speaking/attempts", form);
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
            var result = (await response.Content.ReadFromJsonAsync<SpeakingAttemptResponse>())!;
            Assert.StartsWith("gop-ctc-mlp-", result.Assessment.ModelVersion);
            Assert.InRange(result.Assessment.OverallScore, 0, 100);
            Assert.InRange(result.Assessment.Coverage, .01, 1);
            Assert.NotEmpty(result.Assessment.Words.SelectMany(w => w.Phones));
            Assert.NotNull(result.Assessment.Interpretation);
            Assert.StartsWith("cal1-", result.Assessment.Interpretation.CalibrationVersion);
            Assert.InRange(result.Assessment.Interpretation.PracticeThreshold, .25, 1.95);
            Assert.All(result.Assessment.Words.SelectMany(w => w.Phones), phone => Assert.NotNull(phone.RawScore));
            var restored = (await client.GetFromJsonAsync<SpeakingAttemptResponse>($"/api/v1/speaking/attempts/{result.AttemptId}"))!;
            Assert.Equal(result.Assessment.Interpretation, restored.Assessment.Interpretation);
            Assert.Equal(result.Assessment.Words.SelectMany(w => w.Phones).Select(p => p.RawScore),
                restored.Assessment.Words.SelectMany(w => w.Phones).Select(p => p.RawScore));
            var history = (await client.GetFromJsonAsync<SpeakingAttemptResponse[]>($"/api/v1/speaking/lessons/{lesson.LessonId}/attempts"))!;
            Assert.Equal(result.Assessment.Interpretation, Assert.Single(history).Assessment.Interpretation);
            Assert.Equal(audio, await client.GetByteArrayAsync(result.AudioUrl.Replace("/api/", "/api/v1/")));
            using var verify = factory.Services.CreateScope();
            Assert.Equal(1, await verify.ServiceProvider.GetRequiredService<EnglishLearningDbContext>().SpeakingAttempts.CountAsync());
        }
        finally
        {
            var absolute = Path.GetFullPath(root);
            if (!absolute.StartsWith(Path.GetFullPath(Path.GetTempPath()), StringComparison.OrdinalIgnoreCase) || !Path.GetFileName(absolute).StartsWith("englishlearning-speaking-live-", StringComparison.Ordinal))
                throw new InvalidOperationException("Unexpected live test path");
            if (Directory.Exists(absolute)) Directory.Delete(absolute, recursive: true);
        }
    }
}
