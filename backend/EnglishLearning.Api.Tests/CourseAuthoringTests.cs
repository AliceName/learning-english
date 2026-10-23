using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Tests;

public sealed partial class RegistrationSqlServerTests
{
    private async Task<LoginResponse> AuthoringAdmin()
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var email = $"authoring-{Guid.NewGuid():N}@example.com";
        await new AdminBootstrapService(db, new PasswordHasher<Entities.User>(), Options.Create(new BootstrapAdminOptions { Email = email, Password = "Learning@2026" })).InitializeAsync();
        var login = await SignIn(email);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);
        return login;
    }
    private async Task<AdminCourseResponse> NewAuthoringCourse()
    {
        var response = await client.PostAsJsonAsync("/api/v1/admin/courses", new CreateCourseRequest
        {
            Title = "Workplace English", Description = "Speaking and listening at work.", CoverImageUrl = "https://example.com/cover.png",
            DifficultyLevel = "B2", EstimatedMinutes = 25, Skills = ["speaking", "listening"]
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<AdminCourseResponse>())!;
    }
    private static SaveLessonRequest SpeakingLesson(string title = "Daily communication") => new()
    {
        Title = title, SkillType = "speaking", DifficultyLevel = "B2", EstimatedMinutes = 25,
        Speaking = new SpeakingContent { Goals = "Practice final sounds.", Sentences = [new SpeakingSentence { Text = "Could you tell me the way?", Ipa = "/kʊd juː/" }] }
    };
    private static SaveLessonRequest ListeningLesson(string? audioUrl = "https://example.com/meeting.mp3") => new()
    {
        Title = "Office meetings", SkillType = "listening", DifficultyLevel = "B2", EstimatedMinutes = 30, AudioUrl = audioUrl,
        Listening = new ListeningContent { Transcript = "[00:00] Sarah: The meeting is on Thursday.", HideTranscriptFirstListen = true, Questions = [
            new ListeningQuestion { Prompt = "When is the meeting?", Options = ["Monday", "Thursday"], CorrectOptionIndex = 1 },
            new ListeningQuestion { Type = "fill_blank", Prompt = "The meeting is on [blank].", Answer = "Thursday", AtSeconds = 0 },
            new ListeningQuestion { Type = "matching", Prompt = "Match the meanings", Pairs = [new MatchingPair {Left="meeting",Right="cuộc họp"}, new MatchingPair {Left="Thursday",Right="thứ Năm"}] }
        ] }
    };

    [SqlServerFact]
    public async Task Authoring_requires_admin_and_checks_current_database_role_and_active_status()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/admin/courses")).StatusCode);
        var regular = await SignIn(await RegisterLoginUser());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", regular.AccessToken);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/v1/admin/courses")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/v1/admin/courses", new {title="Bypass"})).StatusCode);
        var admin = await AuthoringAdmin();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        await db.Users.Where(user => user.UserId == admin.User.UserId).ExecuteUpdateAsync(update => update.SetProperty(user => user.Role, UserRoles.User));
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/v1/admin/courses")).StatusCode);
        await db.Users.Where(user => user.UserId == admin.User.UserId).ExecuteUpdateAsync(update => update.SetProperty(user => user.IsActive, false));
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/admin/courses")).StatusCode);
    }

    [SqlServerFact]
    public async Task Create_edit_speaking_listening_preview_and_publish_round_trip_without_schema_changes()
    {
        var admin = await AuthoringAdmin(); var course = await NewAuthoringCourse();
        Assert.False(course.IsPublished); Assert.Equal(2, course.Lessons.Count);
        Assert.All(course.Lessons, lesson => { Assert.Equal("B2", lesson.DifficultyLevel); Assert.Equal(25, lesson.EstimatedMinutes); });
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/v1/courses/{course.CourseId}")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync($"/api/v1/admin/courses/{course.CourseId}/publish", null)).StatusCode);
        var speaking = course.Lessons.Single(lesson => lesson.SkillType == "speaking");
        var listening = course.Lessons.Single(lesson => lesson.SkillType == "listening");
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}/lessons/{speaking.LessonId}", SpeakingLesson())).StatusCode);
        var listened = await client.PutAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}/lessons/{listening.LessonId}", ListeningLesson());
        Assert.Equal(HttpStatusCode.OK, listened.StatusCode);
        var reloaded = (await client.GetFromJsonAsync<AdminCourseResponse>($"/api/v1/admin/courses/{course.CourseId}"))!;
        Assert.Equal(3, reloaded.Lessons.Single(lesson => lesson.SkillType == "listening").Listening!.Questions.Length);
        Assert.Equal("/kʊd juː/", reloaded.Lessons.Single(lesson => lesson.SkillType == "speaking").Speaking!.Sentences[0].Ipa);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}", new SaveCourseRequest { Title = "Edited workplace course", Description=course.Description, CoverImageUrl=course.CoverImageUrl })).StatusCode);
        var published = await client.PostAsync($"/api/v1/admin/courses/{course.CourseId}/publish", null);
        Assert.Equal(HttpStatusCode.OK, published.StatusCode);
        Assert.True((await published.Content.ReadFromJsonAsync<AdminCourseResponse>())!.IsPublished);
        var publicCourse = (await client.GetFromJsonAsync<CourseDetailResponse>($"/api/v1/courses/{course.CourseId}"))!;
        Assert.Equal(2, publicCourse.Course.LessonCount); Assert.Equal(55, publicCourse.Course.EstimatedMinutes);
        Assert.Equal("Edited workplace course", publicCourse.Course.Title);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PutAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}/lessons/{speaking.LessonId}", SpeakingLesson())).StatusCode);
        using var scope = factory.Services.CreateScope();
        var row = await scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>().Courses.SingleAsync(item => item.CourseId == course.CourseId);
        Assert.Equal(admin.User.UserId, row.CreatedBy); Assert.Equal("system", row.SourceType);
    }

    [SqlServerFact]
    public async Task Invalid_payloads_cross_course_writes_and_incomplete_publishing_are_rejected()
    {
        await AuthoringAdmin(); var course = await NewAuthoringCourse(); var other = await NewAuthoringCourse();
        Assert.Equal(HttpStatusCode.NotFound, (await client.PutAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}/lessons/{other.Lessons[0].LessonId}", SpeakingLesson())).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/admin/courses", new {title="No", skills=new[]{"unknown"}})).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/admin/courses", new {title="No",coverImageUrl="javascript:alert(1)"})).StatusCode);
        var listening = course.Lessons.Single(item => item.SkillType == "listening");
        var invalid = new SaveLessonRequest {Title="Bad question",SkillType="listening",Listening=new ListeningContent{Questions=[new ListeningQuestion{Prompt="Choose",Options=["A","B"],CorrectOptionIndex=99}]}};
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}/lessons/{listening.LessonId}", invalid)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync($"/api/v1/admin/courses/{course.CourseId}/publish", null)).StatusCode);
        Assert.False((await client.GetFromJsonAsync<AdminCourseResponse>($"/api/v1/admin/courses/{course.CourseId}"))!.IsPublished);
    }

    [SqlServerFact]
    public async Task Media_upload_checks_signatures_and_permissions_and_supports_audio_ranges()
    {
        await AuthoringAdmin();
        async Task<HttpResponseMessage> Upload(byte[] bytes, string name, string kind)
        {
            using var form = new MultipartFormDataContent(); form.Add(new ByteArrayContent(bytes), "file", name); form.Add(new StringContent(kind), "kind");
            return await client.PostAsync("/api/v1/admin/uploads", form);
        }
        Assert.Equal(HttpStatusCode.BadRequest, (await Upload(Encoding.UTF8.GetBytes("<script>alert(1)</script>"), "fake.png", "cover")).StatusCode);
        var wav = new byte[64]; Encoding.ASCII.GetBytes("RIFF").CopyTo(wav,0); Encoding.ASCII.GetBytes("WAVE").CopyTo(wav,8);
        var uploaded = await Upload(wav,"meeting.wav","audio"); Assert.Equal(HttpStatusCode.OK, uploaded.StatusCode);
        var media = (await uploaded.Content.ReadFromJsonAsync<UploadedMediaResponse>())!;
        var backendPath = "/api/v1/media/" + media.Url.Split('/').Last();
        using var rangeRequest = new HttpRequestMessage(HttpMethod.Get,backendPath); rangeRequest.Headers.Range = new RangeHeaderValue(0,11);
        var range = await client.SendAsync(rangeRequest); Assert.Equal(HttpStatusCode.PartialContent,range.StatusCode); Assert.Equal(12,(await range.Content.ReadAsByteArrayAsync()).Length);
        var regular = await SignIn(await RegisterLoginUser()); client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer",regular.AccessToken);
        Assert.Equal(HttpStatusCode.NotFound,(await client.GetAsync(backendPath)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,(await Upload(wav,"meeting.wav","audio")).StatusCode);
    }
}
