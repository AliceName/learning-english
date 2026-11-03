using System.Net;
using System.Net.Http.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Services.CloudinaryMedia;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace EnglishLearning.Api.Tests;

public sealed partial class RegistrationSqlServerTests
{
    private static SaveLessonRequest IllustratedReading(string? url, string passage = "Residents use electric buses.") => ReadingLesson(new ReadingContent
    {
        PassageTitle = "A greener city", Passage = passage, ImageUrl = url,
        ImageAlt = "An electric bus in the city", ImageCaption = "Public transport in Riverton",
        Questions = [new ReadingQuestion { Prompt = "Which transport is mentioned?", Options = ["Bus", "Train"], CorrectOptionIndex = 0 }]
    });

    [SqlServerFact]
    public async Task Reading_image_round_trips_and_only_visible_active_references_grant_media_access()
    {
        var admin = await AuthoringAdmin(); var course = await NewReadingWritingCourse(["reading"]);
        var image = await CourseAsset("cover"); var unlinked = await CourseAsset("cover");
        var path = $"/api/v1/admin/courses/{course.CourseId}/lessons/{course.Lessons[0].LessonId}";
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync(path, IllustratedReading(image.Url, "Mention only: " + unlinked.Url))).StatusCode);
        var saved = (await client.GetFromJsonAsync<AdminCourseResponse>($"/api/v1/admin/courses/{course.CourseId}"))!.Lessons[0].Reading!;
        Assert.Equal(image.Url, saved.ImageUrl); Assert.Equal("An electric bus in the city", saved.ImageAlt); Assert.Equal("Public transport in Riverton", saved.ImageCaption);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(BackendAsset(image))).StatusCode);
        var learner = await SignIn(await RegisterLoginUser()); client.DefaultRequestHeaders.Authorization = new("Bearer", learner.AccessToken);
        var transport = (MemoryCloudTransport)factory.Services.GetRequiredService<ICloudinaryAssetTransport>(); var reads = transport.Reads;
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(BackendAsset(image))).StatusCode); Assert.Equal(reads, transport.Reads);
        client.DefaultRequestHeaders.Authorization = new("Bearer", admin.AccessToken);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync($"/api/v1/admin/courses/{course.CourseId}/publish", null)).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", learner.AccessToken);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(BackendAsset(image))).StatusCode);
        reads = transport.Reads; Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(BackendAsset(unlinked))).StatusCode); Assert.Equal(reads, transport.Reads);
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        await db.Lessons.Where(lesson => lesson.LessonId == course.Lessons[0].LessonId).ExecuteUpdateAsync(update => update.SetProperty(lesson => lesson.IsActive, false));
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(BackendAsset(image))).StatusCode);
        await db.Lessons.Where(lesson => lesson.LessonId == course.Lessons[0].LessonId).ExecuteUpdateAsync(update => update.SetProperty(lesson => lesson.IsActive, true));
        client.DefaultRequestHeaders.Authorization = new("Bearer", admin.AccessToken);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync($"/api/v1/admin/courses/{course.CourseId}/hide", null)).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", learner.AccessToken);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(BackendAsset(image))).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", admin.AccessToken);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync($"/api/v1/admin/courses/{course.CourseId}/publish", null)).StatusCode);
        await db.Courses.Where(item => item.CourseId == course.CourseId).ExecuteUpdateAsync(update => update.SetProperty(item => item.SourceType, "user_upload").SetProperty(item => item.CreatedBy, learner.User.UserId));
        client.DefaultRequestHeaders.Authorization = new("Bearer", learner.AccessToken);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(BackendAsset(image))).StatusCode);
        var other = await SignIn(await RegisterLoginUser()); client.DefaultRequestHeaders.Authorization = new("Bearer", other.AccessToken);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(BackendAsset(image))).StatusCode);
    }

    [SqlServerFact]
    public async Task Reading_image_validates_urls_and_media_type_and_can_be_removed_without_breaking_publication()
    {
        await AuthoringAdmin(); var course = await NewReadingWritingCourse(["reading"]);
        var path = $"/api/v1/admin/courses/{course.CourseId}/lessons/{course.Lessons[0].LessonId}";
        foreach (var url in new[] { "javascript:alert(1)", "data:image/png;base64,a", "/api/media/../secret.png", "https://user:password@example.com/a.png", "https://example.com/" + new string('a', 500) })
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync(path, IllustratedReading(url))).StatusCode);
        var audio = await CourseAsset("audio");
        foreach (var url in new[] { $"/api/media/{Guid.NewGuid():N}.png", audio.Url })
        {
            Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync(path, IllustratedReading(url))).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync($"/api/v1/admin/courses/{course.CourseId}/publish", null)).StatusCode);
        }
        var image = await CourseAsset("cover");
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync(path, IllustratedReading(image.Url))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync($"/api/v1/admin/courses/{course.CourseId}/publish", null)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync(path, IllustratedReading(audio.Url))).StatusCode);
        var saved = (await client.GetFromJsonAsync<AdminCourseResponse>($"/api/v1/admin/courses/{course.CourseId}"))!;
        Assert.True(saved.IsPublished); Assert.Equal(image.Url, saved.Lessons[0].Reading!.ImageUrl);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync(path, ReadingLesson())).StatusCode);
        saved = (await client.GetFromJsonAsync<AdminCourseResponse>($"/api/v1/admin/courses/{course.CourseId}"))!;
        Assert.True(saved.IsPublished); Assert.Null(saved.Lessons[0].Reading!.ImageUrl);
        Assert.Equal("", saved.Lessons[0].Reading!.ImageCaption);
        var learner = await SignIn(await RegisterLoginUser()); client.DefaultRequestHeaders.Authorization = new("Bearer", learner.AccessToken);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(BackendAsset(image))).StatusCode);
    }
}
