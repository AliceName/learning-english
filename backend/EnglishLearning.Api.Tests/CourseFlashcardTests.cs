using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services;
using EnglishLearning.Api.Services.AiCourses;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace EnglishLearning.Api.Tests;

public sealed class CourseFlashcardTests
{
    private static WebApplicationFactory<Program> Factory()
    {
        var database = Guid.NewGuid().ToString();
        return new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Development")
            .ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?> {
                ["Jwt:SigningKey"] = TestJwt.SigningKey, ["ConnectionStrings:DefaultConnection"] = "test-only" }))
            .ConfigureServices(services => { services.RemoveAll<EnglishLearningDbContext>(); services.AddScoped(_ =>
                new EnglishLearningDbContext(new DbContextOptionsBuilder<EnglishLearningDbContext>().UseInMemoryDatabase(database).Options)); }));
    }
    private static readonly User Admin = new() { UserId = 1, Email = "admin@example.test", FullName = "Admin", Role = "admin", PasswordHash = "test-only" };
    private static readonly User Learner = new() { UserId = 2, Email = "learner@example.test", FullName = "Learner", PasswordHash = "test-only" };
    private static readonly User Other = new() { UserId = 3, Email = "other@example.test", FullName = "Other", PasswordHash = "test-only" };
    private static void SignIn(HttpClient client, WebApplicationFactory<Program> factory, User user) =>
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", factory.Services.GetRequiredService<JwtTokenService>().CreateToken(user).AccessToken);

    [Fact]
    public async Task Course_decks_follow_visibility_and_personal_copies_keep_independent_review_schedules()
    {
        await using var factory = Factory(); using var client = factory.CreateClient();
        using (var scope = factory.Services.CreateScope()) {
            var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
            db.Users.AddRange(Admin, Learner, Other);
            db.Courses.AddRange(new Course { CourseId = 10, Title = "Draft course", IsPublished = false },
                new Course { CourseId = 11, Title = "Private course", SourceType = "user_upload", CreatedBy = Learner.UserId });
            await db.SaveChangesAsync();
        }
        SignIn(client, factory, Admin);
        var created = await client.PostAsJsonAsync("/api/v1/flashcards/decks", new { title = "Admin vocabulary", courseId = 10 });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var source = (await created.Content.ReadFromJsonAsync<DeckSummary>())!; Assert.Equal(10, source.CourseId);
        var sourceUrl = $"/api/v1/flashcards/decks/{source.DeckId}";
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync(sourceUrl + "/cards", new { frontText = "commute", backText = "đi lại hằng ngày" })).StatusCode);
        Assert.Single((await client.GetFromJsonAsync<DeckSummary[]>("/api/v1/flashcards/decks?courseId=10"))!);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/api/v1/flashcards/decks", new { title = "Not an admin course", courseId = 11 })).StatusCode);
        SignIn(client, factory, Learner);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(sourceUrl)).StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<DeckSummary[]>("/api/v1/flashcards/decks"))!);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/v1/flashcards/decks?courseId=10")).StatusCode);
        using (var scope = factory.Services.CreateScope()) {
            var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>(); (await db.Courses.SingleAsync(c => c.CourseId == 10)).IsPublished = true; await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/api/v1/flashcards/decks", new { title = "Injected", courseId = 10 })).StatusCode);
        var visible = (await client.GetFromJsonAsync<DeckSummary[]>("/api/v1/flashcards/decks?courseId=10"))!;
        Assert.Single(visible); Assert.False(visible[0].CanEdit); Assert.Equal("Draft course", visible[0].CourseTitle);
        var sourceCard = (await client.GetFromJsonAsync<DeckDetail>(sourceUrl))!.Cards.Single();
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync($"/api/v1/flashcards/cards/{sourceCard.CardId}/review", new { rating = 2, expectedUpdatedAt = sourceCard.UpdatedAt })).StatusCode);
        var copied = (await (await client.PostAsJsonAsync(sourceUrl + "/copy", new { })).Content.ReadFromJsonAsync<DeckSummary>())!;
        Assert.True(copied.CanEdit); Assert.False(copied.IsAdminDeck); Assert.Equal(10, copied.CourseId);
        var copyUrl = $"/api/v1/flashcards/decks/{copied.DeckId}";
        var card = (await client.GetFromJsonAsync<DeckDetail>(copyUrl))!.Cards.Single();
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync($"/api/v1/flashcards/cards/{card.CardId}/review", new { rating = 2, expectedUpdatedAt = card.UpdatedAt })).StatusCode);
        Assert.Equal(0, (await client.GetFromJsonAsync<DeckDetail>(sourceUrl))!.Cards.Single().Repetition);
        Assert.Equal(1, (await client.GetFromJsonAsync<DeckDetail>(copyUrl))!.Cards.Single().Repetition);
        SignIn(client, factory, Other);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(copyUrl)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/v1/flashcards/decks?courseId=11")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/v1/flashcards/decks?courseId=0")).StatusCode);
        using (var scope = factory.Services.CreateScope()) {
            var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>(); (await db.Courses.SingleAsync(c => c.CourseId == 10)).IsPublished = false; await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(sourceUrl)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(sourceUrl + "/copy", new { })).StatusCode);
        SignIn(client, factory, Learner);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(copyUrl)).StatusCode); // Personal copies remain usable in the library.
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/v1/flashcards/decks?courseId=10")).StatusCode);
    }

    [Fact]
    public async Task Reading_vocabulary_is_read_only_filtered_and_versioned_before_explicit_copy()
    {
        await using var factory = Factory(); using var client = factory.CreateClient();
        using (var scope = factory.Services.CreateScope()) {
            var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>(); db.Users.AddRange(Admin, Learner, Other);
            db.Courses.AddRange(new Course { CourseId = 10, Title = "Published" }, new Course { CourseId = 11, Title = "Private", SourceType = "user_upload", CreatedBy = 3 });
            db.Lessons.AddRange(Reading(7, 10), Reading(8, 10, false), Reading(9, 11)); await db.SaveChangesAsync();
        }
        const string url = "/api/v1/courses/10/vocabulary";
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(url)).StatusCode);
        SignIn(client, factory, Learner);
        var response = await client.GetAsync(url);
        Assert.True(response.Headers.CacheControl!.Private);
        Assert.True(response.Headers.CacheControl.NoStore);
        var vocabulary = (await response.Content.ReadFromJsonAsync<CourseVocabularyResponse>())!;
        var deck = Assert.Single(vocabulary.ReadingDecks); Assert.Equal(7, deck.LessonId); Assert.Single(deck.Cards);
        Assert.Equal("commute", deck.Cards[0].FrontText); Assert.Equal("I commute by bus.", deck.Cards[0].ExampleSentence);
        var json = await response.Content.ReadAsStringAsync(); Assert.DoesNotContain("correctOptionIndex", json); Assert.DoesNotContain("translation", json);
        using (var scope = factory.Services.CreateScope()) Assert.Empty(await scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>().FlashcardDecks.ToArrayAsync());
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/v1/courses/11/vocabulary")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(url + "/8/copy", new { deck.ContentVersion })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync(url + "/7/copy", new { contentVersion = new string('0', 64) })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(url + "/7/copy", new { })).StatusCode);
        var savedResponse = await client.PostAsJsonAsync(url + "/7/copy", new { deck.ContentVersion });
        Assert.Equal(HttpStatusCode.Created, savedResponse.StatusCode);
        var saved = (await savedResponse.Content.ReadFromJsonAsync<DeckSummary>())!; Assert.Equal(10, saved.CourseId); Assert.False(saved.IsAdminDeck);
        Assert.Single((await client.GetFromJsonAsync<DeckDetail>($"/api/v1/flashcards/decks/{saved.DeckId}"))!.Cards);
        SignIn(client, factory, Admin);
        var adminCopy = (await (await client.PostAsJsonAsync(url + "/7/copy", new { deck.ContentVersion })).Content.ReadFromJsonAsync<DeckSummary>())!;
        Assert.True(adminCopy.IsAdminDeck);
        SignIn(client, factory, Other);
        var others = (await client.GetFromJsonAsync<DeckSummary[]>("/api/v1/flashcards/decks?courseId=10"))!;
        Assert.Equal(adminCopy.DeckId, Assert.Single(others).DeckId);
    }

    [Theory]
    [InlineData("not-json")]
    [InlineData("null")]
    [InlineData("{\"version\":2,\"reading\":{\"vocabulary\":[]}}")]
    public void Unsupported_reading_documents_do_not_break_the_course_library(string content)
    {
        var lesson = Reading(7, 10); lesson.Content = content; Assert.Null(CourseVocabularyContent.ReadingDeck(lesson));
    }
    private static Lesson Reading(int id, int course, bool active = true) => new() {
        LessonId = id, CourseId = course, Title = "Daily journeys", SkillType = "reading", IsActive = active,
        Content = JsonSerializer.Serialize(new LessonContentDocument(1, null, null, Reading: new ReadingContent {
            Vocabulary = [new() { Word = " commute ", Meaning = " đi lại ", Example = "I commute by bus." }, new() { Word = "COMMUTE", Meaning = "đi lại" }]
        }), AiCourseStore.Json)
    };
}
