using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace EnglishLearning.Api.Tests;

public sealed partial class RegistrationSqlServerTests
{
    private async Task<(int UserId, Course Course, Lesson Lesson)> GrammarPracticeFixture()
    {
        await EnableGrammarInTestTransaction();
        var login = await SignIn(await RegisterLoginUser());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var course = new Course { Title = "Grammar test " + Guid.NewGuid().ToString("N"), IsPublished = true };
        db.Courses.Add(course); await db.SaveChangesAsync();
        var lesson = new Lesson { CourseId = course.CourseId, Title = "Grammar practice", SkillType = "grammar",
            Content = JsonSerializer.Serialize(new LessonContentDocument(1, null, null, GrammarLesson().Grammar), GrammarGradingService.JsonOptions) };
        db.Lessons.Add(lesson); await db.SaveChangesAsync();
        return (login.User.UserId, course, lesson);
    }
    private static string GrammarPracticeUrl(int courseId, int lessonId) => $"/api/v1/courses/{courseId}/lessons/{lessonId}/grammar";

    [SqlServerFact]
    public async Task Grammar_practice_uses_authored_notes_grades_all_types_and_persists_results()
    {
        var fixture = await GrammarPracticeFixture(); var url = GrammarPracticeUrl(fixture.Course.CourseId, fixture.Lesson.LessonId);
        var response = await client.GetAsync(url);
        Assert.True(response.Headers.CacheControl?.NoStore);
        var lesson = (await response.Content.ReadFromJsonAsync<GrammarPracticeResponse>())!;
        Assert.Equal("Third Conditional", lesson.Topic); Assert.Contains("If + S", lesson.Rules); Assert.Null(lesson.LatestResult);
        var resultResponse = await client.PostAsJsonAsync(url + "/submissions", new GrammarSubmissionRequest
        {
            ContentVersion = lesson.ContentVersion, TimeSpentSeconds = 75, Answers = [
                new() { QuestionId = 0, OptionIndex = 0 }, new() { QuestionId = 1, Text = "  'D KNOWN  " }, new() { QuestionId = 2, OptionIndex = 0 }
            ]
        });
        Assert.Equal(HttpStatusCode.OK, resultResponse.StatusCode);
        var result = (await resultResponse.Content.ReadFromJsonAsync<GrammarResultResponse>())!;
        Assert.Equal(100m, result.Result.Score); Assert.Equal(75, result.Result.TimeSpentSeconds);
        Assert.All(result.Review, item => Assert.True(item.Correct)); Assert.Equal("did he forget", result.Review[2].Correction);
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        Assert.Equal(1, await db.UserCourses.CountAsync(item => item.UserId == fixture.UserId && item.CourseId == fixture.Course.CourseId));
        Assert.Equal(3, (await db.ExerciseResults.SingleAsync(item => item.ResultId == result.Result.ResultId)).CorrectAnswers);
        var retry = await client.PostAsJsonAsync(url + "/submissions", new GrammarSubmissionRequest { ContentVersion = lesson.ContentVersion });
        Assert.Equal(0m, (await retry.Content.ReadFromJsonAsync<GrammarResultResponse>())!.Result.Score);
        var refreshed = (await client.GetFromJsonAsync<GrammarPracticeResponse>(url))!;
        Assert.Equal(0m, refreshed.LatestResult!.Score);
    }

    [SqlServerFact]
    public async Task Grammar_practice_rejects_inaccessible_lessons_and_does_not_share_personal_results()
    {
        var fixture = await GrammarPracticeFixture(); var url = GrammarPracticeUrl(fixture.Course.CourseId, fixture.Lesson.LessonId);
        var lesson = (await client.GetFromJsonAsync<GrammarPracticeResponse>(url))!;
        await client.PostAsJsonAsync(url + "/submissions", new GrammarSubmissionRequest { ContentVersion = lesson.ContentVersion });
        var other = await SignIn(await RegisterLoginUser());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", other.AccessToken);
        Assert.Null((await client.GetFromJsonAsync<GrammarPracticeResponse>(url))!.LatestResult);
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        await db.Courses.Where(item => item.CourseId == fixture.Course.CourseId).ExecuteUpdateAsync(set => set
            .SetProperty(item => item.SourceType, "user_upload").SetProperty(item => item.CreatedBy, fixture.UserId));
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(url)).StatusCode);
        await db.Courses.Where(item => item.CourseId == fixture.Course.CourseId).ExecuteUpdateAsync(set => set
            .SetProperty(item => item.SourceType, "system").SetProperty(item => item.IsPublished, false));
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(url)).StatusCode);
        client.DefaultRequestHeaders.Authorization = null;
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(url)).StatusCode);
    }

    [SqlServerFact]
    public async Task Grammar_invalid_or_stale_submissions_do_not_create_results_or_enrollments()
    {
        var fixture = await GrammarPracticeFixture(); var url = GrammarPracticeUrl(fixture.Course.CourseId, fixture.Lesson.LessonId);
        var lesson = (await client.GetFromJsonAsync<GrammarPracticeResponse>(url))!;
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync(url + "/submissions",
            new GrammarSubmissionRequest { ContentVersion = new string('0', 64) })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(url + "/submissions", new {
            contentVersion = lesson.ContentVersion, answers = new[] { new { questionId = 0, optionIndex = 99 } }
        })).StatusCode);
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        Assert.False(await db.ExerciseResults.AnyAsync(item => item.LessonId == fixture.Lesson.LessonId));
        Assert.False(await db.UserCourses.AnyAsync(item => item.UserId == fixture.UserId && item.CourseId == fixture.Course.CourseId));
    }
}
