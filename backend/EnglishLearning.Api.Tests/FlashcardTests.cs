using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace EnglishLearning.Api.Tests;

public sealed class FlashcardTests
{
    [Fact]
    public void Recall_schedule_advances_resets_and_keeps_ease_bounded()
    {
        var now = DateTime.UtcNow; var card = new Flashcard();
        FlashcardScheduler.Review(card, 2, now);
        Assert.Equal(1, card.IntervalDays); Assert.Equal(1, card.Repetition); Assert.Equal(now.AddDays(1), card.NextReviewAt);
        FlashcardScheduler.Review(card, 2, now.AddDays(1)); Assert.Equal(6, card.IntervalDays);
        FlashcardScheduler.Review(card, 2, now.AddDays(7)); Assert.Equal(15, card.IntervalDays);
        FlashcardScheduler.Review(card, 0, now.AddDays(22));
        Assert.Equal(0, card.Repetition); Assert.Equal(0, card.IntervalDays); Assert.Equal(now.AddDays(22).AddMinutes(5), card.NextReviewAt);
        for (var i = 0; i < 40; i++) FlashcardScheduler.Review(card, 0, now);
        Assert.Equal(1.30m, card.EaseFactor);
        for (var i = 0; i < 200; i++) FlashcardScheduler.Review(card, 3, now);
        Assert.InRange(card.EaseFactor, 1.30m, 9.99m); Assert.InRange(card.IntervalDays, 1, 3650);
        Assert.Throws<ArgumentOutOfRangeException>(() => FlashcardScheduler.Review(card, 4, now));
    }

    [Fact]
    public async Task Deck_card_review_flow_is_private_validated_persistent_and_rejects_duplicate_reviews()
    {
        var database = Guid.NewGuid().ToString(); var clock = new StudyClock();
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Development")
            .ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?> {
                ["Jwt:SigningKey"] = TestJwt.SigningKey, ["ConnectionStrings:DefaultConnection"] = "test-only" }))
            .ConfigureServices(services => {
                services.RemoveAll<EnglishLearningDbContext>(); services.AddScoped(_ => new EnglishLearningDbContext(new DbContextOptionsBuilder<EnglishLearningDbContext>().UseInMemoryDatabase(database).Options));
                services.RemoveAll<TimeProvider>(); services.AddSingleton<TimeProvider>(clock);
            }));
        using var client = factory.CreateClient(); User owner, other;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
            owner = new User { Email = "owner@example.com", FullName = "Owner", PasswordHash = "test-only" };
            other = new User { Email = "other@example.com", FullName = "Other", PasswordHash = "test-only" };
            db.Users.AddRange(owner, other); await db.SaveChangesAsync();
        }
        void SignIn(User user) => client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", factory.Services.GetRequiredService<JwtTokenService>().CreateToken(user).AccessToken);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/flashcards/decks")).StatusCode);
        SignIn(owner);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/flashcards/decks", new { title = " " })).StatusCode);
        var create = await client.PostAsJsonAsync("/api/v1/flashcards/decks", new { title = "  Giao tiếp  ", description = "Từ vựng", userId = other.UserId });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var deck = (await create.Content.ReadFromJsonAsync<DeckSummary>())!; Assert.Equal("Giao tiếp", deck.Title);
        var url = $"/api/v1/flashcards/decks/{deck.DeckId}";
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(url + "/cards", new { frontText = "word", backText = " " })).StatusCode);
        var cardResponse = await client.PostAsJsonAsync(url + "/cards", new { frontText = " confident ", backText = " tự tin ", exampleSentence = "I feel confident.", easeFactor = 99, repetition = 999 });
        Assert.Equal(HttpStatusCode.Created, cardResponse.StatusCode);
        var card = (await cardResponse.Content.ReadFromJsonAsync<FlashcardResponse>())!;
        Assert.True(card.IsDue); Assert.Equal(0, card.Repetition); Assert.Equal("confident", card.FrontText);
        var cardUrl = $"/api/v1/flashcards/cards/{card.CardId}";
        var detail = (await client.GetFromJsonAsync<DeckDetail>(url))!; Assert.Equal(1, detail.Deck.DueCount); Assert.Single(detail.Cards);
        SignIn(other);
        Assert.Empty((await client.GetFromJsonAsync<DeckSummary[]>("/api/v1/flashcards/decks"))!);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PutAsJsonAsync(url, new { title = "Intrusion" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(url + "/cards", new { frontText = "x", backText = "y" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PutAsJsonAsync(cardUrl, new { frontText = "x", backText = "y" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync(cardUrl)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(cardUrl + "/review", new { rating = 2, expectedUpdatedAt = card.UpdatedAt })).StatusCode);
        SignIn(owner);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(cardUrl + "/review", new { rating = 4, expectedUpdatedAt = card.UpdatedAt })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(cardUrl + "/review", new { rating = 2 })).StatusCode);
        var reviewBody = new { rating = 2, expectedUpdatedAt = card.UpdatedAt };
        var reviewed = await client.PostAsJsonAsync(cardUrl + "/review", reviewBody);
        Assert.Equal(HttpStatusCode.OK, reviewed.StatusCode);
        var saved = (await reviewed.Content.ReadFromJsonAsync<FlashcardResponse>())!; Assert.Equal(1, saved.IntervalDays); Assert.False(saved.IsDue);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync(cardUrl + "/review", reviewBody)).StatusCode);
        Assert.Equal(0, (await client.GetFromJsonAsync<DeckDetail>(url))!.Deck.DueCount);
        clock.Advance(TimeSpan.FromDays(1));
        Assert.Equal(1, (await client.GetFromJsonAsync<DeckDetail>(url))!.Deck.DueCount);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync(cardUrl + "/review", new { rating = 2, expectedUpdatedAt = card.UpdatedAt.AddSeconds(-1) })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync(cardUrl, new { frontText = "changed", backText = "đã sửa" })).StatusCode);
        var reset = (await client.GetFromJsonAsync<DeckDetail>(url))!.Cards[0]; Assert.Equal(0, reset.Repetition); Assert.True(reset.IsDue);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync(url, new { title = "Tên mới" })).StatusCode);
        Assert.Equal("Tên mới", (await client.GetFromJsonAsync<DeckDetail>(url))!.Deck.Title);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync(url)).StatusCode);
        using (var scope = factory.Services.CreateScope()) Assert.Empty(await scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>().Flashcards.ToArrayAsync());
        using (var scope = factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>(); (await db.Users.SingleAsync(u => u.UserId == owner.UserId)).IsActive = false; await db.SaveChangesAsync(); }
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/flashcards/decks")).StatusCode);
    }
    private sealed class StudyClock : TimeProvider
    {
        private DateTimeOffset now = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => now;
        public void Advance(TimeSpan duration) => now += duration;
    }
}
