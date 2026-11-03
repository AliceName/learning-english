using System.Data;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Controllers;

[ApiController, Authorize, Route("api/v1/flashcards")]
[RequestSizeLimit(16 * 1024)]
public sealed class FlashcardsController(EnglishLearningDbContext db, TimeProvider clock, ILogger<FlashcardsController> logger) : ControllerBase
{
    private DateTime Now => clock.GetUtcNow().UtcDateTime;
    private static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);
    private static FlashcardResponse Card(Flashcard c, DateTime now) => new(c.CardId, c.DeckId, c.FrontText, c.BackText, c.ExampleSentence,
        c.IntervalDays, c.Repetition, c.NextReviewAt is { } date ? Utc(date) : null, Utc(c.UpdatedAt), c.NextReviewAt is null || c.NextReviewAt <= now);
    private IQueryable<FlashcardDeck> Owned(int owner) => db.FlashcardDecks.Where(d => d.UserId == owner);
    private IQueryable<FlashcardDeck> Visible(int owner) => db.FlashcardDecks.Where(d => d.UserId == owner || db.Users.Any(u => u.UserId == d.UserId && u.IsActive && u.Role == "admin"));
    private IQueryable<Flashcard> OwnedCards(int owner) => db.Flashcards.Where(c => db.FlashcardDecks.Any(d => d.UserId == owner && d.DeckId == c.DeckId));
    private IQueryable<DeckSummary> Summaries(int owner, DateTime now, int? deckId = null) => Visible(owner).Where(d => deckId == null || d.DeckId == deckId).OrderByDescending(d => d.UpdatedAt).ThenByDescending(d => d.DeckId)
        .Select(d => new DeckSummary(d.DeckId, d.Title, d.Description, db.Flashcards.Count(c => c.DeckId == d.DeckId), d.UserId == owner ? db.Flashcards.Count(c => c.DeckId == d.DeckId && (c.NextReviewAt == null || c.NextReviewAt <= now)) : 0,
            d.UserId == owner, db.Users.Any(u => u.UserId == d.UserId && u.IsActive && u.Role == "admin")));
    private async Task<IActionResult> Run(Func<int, Task<IActionResult>> action, CancellationToken ct)
    {
        Response.Headers.CacheControl = "private, no-store";
        if (!int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var owner) || owner <= 0) return Unauthorized();
        try
        {
            if (!await db.Users.AnyAsync(u => u.UserId == owner && u.IsActive, ct)) return Unauthorized();
            return await action(owner);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { return StatusCode(499); }
        catch (Exception error) when (error is SqlException or DbUpdateException or OperationCanceledException)
        { logger.LogError(error, "Flashcards request failed"); return Problem(statusCode: 503, title: "Chưa xử lý được bộ thẻ. Vui lòng thử lại."); }
    }

    [HttpGet("decks")]
    public Task<IActionResult> List(CancellationToken ct) => Run(async owner => Ok(await Summaries(owner, Now).ToArrayAsync(ct)), ct);

    [HttpPost("decks")]
    public Task<IActionResult> CreateDeck(SaveDeckRequest request, CancellationToken ct) => Run(async owner => {
        if (await Owned(owner).CountAsync(ct) >= 100) return Problem(statusCode: 400, title: "Mỗi tài khoản tối đa 100 bộ thẻ.");
        var now = Now;
        var deck = new FlashcardDeck { UserId = owner, Title = request.Title, Description = request.Description?.Trim(), CreatedAt = now, UpdatedAt = now };
        db.FlashcardDecks.Add(deck); await db.SaveChangesAsync(ct);
        return StatusCode(201, await Summaries(owner, now, deck.DeckId).SingleAsync(ct));
    }, ct);

    [HttpGet("decks/{id:int:min(1)}")]
    public Task<IActionResult> GetDeck(int id, CancellationToken ct) => Run(async owner => {
        var now = Now; var deck = await Summaries(owner, now, id).SingleOrDefaultAsync(ct);
        if (deck is null) return NotFound();
        var cards = await db.Flashcards.AsNoTracking().Where(c => c.DeckId == id).OrderBy(c => c.CreatedAt).ThenBy(c => c.CardId).ToArrayAsync(ct);
        return Ok(new DeckDetail(deck, cards.Select(c => deck.CanEdit ? Card(c, now) : Card(c, now) with { Repetition = 0, IntervalDays = 0, NextReviewAt = null, IsDue = false }).ToArray()));
    }, ct);

    [HttpPost("decks/{id:int:min(1)}/copy")]
    public Task<IActionResult> Copy(int id, CancellationToken ct) => Run(async owner => {
        await using var transaction = db.Database.IsRelational() ? await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct) : null;
        var source = await Visible(owner).AsNoTracking().SingleOrDefaultAsync(d => d.DeckId == id, ct);
        if (source is null) return NotFound();
        if (source.UserId == owner) return Problem(statusCode: 400, title: "Bộ thẻ này đã thuộc tài khoản của bạn.");
        if (await Owned(owner).CountAsync(ct) >= 100) return Problem(statusCode: 400, title: "Mỗi tài khoản tối đa 100 bộ thẻ riêng.");
        var sourceCards = await db.Flashcards.AsNoTracking().Where(c => c.DeckId == id).OrderBy(c => c.CardId).Take(501).ToArrayAsync(ct);
        if (sourceCards.Length > 500) return Problem(statusCode: 400, title: "Bộ nguồn vượt giới hạn 500 thẻ.");
        var now = Now; const string suffix = " (bản sao riêng)";
        var copy = new FlashcardDeck { UserId = owner, Title = source.Title[..Math.Min(source.Title.Length, 255 - suffix.Length)] + suffix, Description = source.Description, CreatedAt = now, UpdatedAt = now };
        db.FlashcardDecks.Add(copy); await db.SaveChangesAsync(ct);
        db.Flashcards.AddRange(sourceCards.Select(c => new Flashcard { DeckId = copy.DeckId, FrontText = c.FrontText, BackText = c.BackText, ExampleSentence = c.ExampleSentence, CreatedAt = now, UpdatedAt = now }));
        await db.SaveChangesAsync(ct);
        if (transaction is not null) await transaction.CommitAsync(ct);
        return StatusCode(201, await Summaries(owner, now, copy.DeckId).SingleAsync(ct));
    }, ct);

    [HttpPut("decks/{id:int:min(1)}")]
    public Task<IActionResult> UpdateDeck(int id, SaveDeckRequest request, CancellationToken ct) => Run(async owner => {
        var deck = await Owned(owner).SingleOrDefaultAsync(d => d.DeckId == id, ct); if (deck is null) return NotFound();
        deck.Title = request.Title; deck.Description = request.Description?.Trim(); deck.UpdatedAt = Now; await db.SaveChangesAsync(ct);
        return Ok(await Summaries(owner, Now, id).SingleAsync(ct));
    }, ct);

    [HttpDelete("decks/{id:int:min(1)}")]
    public Task<IActionResult> DeleteDeck(int id, CancellationToken ct) => Run(async owner => {
        var deck = await Owned(owner).SingleOrDefaultAsync(d => d.DeckId == id, ct); if (deck is null) return NotFound();
        db.Flashcards.RemoveRange(await db.Flashcards.Where(c => c.DeckId == id).ToArrayAsync(ct));
        db.FlashcardDecks.Remove(deck); await db.SaveChangesAsync(ct); return NoContent();
    }, ct);

    [HttpPost("decks/{id:int:min(1)}/cards")]
    public Task<IActionResult> CreateCard(int id, SaveCardRequest request, CancellationToken ct) => Run(async owner => {
        var deck = await Owned(owner).SingleOrDefaultAsync(d => d.DeckId == id, ct); if (deck is null) return NotFound();
        if (await db.Flashcards.CountAsync(c => c.DeckId == id, ct) >= 500) return Problem(statusCode: 400, title: "Mỗi bộ tối đa 500 thẻ.");
        var now = Now; var card = new Flashcard { DeckId = id, FrontText = request.FrontText, BackText = request.BackText, ExampleSentence = request.ExampleSentence?.Trim(), CreatedAt = now, UpdatedAt = now };
        db.Flashcards.Add(card); deck.UpdatedAt = now; await db.SaveChangesAsync(ct); return StatusCode(201, Card(card, now));
    }, ct);

    [HttpPut("cards/{id:int:min(1)}")]
    public Task<IActionResult> UpdateCard(int id, SaveCardRequest request, CancellationToken ct) => Run(async owner => {
        var card = await OwnedCards(owner).SingleOrDefaultAsync(c => c.CardId == id, ct); if (card is null) return NotFound();
        card.FrontText = request.FrontText; card.BackText = request.BackText; card.ExampleSentence = request.ExampleSentence?.Trim();
        // Changed meaning invalidates the old recall schedule.
        card.Repetition = 0; card.IntervalDays = 0; card.NextReviewAt = null; card.EaseFactor = 2.50m; card.UpdatedAt = Now;
        await db.SaveChangesAsync(ct); return Ok(Card(card, Now));
    }, ct);

    [HttpDelete("cards/{id:int:min(1)}")]
    public Task<IActionResult> DeleteCard(int id, CancellationToken ct) => Run(async owner => {
        var card = await OwnedCards(owner).SingleOrDefaultAsync(c => c.CardId == id, ct); if (card is null) return NotFound();
        db.Flashcards.Remove(card); await db.SaveChangesAsync(ct); return NoContent();
    }, ct);

    [HttpPost("cards/{id:int:min(1)}/review")]
    public Task<IActionResult> Review(int id, ReviewCardRequest request, CancellationToken ct) => Run(async owner => {
        await using var transaction = db.Database.IsRelational() ? await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct) : null;
        var card = await OwnedCards(owner).SingleOrDefaultAsync(c => c.CardId == id, ct); if (card is null) return NotFound();
        var now = Now;
        if (request.ExpectedUpdatedAt!.Value.ToUniversalTime() != Utc(card.UpdatedAt) || card.NextReviewAt > now)
            return Problem(statusCode: 409, title: "Thẻ đã thay đổi hoặc chưa đến lịch ôn. Hãy tải lại bộ thẻ.");
        FlashcardScheduler.Review(card, request.Rating!.Value, now); await db.SaveChangesAsync(ct);
        if (transaction is not null) await transaction.CommitAsync(ct);
        return Ok(Card(card, now));
    }, ct);
}
