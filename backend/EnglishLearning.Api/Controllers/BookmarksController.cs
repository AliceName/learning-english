using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Controllers;

[ApiController, Authorize, Route("api/v1/bookmarks")]
[Tags("Bookmarks")]
public sealed class BookmarksController(EnglishLearningDbContext db, TimeProvider clock,
    ILogger<BookmarksController> logger) : ControllerBase
{
    [HttpGet]
    public Task<IActionResult> List(CancellationToken ct) => Run(async owner =>
    {
        var owned = db.Bookmarks.AsNoTracking().Where(item => item.UserId == owner);
        var saved = await owned.OrderByDescending(item => item.CreatedAt)
            .ThenByDescending(item => item.BookmarkId).ToArrayAsync(ct);

        // Resolve each kind in bulk, without returning titles from targets the user can no longer open.
        var targets = new Dictionary<string, Dictionary<int, BookmarkTarget>>();
        foreach (var kind in saved.Select(item => item.TargetType).Distinct())
        {
            var query = VisibleTargets(owner, kind);
            if (query is null) continue;
            var ids = owned.Where(item => item.TargetType == kind).Select(item => item.TargetId);
            targets[kind] = await query.Where(target => ids.Contains(target.Id)).ToDictionaryAsync(target => target.Id, ct);
        }

        return Ok(saved.Select(item => ToResponse(item,
            targets.GetValueOrDefault(item.TargetType)?.GetValueOrDefault(item.TargetId))).ToArray());
    }, ct);

    [HttpPut("{targetType}/{targetId:int:min(1)}"), RequestSizeLimit(4096)]
    public Task<IActionResult> Save(string targetType, int targetId,
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] BookmarkNoteRequest? request, CancellationToken ct) => Run(async owner =>
    {
        var query = VisibleTargets(owner, targetType);
        if (query is null) return NotFound();
        var target = await query.SingleOrDefaultAsync(item => item.Id == targetId, ct);
        if (target is null) return NotFound();

        var owned = FindBookmark(owner, targetType, targetId).AsNoTracking();
        var existing = await owned.SingleOrDefaultAsync(ct);
        if (existing is not null) return Ok(ToResponse(existing, target));

        var bookmark = new Bookmark
        {
            UserId = owner,
            TargetId = targetId,
            TargetType = targetType,
            Note = CleanNote(request?.Note),
            CreatedAt = clock.GetUtcNow().UtcDateTime,
        };
        db.Bookmarks.Add(bookmark);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException error) when (error.InnerException is SqlException { Number: 2601 or 2627 })
        {
            // Another request may have already saved the same target.
            db.Entry(bookmark).State = EntityState.Detached;
            existing = await owned.SingleOrDefaultAsync(ct);
            if (existing is null) throw;
            return Ok(ToResponse(existing, target));
        }
        return Ok(ToResponse(bookmark, target));
    }, ct);

    [HttpPatch("{targetType}/{targetId:int:min(1)}"), RequestSizeLimit(4096)]
    public Task<IActionResult> UpdateNote(string targetType, int targetId, BookmarkNoteRequest request, CancellationToken ct) => Run(async owner =>
    {
        var bookmark = await FindBookmark(owner, targetType, targetId).SingleOrDefaultAsync(ct);
        if (bookmark is null) return NotFound();

        bookmark.Note = CleanNote(request.Note);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { return NotFound(); }
        return NoContent();
    }, ct);

    [HttpDelete("{targetType}/{targetId:int:min(1)}")]
    public Task<IActionResult> Delete(string targetType, int targetId, CancellationToken ct) => Run(async owner =>
    {
        if (targetType is not ("course" or "lesson" or "writing" or "flashcard" or "vocabulary")) return NotFound();
        var bookmark = await FindBookmark(owner, targetType, targetId).SingleOrDefaultAsync(ct);
        if (bookmark is null) return NoContent();

        db.Bookmarks.Remove(bookmark);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { /* The bookmark was already removed. */ }
        return NoContent();
    }, ct);

    private IQueryable<Bookmark> FindBookmark(int owner, string type, int id) =>
        db.Bookmarks.Where(item => item.UserId == owner && item.TargetType == type && item.TargetId == id);

    private IQueryable<BookmarkTarget>? VisibleTargets(int owner, string type) => type switch
    {
        "course" => db.VisibleCourses(owner).Select(course => new BookmarkTarget
        {
            Id = course.CourseId, Title = course.Title,
        }),
        "lesson" => from lesson in db.Lessons.AsNoTracking()
                    join course in db.VisibleCourses(owner) on lesson.CourseId equals course.CourseId
                    where lesson.IsActive
                    select new BookmarkTarget
                    {
                        Id = lesson.LessonId, Title = lesson.Title, ParentId = course.CourseId,
                        ParentTitle = course.Title, SkillType = lesson.SkillType,
                    },
        "writing" => db.WritingSubmissions.AsNoTracking().Where(item => item.UserId == owner)
            .Select(item => new BookmarkTarget { Id = item.SubmissionId, Title = item.Topic ?? "" }),
        "flashcard" => from card in db.Flashcards.AsNoTracking()
                       join deck in db.VisibleFlashcardDecks(owner) on card.DeckId equals deck.DeckId
                       select new BookmarkTarget
                       {
                           Id = card.CardId, Title = card.FrontText, ParentId = deck.DeckId, ParentTitle = deck.Title,
                       },
        _ => null,
    };

    private static BookmarkResponse ToResponse(Bookmark item, BookmarkTarget? target) =>
        new(item.TargetType, item.TargetId, DateTime.SpecifyKind(item.CreatedAt, DateTimeKind.Utc), target, item.Note);

    private static string? CleanNote(string? note) => string.IsNullOrWhiteSpace(note) ? null : note.Trim();

    private async Task<IActionResult> Run(Func<int, Task<IActionResult>> action, CancellationToken ct)
    {
        Response.Headers.CacheControl = "private, no-store";
        if (!int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var owner) || owner <= 0)
            return Unauthorized();
        try
        {
            return await action(owner);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            return StatusCode(StatusCodes.Status499ClientClosedRequest);
        }
        catch (Exception error) when (error is SqlException or DbUpdateException or OperationCanceledException)
        {
            logger.LogError(error, "Database request failed while processing bookmarks.");
            return Problem(statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Chưa xử lý được dấu trang. Vui lòng thử lại.");
        }
    }
}
