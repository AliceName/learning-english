using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Controllers;

[ApiController, Authorize, Route("api/v1/speaking"), Tags("Speaking practice")]
public sealed class SpeakingController(EnglishLearningDbContext db, SpeakingLessonService lessons, ISpeakingScorer scorer,
    SpeakingStorage storage, TimeProvider time, ILogger<SpeakingController> logger) : ControllerBase
{
    [HttpGet("lessons/{lessonId:int:min(1)}")]
    public Task<IActionResult> Lesson(int lessonId, CancellationToken ct) => Execute(async uid =>
        await lessons.GetAsync(uid, lessonId, ct) is { } lesson ? Ok(lesson) : NotFound(), ct);

    [HttpPost("attempts"), RequestSizeLimit(SpeakingStorage.MaxBytes + 65536), RequestFormLimits(MultipartBodyLengthLimit = SpeakingStorage.MaxBytes)]
    public Task<IActionResult> Submit([FromForm] SubmitSpeakingRequest request, CancellationToken ct) => Execute(async uid =>
    {
        var lesson = await lessons.GetAsync(uid, request.LessonId, ct);
        if (lesson is null) return NotFound();
        if (request.SentenceIndex >= lesson.Sentences.Length) return Problem(statusCode: 400, title: "Câu luyện nói không tồn tại.");
        var text = lesson.Sentences[request.SentenceIndex].Text;
        SpeakingAttemptScope? scope = null;
        if (request.SegmentIndex is { } segmentIndex)
        {
            var segments = lesson.Segments?[request.SentenceIndex];
            if (segments is null || segmentIndex < 0 || segmentIndex >= segments.Length)
                return Problem(statusCode: 400, title: "Cụm luyện nói không tồn tại. Hãy tải lại bài học.");
            var segment = segments[segmentIndex];
            scope = new("segment", segment.Index, segment.StartWordIndex, segment.WordCount, text, SpeakingPhraseSegmenter.Version);
            text = segment.Text;
        }
        var wav = await SpeakingStorage.ReadWavAsync(request.File, ct);
        var assessment = await scorer.ScoreAsync(wav, text, ct);
        if (!SpeakingScorerClient.IsValid(assessment, text)) throw new SpeakingException(502, "Kết quả chấm không hợp lệ.");
        var url = await storage.SaveAsync(wav, ct);
        var attempt = new SpeakingAttempt { UserId = uid, LessonId = lesson.LessonId, AudioUrl = url,
            OverallScore = (decimal)assessment.OverallScore, DurationSeconds = (int)Math.Ceiling(assessment.DurationSeconds),
            Feedback = assessment.Feedback, CreatedAt = time.GetUtcNow().UtcDateTime,
            PhonemeScores = JsonSerializer.Serialize(new StoredSpeakingResult(1, request.SentenceIndex, text, assessment, scope), SpeakingLessonService.JsonOptions) };
        try { db.SpeakingAttempts.Add(attempt); await db.SaveChangesAsync(ct); }
        catch { storage.Delete(url); throw; }
        return Created($"/api/v1/speaking/attempts/{attempt.AttemptId}", ToResponse(attempt));
    }, ct);

    [HttpGet("lessons/{lessonId:int:min(1)}/attempts")]
    public Task<IActionResult> History(int lessonId, CancellationToken ct) => Execute(async uid =>
    {
        if (await lessons.GetAsync(uid, lessonId, ct) is null) return NotFound();
        var attempts = await db.SpeakingAttempts.AsNoTracking().Where(a => a.UserId == uid && a.LessonId == lessonId)
            .OrderByDescending(a => a.CreatedAt).ThenByDescending(a => a.AttemptId).Take(20).ToListAsync(ct);
        return Ok(attempts.Select(ToResponse).Where(a => a is not null));
    }, ct);

    [HttpGet("attempts/{attemptId:int:min(1)}")]
    public Task<IActionResult> Attempt(int attemptId, CancellationToken ct) => Execute(async uid =>
    {
        var attempt = await db.SpeakingAttempts.AsNoTracking().SingleOrDefaultAsync(a => a.AttemptId == attemptId && a.UserId == uid, ct);
        return attempt is not null && ToResponse(attempt) is { } response ? Ok(response) : NotFound();
    }, ct);

    [HttpGet("recordings/{fileName}")]
    public Task<IActionResult> Audio(string fileName, CancellationToken ct) => Execute(async uid =>
    {
        if (!SpeakingStorage.IsFileName(fileName)) return NotFound();
        var url = "/api/speaking/recordings/" + fileName;
        if (!await db.SpeakingAttempts.AnyAsync(a => a.UserId == uid && a.AudioUrl == url, ct)) return NotFound();
        var path = storage.Resolve(url);
        if (path is null || !System.IO.File.Exists(path)) return NotFound();
        Response.Headers.XContentTypeOptions = "nosniff";
        return PhysicalFile(path, "audio/wav", enableRangeProcessing: true);
    }, ct);

    private static SpeakingAttemptResponse? ToResponse(SpeakingAttempt attempt)
    {
        try
        {
            var stored = attempt.PhonemeScores is null ? null : JsonSerializer.Deserialize<StoredSpeakingResult>(attempt.PhonemeScores, SpeakingLessonService.JsonOptions);
            return stored is { Version: 1, Assessment: not null } ? new(attempt.AttemptId, attempt.LessonId, stored.SentenceIndex,
                stored.ReferenceText, DateTime.SpecifyKind(attempt.CreatedAt, DateTimeKind.Utc), attempt.AudioUrl, stored.Assessment, stored.Scope) : null;
        }
        catch (JsonException) { return null; }
    }
    private async Task<IActionResult> Execute(Func<int, Task<IActionResult>> action, CancellationToken ct)
    {
        Response.Headers.CacheControl = "private, no-store";
        if (!int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var uid) || uid <= 0) return Unauthorized();
        try
        {
            if (!await db.Users.AsNoTracking().AnyAsync(u => u.UserId == uid && u.IsActive, ct)) return Unauthorized();
            return await action(uid);
        }
        catch (SpeakingException e) { return Problem(statusCode: e.Status, title: e.Message); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { return StatusCode(499); }
        catch (Exception e) when (e is SqlException or DbUpdateException or IOException or OperationCanceledException)
        {
            logger.LogError(e, "Speaking request failed for user {UserId}.", uid);
            return Problem(statusCode: 503, title: "Chưa thể xử lý bài nói. Vui lòng thử lại sau.");
        }
    }
}
