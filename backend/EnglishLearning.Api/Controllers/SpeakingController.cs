using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services;
using EnglishLearning.Api.Services.CloudinaryMedia;
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

    [HttpPost("attempts"), LearningActivity(LearningKind.Speaking, 201), RequestSizeLimit(SpeakingStorage.MaxBytes + 65536), RequestFormLimits(MultipartBodyLengthLimit = SpeakingStorage.MaxBytes)]
    public Task<IActionResult> Submit([FromForm] SubmitSpeakingRequest request, CancellationToken ct) => Execute(async uid =>
    {
        var lesson = await lessons.GetAsync(uid, request.LessonId, ct);
        if (lesson is null) return NotFound();
        if (request.SentenceIndex >= lesson.Sentences.Length) return Problem(statusCode: 400, title: "Câu luyện nói không tồn tại.");
        var text = lesson.Sentences[request.SentenceIndex].Text;
        if (request.SentenceText is { } sentenceText && sentenceText != text)
            return Problem(statusCode: 409, title: "Câu luyện nói đã thay đổi. Hãy tải lại bài học trước khi ghi âm lại.");
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
        var (wav, assessment) = await AssessAsync(request.File, text, ct, scope);
        // Keep the score even when the recording cannot be stored: the learner should not have to be re-scored.
        var url = "";
        try { url = await storage.SaveAsync(wav, ct); }
        catch (CloudMediaException error) { logger.LogWarning("Speaking recording not stored for user {UserId} ({Code}).", uid, error.Code); }
        var attempt = new SpeakingAttempt { UserId = uid, LessonId = lesson.LessonId, AudioUrl = url,
            OverallScore = (decimal)assessment.OverallScore, DurationSeconds = (int)Math.Ceiling(assessment.DurationSeconds),
            Feedback = assessment.Feedback, CreatedAt = time.GetUtcNow().UtcDateTime,
            PhonemeScores = JsonSerializer.Serialize(new StoredSpeakingResult(1, request.SentenceIndex, text, assessment, scope), SpeakingLessonService.JsonOptions) };
        try { db.SpeakingAttempts.Add(attempt); await db.SaveChangesAsync(ct); }
        catch { await storage.DeleteAsync(url, CancellationToken.None); throw; }
        await PruneRecordingsAsync(uid, lesson.LessonId);
        return Created($"/api/v1/speaking/attempts/{attempt.AttemptId}", ToResponse(attempt));
    }, ct);

    [HttpPost("free/score"), LearningActivity(LearningKind.Speaking), RequestSizeLimit(SpeakingStorage.MaxBytes + 65536), RequestFormLimits(MultipartBodyLengthLimit = SpeakingStorage.MaxBytes)]
    public Task<IActionResult> ScoreFree([FromForm] ScoreFreeSpeakingRequest request, CancellationToken ct) => Execute(async _ =>
    {
        var (_, assessment) = await AssessAsync(request.File, request.Text.Trim(), ct);
        return Ok(assessment);
    }, ct);

    private async Task<(byte[] Wav, SpeakingAssessment Assessment)> AssessAsync(
        IFormFile file, string text, CancellationToken ct, SpeakingAttemptScope? scope = null)
    {
        if (SpeakingReferenceText.GetError(text) is { } error) throw new SpeakingException(400, error);
        var wav = await SpeakingStorage.ReadWavAsync(file, ct);
        var assessment = await scorer.ScoreAsync(wav, text, ct, scope);
        if (!SpeakingScorerClient.IsValid(assessment, text)) throw new SpeakingException(502, "Kết quả chấm không hợp lệ.");
        return (wav, assessment);
    }

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
        var read = await storage.OpenAsync(url, Request.Headers.Range.ToString(), ct);
        if (read is null) return NotFound();
        Response.Headers.XContentTypeOptions = "nosniff";
        if (read.EnableRangeProcessing) return File(read.Body, read.ContentType, enableRangeProcessing: true);
        Response.Headers.AcceptRanges = "bytes";
        Response.StatusCode = read.Status; Response.ContentLength = read.Length;
        if (read.ContentRange is not null) Response.Headers.ContentRange = read.ContentRange;
        // EmptyResult: StatusCode(416) would add a ProblemDetails body that breaks the declared Content-Length: 0.
        if (read.Status == 416) { await read.DisposeAsync(); return new EmptyResult(); }
        return File(read.Body, read.ContentType, enableRangeProcessing: false);
    }, ct);

    /// <summary>
    /// Keeps the recordings of the newest <see cref="KeptRecordings"/> attempts per user and lesson (the history
    /// the page shows). Older attempts keep their scores; their audio is deleted and AudioUrl cleared. Best effort.
    /// </summary>
    private async Task PruneRecordingsAsync(int uid, int lessonId)
    {
        try
        {
            var old = await db.SpeakingAttempts.Where(a => a.UserId == uid && a.LessonId == lessonId)
                .OrderByDescending(a => a.CreatedAt).ThenByDescending(a => a.AttemptId).Skip(KeptRecordings)
                .Where(a => a.AudioUrl != "").ToListAsync(CancellationToken.None);
            foreach (var attempt in old)
                if (await storage.DeleteAsync(attempt.AudioUrl, CancellationToken.None)) attempt.AudioUrl = "";
            if (old.Count > 0) await db.SaveChangesAsync(CancellationToken.None);
        }
        catch (Exception error) when (error is SqlException or DbUpdateException or InvalidOperationException)
        {
            logger.LogWarning(error, "Pruning old speaking recordings failed for user {UserId}.", uid);
        }
    }
    private const int KeptRecordings = 20;

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
        catch (CloudMediaException e) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning("Speaking recording storage failed for user {UserId} ({Code}).", uid, e.Code);
            return Problem(statusCode: 503, title: "Chưa tải được bản ghi. Vui lòng thử lại sau.");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { return StatusCode(499); }
        catch (Exception e) when (e is SqlException or DbUpdateException or IOException or OperationCanceledException)
        {
            logger.LogError(e, "Speaking request failed for user {UserId}.", uid);
            return Problem(statusCode: 503, title: "Chưa thể xử lý bài nói. Vui lòng thử lại sau.");
        }
    }
}
