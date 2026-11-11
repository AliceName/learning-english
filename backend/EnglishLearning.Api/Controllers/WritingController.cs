using System.IdentityModel.Tokens.Jwt;
using System.Collections.Concurrent;
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

[ApiController]
[Authorize]
[Route("api/v1/writing/submissions")]
[Tags("Writing")]
public sealed class WritingController(EnglishLearningDbContext db, WritingAiClient ai, WritingTaskLibrary tasks,
    ILogger<WritingController> logger) : ControllerBase
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly ConcurrentDictionary<(int UserId, int SubmissionId), byte> FeedbackRequests = new();

    [HttpPost]
    [RequestSizeLimit(65536)]
    public Task<ActionResult<WritingSubmissionResponse>> Submit(SubmitWritingRequest request, CancellationToken cancellationToken) =>
        WithUser<WritingSubmissionResponse>(async userId =>
        {
            WritingTaskSnapshot? task = null;
            var topic = string.IsNullOrWhiteSpace(request.Topic) ? null : request.Topic.Trim();
            var practice = new WritingPractice(null, null);
            if (request.ParentSubmissionId is { } parentId)
            {
                var parent = await db.WritingSubmissions.AsNoTracking().SingleOrDefaultAsync(
                    s => s.SubmissionId == parentId && s.UserId == userId, cancellationToken);
                if (parent is null) return NotFound();
                var previous = ReadAnalysis(parent);
                task = previous.Task;
                if ((request.TaskId is not null && request.TaskId != task?.Id)
                    || (request.TaskVersion is not null && request.TaskVersion != task?.Version)
                    || (topic is not null && topic != parent.Topic))
                    return BadRequest(new { detail = "Đổi đề cần bắt đầu lượt luyện mới." });
                topic = parent.Topic;
                practice = new(previous.Practice?.RootSubmissionId ?? parent.SubmissionId, parent.SubmissionId);
            }
            else if (request.TaskId is not null)
            {
                if (topic is not null) return BadRequest(new { detail = "Chọn đề thư viện hoặc nhập đề riêng." });
                try { task = tasks.Load().Items.SingleOrDefault(t => t.Id == request.TaskId); }
                catch (Exception e) when (e is IOException or InvalidDataException or InvalidOperationException or JsonException)
                { return Problem(statusCode: 503, detail: "Chưa tải được thư viện. Bản nháp vẫn được giữ."); }
                if (task is null) return BadRequest(new { detail = "Đề không tồn tại trong thư viện khả dụng." });
                if (task.Version != request.TaskVersion) return Problem(statusCode: 409,
                    detail: "Đề đã đổi phiên bản. Hãy tải lại thư viện; bản nháp vẫn được giữ.");
                topic = task.Title;
            }
            else if (request.TaskVersion is not null)
                return BadRequest(new { detail = "Thiếu mã đề thư viện." });
            // Task/practice metadata is authoritative server state, never model output.
            var analysis = (await ai.AnalyzeAsync(request, cancellationToken)) with { Task = task, Practice = practice };
            var submission = new WritingSubmission
            {
                UserId = userId, Topic = topic,
                OriginalText = request.OriginalText, CefrLevel = analysis.Cefr, CorrectedText = analysis.CorrectedText,
                ErrorsJson = JsonSerializer.Serialize(analysis, JsonOptions)
                // Structured feedback lives in ErrorsJson; Score and the legacy Feedback column stay null.
            };
            db.WritingSubmissions.Add(submission);
            await db.SaveChangesAsync(cancellationToken);
            return CreatedAtAction(nameof(Get), new { submissionId = submission.SubmissionId }, ToResponse(submission, analysis));
        }, cancellationToken);

    [HttpPost("{submissionId:int:min(1)}/feedback")]
    [RequestSizeLimit(1024)]
    public Task<ActionResult<WritingSubmissionResponse>> Feedback(int submissionId, CancellationToken cancellationToken) =>
        WithUser<WritingSubmissionResponse>(async userId =>
        {
            if (Request.ContentLength is > 0 || Request.Headers.ContainsKey("Transfer-Encoding"))
                return BadRequest(new { detail = "Nhận xét sử dụng nội dung bài đã lưu; không gửi thêm nội dung bài viết." });
            if (!FeedbackRequests.TryAdd((userId, submissionId), 0))
                return Problem(statusCode: 429, title: "Phần nhận xét đang xử lý.", detail: "Hãy chờ yêu cầu hiện tại hoàn tất rồi thử lại.");
            try
            {
                var item = await db.WritingSubmissions.AsNoTracking().SingleOrDefaultAsync(
                    s => s.SubmissionId == submissionId && s.UserId == userId, cancellationToken);
                if (item is null) return NotFound();
                var analysis = ReadAnalysis(item);
                if (analysis.Feedback?.Status == "ready") return Ok(ToResponse(item, analysis));
                var snapshot = item.ErrorsJson;
                var feedback = await ai.FeedbackAsync(item.OriginalText, analysis.Task?.Prompt ?? item.Topic, analysis.Errors, cancellationToken);
                var updated = analysis with { Feedback = feedback };
                var updatedJson = JsonSerializer.Serialize(updated, JsonOptions);
                var now = DateTime.UtcNow;
                // Compare-and-set also protects against another API process replacing a newer analysis.
                var saved = await db.WritingSubmissions.Where(s => s.SubmissionId == submissionId && s.UserId == userId
                        && EF.Functions.Collate(s.OriginalText, "Latin1_General_100_BIN2") == item.OriginalText
                        && EF.Functions.Collate(s.ErrorsJson!, "Latin1_General_100_BIN2") == snapshot)
                    .ExecuteUpdateAsync(setters => setters.SetProperty(s => s.ErrorsJson, updatedJson)
                        .SetProperty(s => s.UpdatedAt, now), cancellationToken);
                if (saved == 0)
                {
                    var current = await db.WritingSubmissions.AsNoTracking().SingleOrDefaultAsync(
                        s => s.SubmissionId == submissionId && s.UserId == userId, cancellationToken);
                    if (current is null) return NotFound();
                    var currentAnalysis = ReadAnalysis(current);
                    if (currentAnalysis.Feedback?.Status == "ready") return Ok(ToResponse(current, currentAnalysis));
                    return Problem(statusCode: 409, title: "Bài viết đã được cập nhật.", detail: "Tải lại bài đã lưu trước khi yêu cầu nhận xét.");
                }
                item.ErrorsJson = updatedJson;
                item.UpdatedAt = now;
                return Ok(ToResponse(item, updated));
            }
            finally { FeedbackRequests.TryRemove((userId, submissionId), out _); }
        }, cancellationToken);

    [HttpGet("{submissionId:int:min(1)}")]
    public Task<ActionResult<WritingSubmissionResponse>> Get(int submissionId, CancellationToken cancellationToken) =>
        WithUser<WritingSubmissionResponse>(async userId =>
        {
            var item = await db.WritingSubmissions.AsNoTracking()
                .SingleOrDefaultAsync(s => s.SubmissionId == submissionId && s.UserId == userId, cancellationToken);
            if (item is null) return NotFound();
            var analysis = ReadAnalysis(item);
            return Ok(ToResponse(item, analysis));
        }, cancellationToken);

    [HttpGet("/api/v1/writing/capabilities")]
    public Task<ActionResult<WritingCapabilities>> Capabilities(CancellationToken cancellationToken) =>
        WithUser<WritingCapabilities>(async _ => Ok(await ai.CapabilitiesAsync(cancellationToken)), cancellationToken);

    [HttpPost("/api/v1/writing/preflight")]
    [RequestSizeLimit(65536)]
    public Task<ActionResult<WritingPreflight>> Preflight(WritingPreflightRequest request, CancellationToken cancellationToken) =>
        WithUser<WritingPreflight>(async _ => Ok(await ai.PreflightAsync(request, cancellationToken)), cancellationToken);

    [HttpGet]
    public Task<ActionResult<WritingHistory>> History([FromQuery] int? beforeId = null, [FromQuery] int limit = 10,
        [FromQuery] int? practiceRootId = null,
        CancellationToken cancellationToken = default) =>
        WithUser<WritingHistory>(async userId =>
        {
            if (beforeId is <= 0 || practiceRootId is <= 0 || limit is < 1 or > 20)
                return BadRequest(new { detail = "Tham số lịch sử bài viết không hợp lệ." });
            var query = db.WritingSubmissions.AsNoTracking().Where(item => item.UserId == userId);
            if (practiceRootId is { } root)
            {
                if (!await db.WritingSubmissions.AnyAsync(s => s.SubmissionId == root && s.UserId == userId, cancellationToken))
                    return NotFound();
                query = db.WritingSubmissions.FromSqlInterpolated($"""
                    SELECT * FROM dbo.WritingSubmissions WHERE UserId = {userId}
                    AND COALESCE(TRY_CONVERT(int, JSON_VALUE(CASE WHEN ISJSON(ErrorsJson)=1 THEN ErrorsJson ELSE N'[]' END,
                        '$.practice.rootSubmissionId')), SubmissionId) = {root}
                    """).AsNoTracking();
            }
            if (beforeId.HasValue) query = query.Where(item => item.SubmissionId < beforeId.Value);
            var items = await query.OrderByDescending(item => item.SubmissionId).Take(limit + 1)
                .Select(item => new { item.SubmissionId, item.Topic, item.CefrLevel, item.CreatedAt, item.OriginalText })
                .ToListAsync(cancellationToken);
            var page = items.Take(limit).Select(item => new WritingHistoryItem(item.SubmissionId,
                item.Topic, item.CefrLevel ?? "", item.CreatedAt, HistoryPreview(item.OriginalText))).ToArray();
            return Ok(new WritingHistory(page, items.Count > limit ? page[^1].SubmissionId : null));
        }, cancellationToken);

    [HttpGet("/api/v1/writing/practices")]
    public Task<ActionResult<WritingPractices>> Practices([FromQuery] int? beforeId = null, [FromQuery] int limit = 10,
        CancellationToken cancellationToken = default) => WithUser<WritingPractices>(async userId =>
    {
        if (beforeId is <= 0 || limit is < 1 or > 20) return BadRequest();
        // shortcut: JSON grouping scans this learner's rows; revisit with an approved index at larger scale.
        var rows = await db.Database.SqlQuery<WritingPracticeItem>($"""
            SELECT g.PracticeRootId, g.LatestSubmissionId, g.SubmissionCount, w.Topic,
                COALESCE(w.CefrLevel,N'') AS CefrLevel, w.CreatedAt
            FROM (SELECT COALESCE(TRY_CONVERT(int, JSON_VALUE(CASE WHEN ISJSON(ErrorsJson)=1 THEN ErrorsJson ELSE N'[]' END,
                    '$.practice.rootSubmissionId')), SubmissionId) AS PracticeRootId,
                MAX(SubmissionId) AS LatestSubmissionId, COUNT(*) AS SubmissionCount
                FROM dbo.WritingSubmissions WHERE UserId = {userId}
                GROUP BY COALESCE(TRY_CONVERT(int, JSON_VALUE(CASE WHEN ISJSON(ErrorsJson)=1 THEN ErrorsJson ELSE N'[]' END,
                    '$.practice.rootSubmissionId')), SubmissionId)) g
            JOIN dbo.WritingSubmissions w ON w.SubmissionId = g.LatestSubmissionId AND w.UserId = {userId}
            WHERE g.LatestSubmissionId < {beforeId ?? int.MaxValue}
            ORDER BY g.LatestSubmissionId DESC OFFSET 0 ROWS FETCH NEXT {limit + 1} ROWS ONLY
            """).ToListAsync(cancellationToken);
        var page = rows.Take(limit).ToArray();
        return Ok(new WritingPractices(page, rows.Count > limit ? page[^1].LatestSubmissionId : null));
    }, cancellationToken);

    private static string HistoryPreview(string text)
    {
        var length = Math.Min(160, text.Length);
        if (length < text.Length && char.IsHighSurrogate(text[length - 1])) length--;
        return text[..length];
    }

    private static WritingAnalysis ReadAnalysis(WritingSubmission item) =>
        (string.IsNullOrWhiteSpace(item.ErrorsJson) ? null
            : JsonSerializer.Deserialize<WritingAnalysis>(item.ErrorsJson, JsonOptions))
        ?? new(item.CefrLevel ?? "", item.CorrectedText, [], []);

    private static WritingSubmissionResponse ToResponse(WritingSubmission item, WritingAnalysis? analysis) =>
        new(item.SubmissionId, item.Topic, item.OriginalText, item.CefrLevel ?? "", item.CorrectedText,
            analysis?.Errors ?? [], analysis?.Warnings ?? [], item.CreatedAt, analysis?.Provenance, analysis?.Feedback,
            analysis?.GecCoverage, analysis?.Task, analysis?.Practice?.RootSubmissionId ?? item.SubmissionId,
            analysis?.Practice?.ParentSubmissionId);

    private async Task<ActionResult<T>> WithUser<T>(
        Func<int, Task<ActionResult<T>>> action, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        if (!int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var userId) || userId <= 0)
            return Unauthorized();
        try
        {
            if (!await db.Users.AnyAsync(u => u.UserId == userId && u.IsActive, cancellationToken))
                return Unauthorized();
            return await action(userId);
        }
        catch (WritingAiException error)
        {
            return Problem(statusCode: error.StatusCode, title: "Chưa thể chấm bài.", detail: error.Message);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return StatusCode(StatusCodes.Status499ClientClosedRequest);
        }
        catch (Exception error) when (error is SqlException or DbUpdateException or HttpRequestException or OperationCanceledException or JsonException)
        {
            logger.LogWarning("Writing request failed: {ErrorType}", error.GetType().Name);
            return Problem(statusCode: 503, title: "Chưa thể chấm bài.", detail: "AI hoặc cơ sở dữ liệu chưa sẵn sàng. Vui lòng thử lại sau.");
        }
    }
}
