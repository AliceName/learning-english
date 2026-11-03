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
    private async Task<(int UserId, Course Course, Lesson[] Lessons)> PracticeFixture()
    {
        var login = await SignIn(await RegisterLoginUser());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var course = new Course { Title = "Listening test " + Guid.NewGuid().ToString("N"), IsPublished = true };
        db.Courses.Add(course); await db.SaveChangesAsync();
        var content = JsonSerializer.Serialize(new LessonContentDocument(1, null, ListeningLesson().Listening), ListeningGradingService.JsonOptions);
        var lessons = new[]
        {
            new Lesson { CourseId = course.CourseId, Title = "Office meetings", SkillType = "listening", Content = content, AudioUrl = "https://example.com/meeting.wav", OrderIndex = 1 },
            new Lesson { CourseId = course.CourseId, Title = "Second listening", SkillType = "listening", Content = content, AudioUrl = "https://example.com/second.wav", OrderIndex = 2 },
            new Lesson { CourseId = course.CourseId, Title = "Speaking", SkillType = "speaking", OrderIndex = 3 }
        };
        db.Lessons.AddRange(lessons); await db.SaveChangesAsync();
        return (login.User.UserId, course, lessons);
    }

    private static string PracticeUrl(int courseId, int lessonId) => $"/api/v1/courses/{courseId}/lessons/{lessonId}/listening";
    private static ListeningSubmissionRequest CorrectSubmission(ListeningPracticeResponse data) => new()
    {
        ContentVersion = data.ContentVersion, TimeSpentSeconds = 42,
        Answers = [new() { QuestionId = 0, OptionIndex = 1 }, new() { QuestionId = 1, Text = "  THURSDAY  " }, new()
        {
            QuestionId = 2, Matches = [new() { LeftIndex = 0, RightId = data.Questions[2].MatchingRight.Single(item => item.Text == "cuộc họp").Id },
                new() { LeftIndex = 1, RightId = data.Questions[2].MatchingRight.Single(item => item.Text == "thứ Năm").Id }]
        }]
    };

    [SqlServerFact]
    public async Task Listening_start_submit_retry_history_and_catalog_persist_real_results_without_overwriting_course_progress()
    {
        var data = await PracticeFixture(); var url = PracticeUrl(data.Course.CourseId, data.Lessons[0].LessonId);
        var initialResponse = await client.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, initialResponse.StatusCode);
        Assert.True(initialResponse.Headers.CacheControl?.NoStore);
        var initial = (await initialResponse.Content.ReadFromJsonAsync<ListeningPracticeResponse>())!;
        Assert.Equal(3, initial.Questions.Length); Assert.Null(initial.LatestResult); Assert.Equal(2, initial.Progress.TotalLessons);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
            Assert.False(await db.UserCourses.AnyAsync(item => item.UserId == data.UserId && item.CourseId == data.Course.CourseId));
        }
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync(url + "/submissions", CorrectSubmission(initial))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync(url + "/start", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync(url + "/start", null)).StatusCode);
        var submitted = await client.PostAsJsonAsync(url + "/submissions", CorrectSubmission(initial));
        Assert.Equal(HttpStatusCode.OK, submitted.StatusCode);
        var result = (await submitted.Content.ReadFromJsonAsync<ListeningResultResponse>())!;
        Assert.Equal(100m, result.Result.Score); Assert.Equal(3, result.Result.CorrectAnswers); Assert.True(result.FullReview);
        Assert.Equal(50m, result.Progress.Percent); Assert.All(result.Review, item => Assert.True(item.Correct));
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
            var stored = await db.ExerciseResults.SingleAsync(item => item.ResultId == result.Result.ResultId);
            Assert.Equal(42, stored.TimeSpentSeconds); Assert.True(stored.SubmittedAt > DateTime.MinValue);
            var snapshot = JsonSerializer.Deserialize<ListeningWrongAnswersDocument>(stored.WrongAnswersJson!, ListeningGradingService.JsonOptions)!;
            Assert.Empty(snapshot.Questions);
            var enrollment = Assert.Single(await db.UserCourses.Where(item => item.UserId == data.UserId && item.CourseId == data.Course.CourseId).ToListAsync());
            Assert.Equal("in_progress", enrollment.Status); Assert.Equal(0m, enrollment.ProgressPercent);
        }
        var retry = await client.PostAsJsonAsync(url + "/submissions", new ListeningSubmissionRequest { ContentVersion = initial.ContentVersion });
        var retried = (await retry.Content.ReadFromJsonAsync<ListeningResultResponse>())!;
        Assert.Equal(0m, retried.Result.Score); Assert.Equal(50m, retried.Progress.Percent);
        var history = (await client.GetFromJsonAsync<ListeningResultsResponse>(url + "/results?pageSize=1"))!;
        Assert.Equal(2, history.TotalCount); Assert.Equal(2, history.TotalPages); Assert.Single(history.Items);
        var saved = (await client.GetFromJsonAsync<ListeningResultResponse>(url + "/results/" + retried.Result.ResultId))!;
        Assert.False(saved.FullReview); Assert.Equal(3, saved.Review.Length); Assert.Equal("Thursday", saved.Review[0].CorrectAnswer);
        var refreshed = (await client.GetFromJsonAsync<ListeningPracticeResponse>(url))!;
        Assert.Equal(2, refreshed.AttemptCount); Assert.Equal(0m, refreshed.LatestResult!.Score);
        var catalog = (await client.GetFromJsonAsync<CourseDetailResponse>($"/api/v1/courses/{data.Course.CourseId}"))!;
        Assert.Equal(50m, catalog.ListeningProgress!.Percent);
        Assert.Equal(2, catalog.Lessons[0].ListeningStatus!.AttemptCount); Assert.Null(catalog.Lessons[2].ListeningStatus);
    }

    [SqlServerFact]
    public async Task Listening_position_resumes_only_the_last_started_lesson_and_ignores_delayed_other_lesson_writes()
    {
        var data = await PracticeFixture(); var first = PracticeUrl(data.Course.CourseId, data.Lessons[0].LessonId);
        var second = PracticeUrl(data.Course.CourseId, data.Lessons[1].LessonId);
        await client.PostAsync(first + "/start", null);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync(first + "/position", new { positionSeconds = 12.5m })).StatusCode);
        Assert.Equal(12.5m, (await client.GetFromJsonAsync<ListeningPracticeResponse>(first))!.PositionSeconds);
        await client.PostAsync(second + "/start", null);
        var late = await client.PutAsJsonAsync(first + "/position", new { positionSeconds = 99 });
        Assert.False((await late.Content.ReadFromJsonAsync<ListeningPositionResponse>())!.Saved);
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var progress = await db.LearningProgress.SingleAsync(item => item.UserId == data.UserId && item.CourseId == data.Course.CourseId);
        Assert.Equal(data.Lessons[1].LessonId, progress.LastLessonId); Assert.Equal("listening:0", progress.LastPosition);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync(second + "/position", new { positionSeconds = -1 })).StatusCode);
    }

    [SqlServerFact]
    public async Task Listening_rejects_inaccessible_lessons_other_users_results_and_disabled_accounts()
    {
        var data = await PracticeFixture(); var url = PracticeUrl(data.Course.CourseId, data.Lessons[0].LessonId);
        var initial = (await client.GetFromJsonAsync<ListeningPracticeResponse>(url))!;
        await client.PostAsync(url + "/start", null);
        var saved = (await (await client.PostAsJsonAsync(url + "/submissions", CorrectSubmission(initial))).Content.ReadFromJsonAsync<ListeningResultResponse>())!;
        var other = await SignIn(await RegisterLoginUser());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", other.AccessToken);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(url + "/results/" + saved.Result.ResultId)).StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<ListeningResultsResponse>(url + "/results"))!.Items);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(PracticeUrl(data.Course.CourseId, data.Lessons[2].LessonId))).StatusCode);
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        await db.Courses.Where(item => item.CourseId == data.Course.CourseId).ExecuteUpdateAsync(set => set.SetProperty(item => item.IsPublished, false));
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(url)).StatusCode);
        await db.Courses.Where(item => item.CourseId == data.Course.CourseId).ExecuteUpdateAsync(set => set.SetProperty(item => item.IsPublished, true)
            .SetProperty(item => item.SourceType, "user_upload").SetProperty(item => item.CreatedBy, data.UserId));
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(url)).StatusCode);
        await db.Users.Where(item => item.UserId == other.User.UserId).ExecuteUpdateAsync(set => set.SetProperty(item => item.IsActive, false));
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(url)).StatusCode);
        client.DefaultRequestHeaders.Authorization = null;
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(url)).StatusCode);
    }

    [SqlServerFact]
    public async Task Listening_invalid_submissions_do_not_save_results_and_server_rounds_real_scores()
    {
        var data = await PracticeFixture(); var url = PracticeUrl(data.Course.CourseId, data.Lessons[0].LessonId);
        var initial = (await client.GetFromJsonAsync<ListeningPracticeResponse>(url))!;
        await client.PostAsync(url + "/start", null);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(url + "/submissions", new { contentVersion = initial.ContentVersion, answers = new[] { new { questionId = 0, optionIndex = 99 } } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(url + "/submissions", new { contentVersion = initial.ContentVersion, answers = (object?)null })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync(url + "/submissions", new { contentVersion = new string('0', 64), answers = Array.Empty<object>() })).StatusCode);
        Assert.Equal(0, (await client.GetFromJsonAsync<ListeningResultsResponse>(url + "/results"))!.TotalCount);
        var response = await client.PostAsJsonAsync(url + "/submissions", new ListeningSubmissionRequest { ContentVersion = initial.ContentVersion, Answers = [new() { QuestionId = 0, OptionIndex = 1 }] });
        var result = (await response.Content.ReadFromJsonAsync<ListeningResultResponse>())!;
        Assert.Equal(33.33m, result.Result.Score); Assert.Equal(1, result.Result.CorrectAnswers);
        Assert.Equal(2, (await client.GetFromJsonAsync<ListeningResultResponse>(url + "/results/" + result.Result.ResultId))!.Review.Length);
    }
}
