using System.IdentityModel.Tokens.Jwt;
using System.Collections.Concurrent;
using System.Security.Claims;
using System.Security.Cryptography;
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
    private static readonly SemaphoreSlim NonSqlSubmissionLock = new(1);

    [HttpPost]
    [RequestSizeLimit(65536)]
    public Task<ActionResult<WritingSubmissionResponse>> Submit(SubmitWritingRequest request, CancellationToken cancellationToken) =>
        WithUser<WritingSubmissionResponse>(async userId =>
        {
            if (request.RequestId == Guid.Empty) return BadRequest(new { detail = "Mã yêu cầu nộp bài không hợp lệ." });
            var requestId = request.RequestId?.ToString("D");
            var requestHash = requestId is null ? null : RequestHash(request);
            if (requestId is not null && await FindRequest(userId, requestId, cancellationToken) is { } replay)
                return ReplayResponse(replay, request, requestHash);

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
                if (practice.RootSubmissionId is <= 0 || practice.RootSubmissionId > parentId || (practice.RootSubmissionId != parentId &&
                    await VersionRank(userId, practice.RootSubmissionId!.Value, practice.RootSubmissionId.Value, cancellationToken) != 1))
                    return Conflict(new { detail = "Không xác định được lịch sử của phiên bản nguồn." });
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
            var analysis = await ai.AnalyzeAsync(request, cancellationToken);
            var sqlServer = db.Database.IsSqlServer();
            if (!sqlServer) await NonSqlSubmissionLock.WaitAsync(cancellationToken);
            try
            {
                await using var transaction = sqlServer && db.Database.CurrentTransaction is null
                    ? await db.Database.BeginTransactionAsync(cancellationToken) : null;
                if (sqlServer)
                {
                    // Both the request key and the version number are allocated under the same owner lock.
                    var resource = $"writing-submit:{userId}";
                    await db.Database.ExecuteSqlInterpolatedAsync($"""
                        DECLARE @status int;
                        EXEC @status = sys.sp_getapplock @Resource = {resource}, @LockMode = 'Exclusive',
                            @LockOwner = 'Transaction', @LockTimeout = 5000;
                        IF @status < 0 THROW 51000, 'Writing submission lock unavailable.', 1;
                        """, cancellationToken);
                }
                if (requestId is not null && await FindRequest(userId, requestId, cancellationToken) is { } duplicate)
                    return ReplayResponse(duplicate, request, requestHash);
                var target = await db.Users.Where(user => user.UserId == userId)
                    .Select(user => user.TargetLevel).SingleAsync(cancellationToken);
                var version = 1;
                int? parentVersion = null;
                if (practice.RootSubmissionId is { } root && practice.ParentSubmissionId is { } source)
                {
                    version = checked(1 + await VersionRank(userId, root, int.MaxValue, cancellationToken));
                    parentVersion = await VersionRank(userId, root, source, cancellationToken);
                }
                analysis = analysis with { Task = task, Practice = practice with
                    { VersionNumber = version, ParentVersionNumber = parentVersion, TargetCefr = target, RequestId = requestId, RequestHash = requestHash } };
                var submission = new WritingSubmission
                {
                    UserId = userId, Topic = topic,
                    OriginalText = request.OriginalText, CefrLevel = analysis.Cefr, CorrectedText = analysis.CorrectedText,
                    ErrorsJson = JsonSerializer.Serialize(analysis, JsonOptions)
                };
                db.WritingSubmissions.Add(submission);
                await db.SaveChangesAsync(cancellationToken);
                if (transaction is not null) await transaction.CommitAsync(cancellationToken);
                return CreatedAtAction(nameof(Get), new { submissionId = submission.SubmissionId }, ToResponse(submission, analysis));
            }
            finally { if (!sqlServer) NonSqlSubmissionLock.Release(); }
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
                if (analysis.Feedback?.Status == "ready") return Ok(await ReadResponse(item, analysis, cancellationToken));
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
                    if (currentAnalysis.Feedback?.Status == "ready") return Ok(await ReadResponse(current, currentAnalysis, cancellationToken));
                    return Problem(statusCode: 409, title: "Bài viết đã được cập nhật.", detail: "Tải lại bài đã lưu trước khi yêu cầu nhận xét.");
                }
                item.ErrorsJson = updatedJson;
                item.UpdatedAt = now;
                return Ok(await ReadResponse(item, updated, cancellationToken));
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
            return Ok(await ReadResponse(item, ReadAnalysis(item), cancellationToken));
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
                if (db.Database.IsSqlServer()) query = PracticeRows(userId, root);
            }
            if (beforeId.HasValue) query = query.Where(item => item.SubmissionId < beforeId.Value);
            var ordered = query.OrderByDescending(item => item.SubmissionId);
            var items = practiceRootId.HasValue && !db.Database.IsSqlServer()
                ? (await ordered.ToListAsync(cancellationToken)).Where(row => PracticeRoot(row) == practiceRootId).Take(limit + 1).ToList()
                : await ordered.Take(limit + 1).ToListAsync(cancellationToken);
            var page = new List<WritingHistoryItem>(limit);
            var newest = items.FirstOrDefault()?.SubmissionId;
            var rank = practiceRootId.HasValue && newest.HasValue
                ? await VersionRank(userId, practiceRootId.Value, newest.Value, cancellationToken) : (int?)null;
            foreach (var item in items.Take(limit))
            {
                var stored = HistoryPractice(item);
                var source = stored?.ParentSubmissionId;
                var parentVersion = stored?.ParentVersionNumber;
                if (parentVersion is null && source is { } sourceId && practiceRootId is { } rootId)
                {
                    parentVersion = await ReadParentVersion(userId, rootId, sourceId, cancellationToken);
                }
                page.Add(new(item.SubmissionId, item.Topic, item.CefrLevel ?? "", item.CreatedAt,
                    HistoryPreview(item.OriginalText), stored?.VersionNumber ?? rank, source,
                    parentVersion, stored?.TargetCefr, stored?.VersionNumber is not null));
                rank--;
            }
            return Ok(new WritingHistory(page.ToArray(), items.Count > limit ? page[^1].SubmissionId : null));
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

    internal static WritingAnalysis ReadAnalysis(WritingSubmission item)
    {
        if (!string.IsNullOrWhiteSpace(item.ErrorsJson))
        {
            // Earlier imports could store the suggestion array directly.
            if (item.ErrorsJson.AsSpan().TrimStart().StartsWith("[", StringComparison.Ordinal))
                return new(item.CefrLevel ?? "", item.CorrectedText,
                    JsonSerializer.Deserialize<WritingSuggestion[]>(item.ErrorsJson, JsonOptions) ?? [], []);
            if (JsonSerializer.Deserialize<WritingAnalysis>(item.ErrorsJson, JsonOptions) is { } analysis)
                return analysis with { Errors = analysis.Errors ?? [], Warnings = analysis.Warnings ?? [] };
        }
        return new(item.CefrLevel ?? "", item.CorrectedText, [], []);
    }

    private static WritingPractice? HistoryPractice(WritingSubmission row)
    {
        try { return ReadAnalysis(row).Practice; }
        catch (JsonException) { return null; }
    }

    private IQueryable<WritingSubmission> PracticeRows(int userId, int root) =>
        db.WritingSubmissions.FromSqlInterpolated($"""
            SELECT * FROM dbo.WritingSubmissions WHERE UserId = {userId}
            AND COALESCE(TRY_CONVERT(int, JSON_VALUE(CASE WHEN ISJSON(ErrorsJson)=1 THEN ErrorsJson ELSE N'[]' END,
                '$.practice.rootSubmissionId')), SubmissionId) = {root}
            """).AsNoTracking();

    private static int PracticeRoot(WritingSubmission row) => HistoryPractice(row)?.RootSubmissionId ?? row.SubmissionId;

    private async Task<WritingSubmission?> FindRequest(int userId, string requestId, CancellationToken cancellationToken)
    {
        if (db.Database.IsSqlServer())
            return await db.WritingSubmissions.FromSqlInterpolated($"""
                SELECT * FROM dbo.WritingSubmissions WHERE UserId = {userId}
                AND JSON_VALUE(CASE WHEN ISJSON(ErrorsJson)=1 THEN ErrorsJson ELSE N'[]' END, '$.practice.requestId') = {requestId}
                """).AsNoTracking().SingleOrDefaultAsync(cancellationToken);
        var rows = await db.WritingSubmissions.AsNoTracking().Where(row => row.UserId == userId).ToListAsync(cancellationToken);
        return rows.SingleOrDefault(row => ReadAnalysis(row).Practice?.RequestId == requestId);
    }

    private async Task<int> VersionRank(int userId, int root, int maximumId, CancellationToken cancellationToken)
    {
        if (db.Database.IsSqlServer())
            return await PracticeRows(userId, root).CountAsync(row => row.SubmissionId <= maximumId, cancellationToken);
        var rows = await db.WritingSubmissions.AsNoTracking().Where(row => row.UserId == userId && row.SubmissionId <= maximumId)
            .ToListAsync(cancellationToken);
        return rows.Count(row => PracticeRoot(row) == root);
    }

    private async Task<int?> ReadParentVersion(int userId, int root, int sourceId, CancellationToken cancellationToken)
    {
        var source = await db.WritingSubmissions.AsNoTracking().SingleOrDefaultAsync(
            row => row.UserId == userId && row.SubmissionId == sourceId, cancellationToken);
        return source is not null && PracticeRoot(source) == root
            ? await VersionRank(userId, root, sourceId, cancellationToken) : null;
    }

    private async Task<WritingSubmissionResponse> ReadResponse(WritingSubmission item, WritingAnalysis analysis, CancellationToken cancellationToken)
    {
        if (analysis.Practice?.VersionNumber is not null) return ToResponse(item, analysis);
        var stored = analysis.Practice ?? new WritingPractice(null, null);
        var root = stored.RootSubmissionId ?? item.SubmissionId;
        var number = await VersionRank(item.UserId, root, item.SubmissionId, cancellationToken);
        var parentVersion = stored.ParentSubmissionId is { } source
            ? await ReadParentVersion(item.UserId, root, source, cancellationToken) : null;
        return ToResponse(item, analysis with { Practice = stored with { VersionNumber = number, ParentVersionNumber = parentVersion } }, false);
    }

    private static string RequestHash(SubmitWritingRequest request, bool legacy = false, string? target = null, bool specified = false)
    {
        object payload = legacy
            ? new { request.ParentSubmissionId, request.Topic, request.TaskId, request.TaskVersion, request.OriginalText,
                request.Corrections, TargetCefr = target, TargetSpecified = specified }
            : new { request.ParentSubmissionId, request.Topic, request.TaskId, request.TaskVersion, request.OriginalText,
                request.Corrections };
        return Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(payload, JsonOptions)));
    }

    private ActionResult<WritingSubmissionResponse> ReplayResponse(WritingSubmission item, SubmitWritingRequest request, string? requestHash)
    {
        var analysis = ReadAnalysis(item);
        var savedHash = analysis.Practice?.RequestHash;
        // Old retry keys included the removed target field even when it was omitted.
        if (savedHash != requestHash && savedHash != RequestHash(request, legacy: true)
            && savedHash != RequestHash(request, legacy: true, target: analysis.Practice?.TargetCefr, specified: true))
            return Conflict(new { detail = "Mã yêu cầu đã được dùng cho nội dung nộp khác." });
        return Ok(ToResponse(item, analysis));
    }

    private static WritingSubmissionResponse ToResponse(WritingSubmission item, WritingAnalysis? analysis, bool? targetRecorded = null) =>
        new(item.SubmissionId, item.Topic, item.OriginalText, item.CefrLevel ?? "", item.CorrectedText,
            analysis?.Errors ?? [], analysis?.Warnings ?? [], item.CreatedAt, analysis?.Provenance, analysis?.Feedback,
            analysis?.GecCoverage, analysis?.Task, analysis?.Practice?.RootSubmissionId ?? item.SubmissionId,
            analysis?.Practice?.ParentSubmissionId, analysis?.Practice?.VersionNumber, analysis?.Practice?.ParentVersionNumber,
            analysis?.Practice?.TargetCefr, targetRecorded ?? (analysis?.Practice?.VersionNumber is not null));

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
