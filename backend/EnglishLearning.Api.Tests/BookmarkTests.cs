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

public sealed class BookmarkTests
{
    private const string Route = "/api/v1/bookmarks";

    [Fact]
    public async Task Bookmarks_can_be_saved_reopened_and_removed_by_their_owner()
    {
        await using var factory = CreateFactory();
        using var ownerClient = factory.CreateClient();
        using var otherClient = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await ownerClient.GetAsync(Route)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await ownerClient.PutAsync(Route + "/course/1", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await ownerClient.DeleteAsync(Route + "/course/1")).StatusCode);

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var owner = User("owner");
        var other = User("other");
        var admin = User("admin", "admin");
        db.Users.AddRange(owner, other, admin);
        await db.SaveChangesAsync();

        var course = new Course { Title = "Public course" };
        var privateCourse = new Course { Title = "Private course", CreatedBy = other.UserId, SourceType = "user_upload" };
        var writing = new WritingSubmission { UserId = owner.UserId, Topic = "My trip", OriginalText = "A short essay." };
        var privateWriting = new WritingSubmission { UserId = other.UserId, Topic = "Other topic", OriginalText = "Private." };
        var sharedDeck = new FlashcardDeck { UserId = admin.UserId, Title = "Shared deck" };
        var privateDeck = new FlashcardDeck { UserId = other.UserId, Title = "Private deck" };
        db.AddRange(course, privateCourse, writing, privateWriting, sharedDeck, privateDeck);
        await db.SaveChangesAsync();

        var lesson = new Lesson { CourseId = course.CourseId, Title = "Practice", SkillType = "speaking" };
        var inactiveLesson = new Lesson { CourseId = course.CourseId, Title = "Archived", IsActive = false };
        var privateLesson = new Lesson { CourseId = privateCourse.CourseId, Title = "Private lesson" };
        var card = new Flashcard { DeckId = sharedDeck.DeckId, FrontText = "apple", BackText = "quả táo" };
        var privateCard = new Flashcard { DeckId = privateDeck.DeckId, FrontText = "private", BackText = "riêng tư" };
        db.AddRange(lesson, inactiveLesson, privateLesson, card, privateCard);
        await db.SaveChangesAsync();

        var jwt = factory.Services.GetRequiredService<JwtTokenService>();
        ownerClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", jwt.CreateToken(owner).AccessToken);
        otherClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", jwt.CreateToken(other).AccessToken);

        var courseUrl = $"{Route}/course/{course.CourseId}";
        var lessonUrl = $"{Route}/lesson/{lesson.LessonId}";
        var writingUrl = $"{Route}/writing/{writing.SubmissionId}";
        var cardUrl = $"{Route}/flashcard/{card.CardId}";
        foreach (var url in new[] { courseUrl, courseUrl, lessonUrl, writingUrl, cardUrl })
        {
            using var response = await ownerClient.PutAsync(url, null);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
        foreach (var url in new[]
        {
            $"{Route}/course/{privateCourse.CourseId}", $"{Route}/lesson/{privateLesson.LessonId}",
            $"{Route}/lesson/{inactiveLesson.LessonId}", $"{Route}/writing/{privateWriting.SubmissionId}",
            $"{Route}/flashcard/{privateCard.CardId}", $"{Route}/vocabulary/1", $"{Route}/invalid/1", $"{Route}/course/0",
        })
        {
            using var response = await ownerClient.PutAsync(url, null);
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        }
        using var list = await ownerClient.GetAsync(Route);
        Assert.True(list.Headers.CacheControl?.NoStore);
        var saved = (await list.Content.ReadFromJsonAsync<BookmarkResponse[]>())!;
        Assert.Equal(new[] { "flashcard", "writing", "lesson", "course" }, saved.Select(item => item.TargetType));
        Assert.Equal("Shared deck", saved[0].Target?.ParentTitle);
        Assert.Equal(sharedDeck.DeckId, saved[0].Target?.ParentId);
        Assert.Equal("My trip", saved[1].Target?.Title);
        Assert.Equal("speaking", saved[2].Target?.SkillType);
        Assert.Equal(course.CourseId, saved[2].Target?.ParentId);

        // A target ID alone cannot reach another user's bookmark.
        Assert.Empty((await otherClient.GetFromJsonAsync<BookmarkResponse[]>(Route))!);
        Assert.Equal(HttpStatusCode.NoContent, (await otherClient.DeleteAsync(courseUrl)).StatusCode);
        Assert.Equal(4, (await ownerClient.GetFromJsonAsync<BookmarkResponse[]>(Route))!.Length);

        course.IsPublished = false;
        admin.IsActive = false;
        await db.SaveChangesAsync();
        var stale = (await ownerClient.GetFromJsonAsync<BookmarkResponse[]>(Route))!;
        Assert.All(stale.Where(item => item.TargetType != "writing"), item => Assert.Null(item.Target));
        foreach (var url in new[] { courseUrl, lessonUrl, cardUrl, writingUrl, writingUrl })
            Assert.Equal(HttpStatusCode.NoContent, (await ownerClient.DeleteAsync(url)).StatusCode);
        Assert.Empty((await ownerClient.GetFromJsonAsync<BookmarkResponse[]>(Route))!);
        Assert.True(await db.WritingSubmissions.AnyAsync(item => item.SubmissionId == writing.SubmissionId));
        Assert.True(await db.Flashcards.AnyAsync(item => item.CardId == card.CardId));
    }

    [Fact]
    public async Task Notes_are_validated_and_restored_with_the_owners_bookmark()
    {
        await using var factory = CreateFactory();
        using var ownerClient = factory.CreateClient();
        using var otherClient = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var owner = User("owner");
        var other = User("other");
        var course = new Course { Title = "Public course" };
        db.AddRange(owner, other, course);
        await db.SaveChangesAsync();
        var url = $"{Route}/course/{course.CourseId}";
        var jwt = factory.Services.GetRequiredService<JwtTokenService>();

        Assert.Equal(HttpStatusCode.Unauthorized, (await ownerClient.PatchAsJsonAsync(url, new { note = "anonymous" })).StatusCode);
        ownerClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", jwt.CreateToken(owner).AccessToken);
        otherClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", jwt.CreateToken(other).AccessToken);
        var saved = (await (await ownerClient.PutAsync(url, null)).Content.ReadFromJsonAsync<BookmarkResponse>())!;
        Assert.Null(saved.Note);

        const string note = "Luyện lại âm cuối trong worked.";
        Assert.Equal(HttpStatusCode.NoContent, (await ownerClient.PatchAsJsonAsync(url, new { note = $"  {note}  " })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherClient.PatchAsJsonAsync(url, new { note = "other user" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await ownerClient.PatchAsJsonAsync(url, new { note = new string('a', 501) })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await ownerClient.PatchAsJsonAsync(url, new { })).StatusCode);
        var updated = Assert.Single((await ownerClient.GetFromJsonAsync<BookmarkResponse[]>(Route))!);
        Assert.Equal(note, updated.Note);
        Assert.Equal(saved.CreatedAt, updated.CreatedAt);
        Assert.Empty((await otherClient.GetFromJsonAsync<BookmarkResponse[]>(Route))!);

        Assert.Equal(HttpStatusCode.NoContent, (await ownerClient.DeleteAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await ownerClient.PatchAsJsonAsync(url, new { note = "missing" })).StatusCode);
        var restored = (await (await ownerClient.PutAsJsonAsync(url, new { note })).Content.ReadFromJsonAsync<BookmarkResponse>())!;
        Assert.Equal(note, restored.Note);
        var existing = (await (await ownerClient.PutAsync(url, null)).Content.ReadFromJsonAsync<BookmarkResponse>())!;
        Assert.Equal(note, existing.Note);
        Assert.Equal(HttpStatusCode.NoContent, (await ownerClient.PatchAsJsonAsync(url, new { note = (string?)null })).StatusCode);
        Assert.Null(Assert.Single((await ownerClient.GetFromJsonAsync<BookmarkResponse[]>(Route))!).Note);
    }

    private static User User(string name, string role = "user") =>
        new() { Email = $"{name}@bookmark.test", FullName = name, PasswordHash = "test", Role = role };

    private static WebApplicationFactory<Program> CreateFactory()
    {
        var database = Guid.NewGuid().ToString();
        return new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Development")
            .ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:SigningKey"] = TestJwt.SigningKey,
                ["ConnectionStrings:DefaultConnection"] = "test-only",
            }))
            .ConfigureServices(services =>
            {
                services.RemoveAll<EnglishLearningDbContext>();
                var options = new DbContextOptionsBuilder<EnglishLearningDbContext>().UseInMemoryDatabase(database).Options;
                services.AddScoped(_ => new EnglishLearningDbContext(options));
            }));
    }
}
