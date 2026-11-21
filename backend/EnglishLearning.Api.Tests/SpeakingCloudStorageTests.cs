using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services;
using EnglishLearning.Api.Services.CloudinaryMedia;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Tests;

public sealed class SpeakingCloudStorageTests
{
    private static readonly string Reference = new('b', 32);
    private static CloudinaryMediaStore Store(MemoryCloudTransport remote) => new(remote,
        Options.Create(new CloudinarySettings { EnvironmentPrefix = "els/test" }), Options.Create(new CloudinaryMediaOptions()), TimeProvider.System);

    [Fact]
    public async Task Recording_is_stored_privately_without_admin_lookup_and_deleted_completely()
    {
        var remote = new MemoryCloudTransport();
        using var store = Store(remote);
        var saved = await store.StoreAsync(CloudMediaKind.SpeakingRecording, Reference, AudioFixture.Wave(), "wav", null, default);
        Assert.Equal("els/test/speaking/recordings/" + Reference, saved.Asset.PublicId);
        Assert.Equal("authenticated", saved.Asset.DeliveryType);
        Assert.Contains("els/test/speaking/references/" + Reference + ".json", remote.Items.Keys);
        Assert.Equal(0, remote.Stats);

        await store.DeleteAsync(CloudMediaKind.SpeakingRecording, Reference, default);
        Assert.Empty(remote.Items);
        Assert.Null(await Store(remote).FindAsync(CloudMediaKind.SpeakingRecording, Reference, default));
    }

    [Fact]
    public async Task Only_small_wav_recordings_are_accepted_and_shared_media_cannot_be_deleted()
    {
        using var store = Store(new MemoryCloudTransport());
        var tooLarge = new byte[SpeakingStorage.MaxBytes + 1]; AudioFixture.Wave().CopyTo(tooLarge, 0);
        Assert.Equal("invalid_media_size", (await Assert.ThrowsAsync<CloudMediaException>(() =>
            store.StoreAsync(CloudMediaKind.SpeakingRecording, Reference, tooLarge, "wav", null, default))).Code);
        Assert.Equal("invalid_media_format", (await Assert.ThrowsAsync<CloudMediaException>(() =>
            store.StoreAsync(CloudMediaKind.SpeakingRecording, Reference, AudioFixture.Wave(), "mp3", null, default))).Code);
        Assert.Equal("media_delete_not_allowed", (await Assert.ThrowsAsync<CloudMediaException>(() =>
            store.DeleteAsync(CloudMediaKind.CourseAudio, Reference, default))).Code);
        var names = new CloudMediaNames("els/test");
        Assert.Throws<CloudMediaException>(() => names.EnsureDeletable("els/test/courses/audio/" + Reference, "video"));
        Assert.Throws<CloudMediaException>(() => names.EnsureDeletable("els/test/dictionary/audio/" + new string('c', 64), "video"));
        Assert.Throws<CloudMediaException>(() => names.EnsureDeletable("els/test/speaking/recordings/../x", "video"));
    }

    [Fact]
    public async Task Cloud_flow_streams_owner_audio_keeps_score_when_upload_fails_and_prunes_old_recordings()
    {
        var remote = new MemoryCloudTransport();
        var root = Path.Combine(Path.GetTempPath(), "englishlearning-speaking-tests-" + Guid.NewGuid().ToString("N"));
        var databaseName = Guid.NewGuid().ToString();
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseEnvironment("Development").ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?> {
                    ["Jwt:SigningKey"] = TestJwt.SigningKey, ["ConnectionStrings:DefaultConnection"] = "test-only",
                    ["SpeakingStorage:RootPath"] = root, ["Cloudinary:Enabled"] = "true", ["Cloudinary:AllowLegacyReads"] = "false",
                    ["Cloudinary:CloudName"] = "test-cloud", ["Cloudinary:ApiKey"] = "123456789", ["Cloudinary:ApiSecret"] = "test-only-secret",
                    ["Cloudinary:EnvironmentPrefix"] = "els/test" }))
            .ConfigureServices(services => {
                services.RemoveAll<EnglishLearningDbContext>();
                services.AddScoped(_ => new EnglishLearningDbContext(new DbContextOptionsBuilder<EnglishLearningDbContext>().UseInMemoryDatabase(databaseName).Options));
                services.RemoveAll<ISpeakingScorer>(); services.AddSingleton<ISpeakingScorer>(new Scorer());
                services.RemoveAll<ICloudMediaStore>(); services.AddSingleton<ICloudMediaStore>(_ => Store(remote));
            }));
        using var client = factory.CreateClient();
        User owner, other; Lesson lesson;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
            owner = new User { Email = "owner@example.com", FullName = "Owner", PasswordHash = "test-only" };
            other = new User { Email = "other@example.com", FullName = "Other", PasswordHash = "test-only" };
            db.Users.AddRange(owner, other);
            var course = new Course { Title = "Public", SourceType = "system", IsPublished = true };
            db.Courses.Add(course); await db.SaveChangesAsync();
            lesson = new Lesson { CourseId = course.CourseId, Title = "Speaking", SkillType = "speaking",
                Content = "{\"version\":1,\"speaking\":{\"goals\":\"Practice\",\"sentences\":[{\"text\":\"We.\"}]}}" };
            db.Lessons.Add(lesson); await db.SaveChangesAsync();
        }
        void SignIn(User user) => client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", factory.Services.GetRequiredService<JwtTokenService>().CreateToken(user).AccessToken);
        async Task<SpeakingAttemptResponse> Submit()
        {
            using var form = Form(lesson.LessonId);
            var response = await client.PostAsync("/api/v1/speaking/attempts", form);
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
            return (await response.Content.ReadFromJsonAsync<SpeakingAttemptResponse>())!;
        }

        SignIn(owner);
        var first = await Submit();
        Assert.Matches(@"\A/api/speaking/recordings/[a-f0-9]{32}\.wav\z", first.AudioUrl);
        var reference = first.AudioUrl[^36..^4];
        Assert.Contains("els/test/speaking/recordings/" + reference, remote.Items.Keys);
        Assert.False(Directory.Exists(root));
        using (var ranged = new HttpRequestMessage(HttpMethod.Get, first.AudioUrl.Replace("/api/", "/api/v1/")))
        {
            ranged.Headers.Range = new RangeHeaderValue(0, 15);
            var audio = await client.SendAsync(ranged);
            Assert.Equal(HttpStatusCode.PartialContent, audio.StatusCode);
            Assert.Equal(16, (await audio.Content.ReadAsByteArrayAsync()).Length);
            Assert.True(audio.Headers.CacheControl is { Private: true, NoStore: true });
        }
        using (var beyond = new HttpRequestMessage(HttpMethod.Get, first.AudioUrl.Replace("/api/", "/api/v1/")))
        {
            beyond.Headers.Range = new RangeHeaderValue(999999, null);
            var audio = await client.SendAsync(beyond);
            Assert.Equal(HttpStatusCode.RequestedRangeNotSatisfiable, audio.StatusCode);
            Assert.Equal("bytes */32044", audio.Content.Headers.ContentRange?.ToString());
            Assert.Empty(await audio.Content.ReadAsByteArrayAsync());
        }
        SignIn(other);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(first.AudioUrl.Replace("/api/", "/api/v1/"))).StatusCode);

        SignIn(owner);
        remote.Reject = id => id.Contains("/speaking/", StringComparison.Ordinal) ? new CloudMediaException(503, "media_storage_quota_exceeded") : null;
        var unstored = await Submit();
        Assert.Equal("", unstored.AudioUrl);
        Assert.Equal(75, unstored.Assessment.OverallScore);
        remote.Reject = null;

        for (var i = 0; i < 20; i++) await Submit();
        using var verify = factory.Services.CreateScope();
        var rows = await verify.ServiceProvider.GetRequiredService<EnglishLearningDbContext>().SpeakingAttempts.AsNoTracking()
            .OrderByDescending(a => a.CreatedAt).ThenByDescending(a => a.AttemptId).ToListAsync();
        Assert.Equal(22, rows.Count);
        Assert.All(rows.Take(20), row => Assert.NotEqual("", row.AudioUrl));
        Assert.All(rows.Skip(20), row => Assert.Equal("", row.AudioUrl));
        Assert.DoesNotContain("els/test/speaking/recordings/" + reference, remote.Items.Keys);
        Assert.Equal(40, remote.Items.Count);
    }

    private static MultipartFormDataContent Form(int lesson)
    {
        var form = new MultipartFormDataContent();
        form.Add(new StringContent(lesson.ToString()), "lessonId"); form.Add(new StringContent("0"), "sentenceIndex");
        using var memory = new MemoryStream(); using var writer = new BinaryWriter(memory);
        writer.Write("RIFF"u8); writer.Write(36 + 32000); writer.Write("WAVEfmt "u8); writer.Write(16); writer.Write((short)1); writer.Write((short)1);
        writer.Write(16000); writer.Write(32000); writer.Write((short)2); writer.Write((short)16); writer.Write("data"u8); writer.Write(32000);
        for (var i = 0; i < 16000; i++) writer.Write((short)(3000 * Math.Sin(2 * Math.PI * 200 * i / 16000)));
        form.Add(new ByteArrayContent(memory.ToArray()), "file", "recording.wav");
        return form;
    }

    private sealed class Scorer : ISpeakingScorer
    {
        public Task<SpeakingAssessment> ScoreAsync(byte[] wav, string text, CancellationToken ct, SpeakingAttemptScope? scope = null) =>
            Task.FromResult(new SpeakingAssessment("scored", "test-model", 1, 75, 1, 2,
                [new(0, "We", "scored", 1.5, [new("W", "w", 1, .1, .2), new("IY1", "iː", 2, .3, .4)], null)], [], "Nghe lại bản ghi."));
    }
}
