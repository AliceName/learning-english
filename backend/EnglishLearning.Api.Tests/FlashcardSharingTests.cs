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

public sealed class FlashcardSharingTests
{
    [Fact]
    public async Task Admin_decks_are_visible_read_only_and_copied_reviews_never_change_the_original()
    {
        var database = Guid.NewGuid().ToString();
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Development")
            .ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?> {
                ["Jwt:SigningKey"] = TestJwt.SigningKey, ["ConnectionStrings:DefaultConnection"] = "test-only" }))
            .ConfigureServices(services => { services.RemoveAll<EnglishLearningDbContext>(); services.AddScoped(_ => new EnglishLearningDbContext(new DbContextOptionsBuilder<EnglishLearningDbContext>().UseInMemoryDatabase(database).Options)); }));
        using var client = factory.CreateClient(); User admin, learner, other;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
            admin = new User { Email = "admin@example.com", FullName = "Admin", Role = "admin", PasswordHash = "test" };
            learner = new User { Email = "learner@example.com", FullName = "Learner", PasswordHash = "test" };
            other = new User { Email = "other@example.com", FullName = "Other", PasswordHash = "test" };
            db.Users.AddRange(admin, learner, other); await db.SaveChangesAsync();
        }
        void SignIn(User user) => client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", factory.Services.GetRequiredService<JwtTokenService>().CreateToken(user).AccessToken);
        SignIn(admin);
        var created = await client.PostAsJsonAsync("/api/v1/flashcards/decks", new { title = "Admin vocabulary" });
        var shared = (await created.Content.ReadFromJsonAsync<DeckSummary>())!; Assert.True(shared.CanEdit); Assert.True(shared.IsAdminDeck);
        var url = $"/api/v1/flashcards/decks/{shared.DeckId}";
        var card = (await (await client.PostAsJsonAsync(url + "/cards", new { frontText = "cat", backText = "con mèo" })).Content.ReadFromJsonAsync<FlashcardResponse>())!;
        var cardUrl = $"/api/v1/flashcards/cards/{card.CardId}";
        SignIn(learner);
        var visible = (await client.GetFromJsonAsync<DeckSummary[]>("/api/v1/flashcards/decks"))!;
        Assert.Single(visible); Assert.True(visible[0].IsAdminDeck); Assert.False(visible[0].CanEdit); Assert.Equal(0, visible[0].DueCount);
        var readOnly = (await client.GetFromJsonAsync<DeckDetail>(url))!; Assert.Single(readOnly.Cards); Assert.False(readOnly.Cards[0].IsDue);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PutAsJsonAsync(url, new { title = "hacked" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(url + "/cards", new { frontText = "dog", backText = "chó" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PutAsJsonAsync(cardUrl, new { frontText = "hacked", backText = "hacked" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync(cardUrl)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(cardUrl + "/review", new { rating = 2, expectedUpdatedAt = card.UpdatedAt })).StatusCode);
        var copyResponse = await client.PostAsJsonAsync(url + "/copy", new { userId = other.UserId });
        Assert.Equal(HttpStatusCode.Created, copyResponse.StatusCode);
        var copy = (await copyResponse.Content.ReadFromJsonAsync<DeckSummary>())!; Assert.True(copy.CanEdit); Assert.False(copy.IsAdminDeck);
        var copyUrl = $"/api/v1/flashcards/decks/{copy.DeckId}";
        var personal = (await client.GetFromJsonAsync<DeckDetail>(copyUrl))!; Assert.Single(personal.Cards); Assert.Equal(1, personal.Deck.DueCount);
        var personalCard = personal.Cards[0]; Assert.NotEqual(card.CardId, personalCard.CardId);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync($"/api/v1/flashcards/cards/{personalCard.CardId}/review", new { rating = 2, expectedUpdatedAt = personalCard.UpdatedAt })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync($"/api/v1/flashcards/cards/{personalCard.CardId}", new { frontText = "my cat", backText = "mèo của tôi" })).StatusCode);
        Assert.Equal("cat", (await client.GetFromJsonAsync<DeckDetail>(url))!.Cards[0].FrontText);
        SignIn(other);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(copyUrl)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(copyUrl + "/copy", new { })).StatusCode);
        SignIn(admin);
        var original = (await client.GetFromJsonAsync<DeckDetail>(url))!.Cards[0]; Assert.Equal(0, original.Repetition); Assert.True(original.IsDue);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(copyUrl)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync(cardUrl, new { frontText = "kitten", backText = "mèo con" })).StatusCode);
        SignIn(learner);
        Assert.Equal("kitten", (await client.GetFromJsonAsync<DeckDetail>(url))!.Cards[0].FrontText);
        Assert.Equal("my cat", (await client.GetFromJsonAsync<DeckDetail>(copyUrl))!.Cards[0].FrontText);
        using (var scope = factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>(); (await db.Users.SingleAsync(u => u.UserId == admin.UserId)).IsActive = false; await db.SaveChangesAsync(); }
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(url + "/copy", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(copyUrl)).StatusCode);
    }
}
