using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Services;
using EnglishLearning.Api.Services.CloudinaryMedia;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace EnglishLearning.Api.Tests;

public sealed partial class RegistrationSqlServerTests
{
    private async Task<HttpResponseMessage> UploadCourseAsset(byte[] bytes, string name, string kind)
    {
        using var form = new MultipartFormDataContent(); form.Add(new ByteArrayContent(bytes), "file", name); form.Add(new StringContent(kind), "kind");
        return await client.PostAsync("/api/v1/admin/uploads", form);
    }
    private async Task<UploadedMediaResponse> CourseAsset(string kind, byte variation = 0)
    {
        var bytes = kind == "cover" ? CloudinaryEnvironmentSmoke.Fixtures().Single(file => file.ResourceType == "image").Bytes : AudioFixture.Wave(variation);
        using var response = await UploadCourseAsset(bytes, kind == "cover" ? "cover.png" : "lesson.wav", kind);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<UploadedMediaResponse>())!;
    }
    private static string BackendAsset(UploadedMediaResponse asset) => "/api/v1/media/" + asset.Url.Split('/').Last();

    [SqlServerFact]
    public async Task Cloud_course_upload_draft_preview_publish_catalog_and_lesson_audio_keep_permissions()
    {
        var admin = await AuthoringAdmin(); var course = await NewAuthoringCourse();
        var cover = await CourseAsset("cover"); var listening = await CourseAsset("audio"); var speaking = await CourseAsset("audio", 1);
        Assert.False(Directory.Exists(mediaRoot));
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(BackendAsset(cover))).StatusCode); // Admin draft preview.
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}", new SaveCourseRequest { Title = course.Title, Description = course.Description, CoverImageUrl = cover.Url })).StatusCode);
        var speech = SpeakingLesson(audioUrl: speaking.Url);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}/lessons/{course.Lessons[0].LessonId}", speech)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}/lessons/{course.Lessons[1].LessonId}", ListeningLesson(listening.Url))).StatusCode);
        var learner = await SignIn(await RegisterLoginUser()); client.DefaultRequestHeaders.Authorization = new("Bearer", learner.AccessToken);
        var remote = (MemoryCloudTransport)factory.Services.GetRequiredService<ICloudinaryAssetTransport>(); var reads = remote.Reads;
        foreach (var asset in new[] { cover, listening, speaking }) Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(BackendAsset(asset))).StatusCode);
        Assert.Equal(reads, remote.Reads); Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/v1/courses/{course.CourseId}")).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", admin.AccessToken);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync($"/api/v1/admin/courses/{course.CourseId}/publish", null)).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", learner.AccessToken);
        var detail = await client.GetFromJsonAsync<CourseDetailResponse>($"/api/v1/courses/{course.CourseId}"); Assert.Equal(cover.Url, detail!.Course.CoverImageUrl);
        var catalog = await client.GetFromJsonAsync<CourseListResponse>("/api/v1/courses?search=" + Uri.EscapeDataString(course.Title));
        Assert.Contains(catalog!.Items, item => item.CourseId == course.CourseId && item.CoverImageUrl == cover.Url);
        foreach (var asset in new[] { listening, speaking })
        {
            using var range = new HttpRequestMessage(HttpMethod.Get, BackendAsset(asset)); range.Headers.Range = new(4, 15);
            using var response = await client.SendAsync(range); Assert.Equal(HttpStatusCode.PartialContent, response.StatusCode);
            Assert.Equal(12, (await response.Content.ReadAsByteArrayAsync()).Length); Assert.True(response.Headers.CacheControl?.NoStore);
            Assert.Equal($"bytes 4-15/{asset.Size}", response.Content.Headers.ContentRange?.ToString());
        }
        using var invalidRange = new HttpRequestMessage(HttpMethod.Get, BackendAsset(listening)); invalidRange.Headers.Range = new(999999, null);
        Assert.Equal(HttpStatusCode.RequestedRangeNotSatisfiable, (await client.SendAsync(invalidRange)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await UploadCourseAsset(AudioFixture.Wave(), "a.wav", "audio")).StatusCode);
    }

    [SqlServerFact]
    public async Task Speaking_text_does_not_grant_media_access_and_private_courses_only_allow_the_owner()
    {
        var admin = await AuthoringAdmin(); var course = await NewAuthoringCourse();
        var real = await CourseAsset("audio"); var unlinked = await CourseAsset("audio", 1);
        var speech = SpeakingLesson(audioUrl: real.Url, goals: "Mention only: " + unlinked.Url);
        await client.PutAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}/lessons/{course.Lessons[0].LessonId}", speech);
        await client.PutAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}/lessons/{course.Lessons[1].LessonId}", ListeningLesson());
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync($"/api/v1/admin/courses/{course.CourseId}/publish", null)).StatusCode);
        var learner = await SignIn(await RegisterLoginUser()); client.DefaultRequestHeaders.Authorization = new("Bearer", learner.AccessToken);
        var transport = (MemoryCloudTransport)factory.Services.GetRequiredService<ICloudinaryAssetTransport>(); var reads = transport.Reads;
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(BackendAsset(unlinked))).StatusCode); Assert.Equal(reads, transport.Reads);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(BackendAsset(real))).StatusCode);
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        await db.Lessons.Where(lesson => lesson.LessonId == course.Lessons[0].LessonId).ExecuteUpdateAsync(update => update.SetProperty(lesson => lesson.IsActive, false));
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(BackendAsset(real))).StatusCode);
        await db.Lessons.Where(lesson => lesson.LessonId == course.Lessons[0].LessonId).ExecuteUpdateAsync(update => update.SetProperty(lesson => lesson.IsActive, true));
        await db.Courses.Where(item => item.CourseId == course.CourseId).ExecuteUpdateAsync(update => update.SetProperty(item => item.SourceType, "user_upload").SetProperty(item => item.CreatedBy, learner.User.UserId));
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(BackendAsset(real))).StatusCode);
        var other = await SignIn(await RegisterLoginUser()); client.DefaultRequestHeaders.Authorization = new("Bearer", other.AccessToken);
        reads = transport.Reads; Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(BackendAsset(real))).StatusCode); Assert.Equal(reads, transport.Reads);
        await db.Users.Where(user => user.UserId == other.User.UserId).ExecuteUpdateAsync(update => update.SetProperty(user => user.IsActive, false));
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(BackendAsset(real))).StatusCode);
    }

    [SqlServerFact]
    public async Task Publish_checks_cached_cloud_asset_and_cloud_errors_preserve_the_draft()
    {
        await AuthoringAdmin(); var course = await NewAuthoringCourse(); var cover = await CourseAsset("cover");
        await client.PutAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}", new SaveCourseRequest { Title = course.Title, Description = course.Description, CoverImageUrl = cover.Url });
        await client.PutAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}/lessons/{course.Lessons[0].LessonId}", SpeakingLesson());
        await client.PutAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}/lessons/{course.Lessons[1].LessonId}", ListeningLesson());
        var remote = (MemoryCloudTransport)factory.Services.GetRequiredService<ICloudinaryAssetTransport>();
        var binary = remote.Items.Single(item => item.Value.Asset.ResourceType == "image"); remote.Items.TryRemove(binary.Key, out _);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync($"/api/v1/admin/courses/{course.CourseId}/publish", null)).StatusCode);
        remote.Items[binary.Key] = binary.Value; remote.RejectProbe = _ => new CloudMediaException(503, "media_storage_rate_limited", true, 10);
        using var failed = await client.PostAsync($"/api/v1/admin/courses/{course.CourseId}/publish", null);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, failed.StatusCode); Assert.Equal(TimeSpan.FromSeconds(10), failed.Headers.RetryAfter?.Delta);
        Assert.False((await client.GetFromJsonAsync<AdminCourseResponse>($"/api/v1/admin/courses/{course.CourseId}"))!.IsPublished);
        remote.RejectProbe = null; remote.FailManifest = true;
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await UploadCourseAsset(AudioFixture.Wave(), "a.wav", "audio")).StatusCode);
        Assert.False(Directory.Exists(mediaRoot));
    }
}
