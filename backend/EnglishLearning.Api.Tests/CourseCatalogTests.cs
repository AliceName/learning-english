using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace EnglishLearning.Api.Tests;

public sealed partial class RegistrationSqlServerTests
{
    private async Task<(string Prefix, int UserId, Course[] Courses)> CreateCatalog()
    {
        var login = await SignIn(await RegisterLoginUser());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);
        using var scope = factory.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var other = new User { Email = $"other-{Guid.NewGuid():N}@example.com", FullName = "Other learner", PasswordHash = "test-only" };
        context.Users.Add(other);
        await context.SaveChangesAsync();
        var prefix = $"catalog-{Guid.NewGuid():N}";
        var courses = new[]
        {
            new Course { Title = prefix + " Alpha", Description = "Speaking for work", SourceType = "system" },
            new Course { Title = prefix + " Beta", SourceType = "system" },
            new Course { Title = prefix + " Personal", SourceType = "user_upload", CreatedBy = login.User.UserId },
            new Course { Title = prefix + " Other private", SourceType = "user_upload", CreatedBy = other.UserId },
            new Course { Title = prefix + " Draft", IsPublished = false }
        };
        context.Courses.AddRange(courses);
        await context.SaveChangesAsync();
        context.Lessons.AddRange(
            new Lesson { CourseId = courses[0].CourseId, Title = "Second", SkillType = "speaking", DifficultyLevel = "B1", EstimatedMinutes = 25, OrderIndex = 2 },
            new Lesson { CourseId = courses[0].CourseId, Title = "First", SkillType = "reading", DifficultyLevel = "A2", OrderIndex = 1 },
            new Lesson { CourseId = courses[0].CourseId, Title = "Hidden", SkillType = "writing", DifficultyLevel = "C2", EstimatedMinutes = 999, IsActive = false },
            new Lesson { CourseId = courses[1].CourseId, Title = "Read", SkillType = "reading", DifficultyLevel = "B1", EstimatedMinutes = 10 });
        context.UserCourses.AddRange(
            new UserCourse { UserId = login.User.UserId, CourseId = courses[0].CourseId, ProgressPercent = 45 },
            new UserCourse { UserId = login.User.UserId, CourseId = courses[1].CourseId, Status = "completed", ProgressPercent = 100 },
            new UserCourse { UserId = other.UserId, CourseId = courses[0].CourseId, ProgressPercent = 70 });
        await context.SaveChangesAsync();
        return (prefix, login.User.UserId, courses);
    }

    [SqlServerFact]
    public async Task Catalog_returns_only_visible_courses_and_aggregates_active_lessons_and_own_progress()
    {
        var data = await CreateCatalog();
        var response = await client.GetAsync($"/api/v1/courses?search={data.Prefix}&sort=title");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore);
        var result = (await response.Content.ReadFromJsonAsync<CourseListResponse>())!;
        Assert.Equal(3, result.TotalCount);
        Assert.Equal(new[] { data.Courses[0].CourseId, data.Courses[1].CourseId, data.Courses[2].CourseId }, result.Items.Select(item => item.CourseId));
        var first = result.Items[0];
        Assert.Equal(2, first.LessonCount);
        Assert.Equal(25, first.EstimatedMinutes);
        Assert.Equal(1, first.TimedLessonCount);
        Assert.Equal(new[] { "A2", "B1" }, first.Levels);
        Assert.Equal(new[] { "reading", "speaking" }, first.Skills);
        Assert.Equal(2, first.EnrollmentCount);
        Assert.Equal(45, first.Enrollment!.ProgressPercent);
        Assert.Null(result.Items[2].Enrollment);
        var detail = (await client.GetFromJsonAsync<CourseDetailResponse>($"/api/v1/courses/{first.CourseId}"))!;
        Assert.Equal(new[] { "First", "Second" }, detail.Lessons.Select(item => item.Title));
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/v1/courses/{data.Courses[3].CourseId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/v1/courses/{data.Courses[4].CourseId}")).StatusCode);
    }

    [SqlServerFact]
    public async Task Catalog_filters_search_level_skill_source_status_and_pages_in_a_stable_order()
    {
        var data = await CreateCatalog();
        async Task<CourseListResponse> List(string extra) => (await client.GetFromJsonAsync<CourseListResponse>($"/api/v1/courses?search={data.Prefix}&{extra}"))!;
        Assert.Equal(data.Courses[0].CourseId, Assert.Single((await List("level=B1&skill=speaking")).Items).CourseId);
        Assert.Equal(data.Courses[1].CourseId, Assert.Single((await List("level=B1&skill=reading")).Items).CourseId);
        Assert.Empty((await List("level=C2")).Items);
        Assert.Equal(data.Courses[0].CourseId, Assert.Single((await List("status=in_progress")).Items).CourseId);
        Assert.Equal(data.Courses[1].CourseId, Assert.Single((await List("status=completed")).Items).CourseId);
        Assert.Equal(data.Courses[2].CourseId, Assert.Single((await List("status=not_started&source=user_upload")).Items).CourseId);
        var page = await List("sort=title&pageSize=1&page=2");
        Assert.Equal(3, page.TotalCount);
        Assert.Equal(3, page.TotalPages);
        Assert.Equal(data.Courses[1].CourseId, Assert.Single(page.Items).CourseId);
        Assert.Empty((await List("page=9999")).Items);
        Assert.Equal(data.Courses[0].CourseId, (await List("sort=popular")).Items[0].CourseId);
        Assert.Empty((await client.GetFromJsonAsync<CourseListResponse>($"/api/v1/courses?search={data.Prefix}%25"))!.Items);
    }

    [SqlServerFact]
    public async Task Catalog_requires_active_authentication_and_rejects_invalid_filters()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/courses")).StatusCode);
        var data = await CreateCatalog();
        foreach (var query in new[] { "page=0", "pageSize=25", "pageSize=-1", "sort=rating", "level=B3", "skill=unknown", "status=invalid", "source=other", "search=" + new string('a', 201) })
            Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/v1/courses?" + query)).StatusCode);
        using var scope = factory.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        await context.Users.Where(item => item.UserId == data.UserId).ExecuteUpdateAsync(update => update.SetProperty(item => item.IsActive, false));
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/courses")).StatusCode);
    }
}
