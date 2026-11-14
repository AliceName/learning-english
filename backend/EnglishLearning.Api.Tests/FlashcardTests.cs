using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
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
    public void Writing_candidates_require_evidence_and_prioritize_distinct_corrections()
    {
        const string source = "I wrote freind in my journal. I keep a journal and take notes. I take notes again.";
        const string sentence = "I wrote freind in my journal.";
        var edits = new[]
        {
            new WritingSuggestion(sentence, "I wrote friend in my journal.",
                [new("SPELL", "freind", "friend", "Spelling", "vi-edit-templates-v1")], 0, sentence.Length),
            new WritingSuggestion(sentence, "I wrote partner in my journal.",
                [new("OTHER", "freind", "partner", "Other", "vi-edit-templates-v1")], 0, sentence.Length),
            new WritingSuggestion(sentence, "I wrote friend and make progress in my journal.", null, 1, sentence.Length)
        };
        var candidates = WritingCardCandidates.Find(source, edits);
        Assert.Equal(new[] { "friend", "keep a journal", "take notes" }, candidates.Select(c => c.Term));
        Assert.Equal("correction", candidates[0].Source);
        Assert.Equal(sentence, candidates[0].Context);
        Assert.Empty(WritingCardCandidates.Find("A complete sentence with no listed expressions.", []));
        Assert.Empty(WritingCardCandidates.Find("I take notes-worthy examples.", []));
    }

    [Fact]
    public void Writing_candidates_ignore_malformed_spans_no_op_edits_and_unsubstantiated_explanations()
    {
        const string original = "😀 I wrote freind.";
        const string proposal = "😀 I wrote friend.";
        var explanation = new WritingExplanation("SPELL", "freind", "friend", "Spelling", "vi-edit-templates-v1");
        var valid = new WritingSuggestion(original, proposal, [explanation], 0, original.Length);
        Assert.Equal("friend", Assert.Single(WritingCardCandidates.Find(original, [valid])).Term);
        var brokenSurrogate = valid with { Original = original[1..], SourceStart = 1 };
        var noOp = valid with { Suggestion = original, Explanations = [explanation with { Suggestion = "freind" }] };
        var noChange = valid with { Suggestion = "😀 I wrote freind yesterday.", Explanations = noOp.Explanations };
        var invalidExplanation = valid with { Explanations = [explanation with { Original = "frie" }] };
        Assert.Empty(WritingCardCandidates.Find(original, [brokenSurrogate, noOp, noChange, invalidExplanation]));
    }

    [Fact]
    public async Task Writing_import_requires_owned_source_and_deck_and_deduplicates_without_merging_senses()
    {
        var database = Guid.NewGuid().ToString();
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Development")
            .ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?> {
                ["Jwt:SigningKey"] = TestJwt.SigningKey, ["ConnectionStrings:DefaultConnection"] = "test-only" }))
            .ConfigureServices(services => {
                services.RemoveAll<EnglishLearningDbContext>();
                services.AddScoped(_ => new EnglishLearningDbContext(new DbContextOptionsBuilder<EnglishLearningDbContext>().UseInMemoryDatabase(database).Options));
            }));
        await VerifyWritingImport(factory, "owner@example.test", "other@example.test");
    }

    internal static async Task VerifyWritingImport(WebApplicationFactory<Program> factory, string ownerEmail, string otherEmail)
    {
        using var client = factory.CreateClient();
        User owner, other;
        WritingSubmission source, later, separateEssay;
        FlashcardDeck deck, otherDeck;
        int legacyCardId;
        const string text = "I take notes in class, and I keep a journal.";
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
            owner = new User { Email = ownerEmail, FullName = "Owner", PasswordHash = "test-only", IsActive = true };
            other = new User { Email = otherEmail, FullName = "Other", PasswordHash = "test-only", IsActive = true };
            db.Users.AddRange(owner, other); await db.SaveChangesAsync();
            source = new WritingSubmission { UserId = owner.UserId, OriginalText = text, CefrLevel = "B1",
                ErrorsJson = """{"cefr":"B1","errors":[],"warnings":[],"practice":{"versionNumber":1,"targetCefr":"B2"}}""" };
            deck = new FlashcardDeck { UserId = owner.UserId, Title = "Mine" };
            otherDeck = new FlashcardDeck { UserId = other.UserId, Title = "Other" };
            db.WritingSubmissions.Add(source); db.FlashcardDecks.AddRange(deck, otherDeck); await db.SaveChangesAsync();
            later = new WritingSubmission { UserId = owner.UserId, OriginalText = text, CefrLevel = "B1",
                ErrorsJson = JsonSerializer.Serialize(new { cefr = "B1", practice = new
                { rootSubmissionId = source.SubmissionId, parentSubmissionId = source.SubmissionId, versionNumber = 2, targetCefr = "C1" } }) };
            separateEssay = new WritingSubmission { UserId = owner.UserId, OriginalText = "At work, I take notes during every meeting.", CefrLevel = "A2" };
            db.WritingSubmissions.AddRange(later, separateEssay);
            var legacy = new Flashcard { DeckId = deck.DeckId, FrontText = "before Writing", BackText = "thẻ cũ" };
            db.Flashcards.Add(legacy); await db.SaveChangesAsync();
            legacyCardId = legacy.CardId;
        }
        void SignIn(User user) => client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer",
            factory.Services.GetRequiredService<JwtTokenService>().CreateToken(user).AccessToken);
        const string api = "/api/v1/flashcards";
        var suggested = $"{api}/writing/{source.SubmissionId}";
        var import = $"{api}/decks/{deck.DeckId}/writing/{source.SubmissionId}";
        var body = new { sourceTerm = "take notes", frontText = "take notes in class", backText = "ghi chép trên lớp", exampleSentence = text };
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(suggested)).StatusCode);
        SignIn(other);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(suggested)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(import, body)).StatusCode);
        SignIn(owner);
        var suggestions = (await client.GetFromJsonAsync<WritingCardSuggestions>(suggested))!;
        Assert.Equal(source.SubmissionId, suggestions.SubmissionId);
        Assert.Equal(1, suggestions.VersionNumber);
        Assert.Equal("B2", suggestions.TargetCefr);
        Assert.Equal(2, suggestions.Items.Length);
        Assert.All(suggestions.Items, candidate => Assert.Equal(text, candidate.Context));
        var nextSuggestions = (await client.GetFromJsonAsync<WritingCardSuggestions>($"{api}/writing/{later.SubmissionId}"))!;
        Assert.Equal("C1", nextSuggestions.TargetCefr);
        Assert.Equal(source.SubmissionId, nextSuggestions.PracticeRootId);
        Assert.Equal(suggestions.Items, nextSuggestions.Items);
        Assert.Equal(legacyCardId, Assert.Single((await client.GetFromJsonAsync<DeckDetail>($"{api}/decks/{deck.DeckId}"))!.Cards).CardId);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync($"{api}/decks/{otherDeck.DeckId}/writing/{source.SubmissionId}", body)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(import, body with { sourceTerm = "invented" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(import, body with { backText = "" })).StatusCode);
        var results = await Task.WhenAll(client.PostAsJsonAsync(import, body), client.PostAsJsonAsync(import, body));
        Assert.Contains(results, result => result.StatusCode == HttpStatusCode.Created);
        Assert.Contains(results, result => result.StatusCode == HttpStatusCode.OK);
        var firstSave = (await results[0].Content.ReadFromJsonAsync<WritingCardSave>())!;
        var saved = firstSave.Card;
        Assert.Equal(new WritingCardImportSource(source.SubmissionId, 1, "take notes", text), firstSave.ValidatedSource);
        Assert.Equal(saved.CardId, (await results[1].Content.ReadFromJsonAsync<WritingCardSave>())!.Card.CardId);
        var otherVersion = await client.PostAsJsonAsync($"{api}/decks/{deck.DeckId}/writing/{later.SubmissionId}", body);
        var repeated = (await otherVersion.Content.ReadFromJsonAsync<WritingCardSave>())!;
        Assert.True(repeated.AlreadySaved);
        Assert.Equal(saved.CardId, repeated.Card.CardId);
        Assert.Equal(later.SubmissionId, repeated.ValidatedSource!.SubmissionId);
        Assert.Equal(2, repeated.ValidatedSource.VersionNumber);
        var fromSeparateEssay = await client.PostAsJsonAsync($"{api}/decks/{deck.DeckId}/writing/{separateEssay.SubmissionId}", body);
        var separate = (await fromSeparateEssay.Content.ReadFromJsonAsync<WritingCardSave>())!;
        Assert.True(separate.AlreadySaved);
        Assert.Equal(saved.CardId, separate.Card.CardId);
        Assert.Equal(new WritingCardImportSource(separateEssay.SubmissionId, null, "take notes", separateEssay.OriginalText), separate.ValidatedSource);
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync(import, body with { backText = "ghi biên bản" })).StatusCode);
        var commonDeck = (await client.GetFromJsonAsync<DeckDetail>($"{api}/decks/{deck.DeckId}"))!;
        Assert.Equal(3, commonDeck.Cards.Length);
        Assert.All(commonDeck.Cards, card => Assert.True(card.IsDue));
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync($"{api}/cards/{saved.CardId}/review",
            new { rating = 2, expectedUpdatedAt = saved.UpdatedAt })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"{api}/cards/{saved.CardId}")).StatusCode);
        using var finalScope = factory.Services.CreateScope();
        var persisted = finalScope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        Assert.Equal(text, (await persisted.WritingSubmissions.FindAsync(source.SubmissionId))!.OriginalText);
        Assert.Null(await persisted.Flashcards.FindAsync(saved.CardId));
        Assert.NotNull(await persisted.Flashcards.FindAsync(legacyCardId));
    }

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
