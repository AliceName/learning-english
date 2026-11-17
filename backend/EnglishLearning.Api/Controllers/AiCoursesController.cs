using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.Json;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services.AiCourses;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Controllers;

[ApiController, Authorize, Route("api/v1/ai-course-generations")]
public sealed class AiCoursesController(EnglishLearningDbContext db, AiCourseStore store,
    AiCourseService service, GeminiCourseClient gemini, ILogger<AiCoursesController> logger) : ControllerBase
{
    [HttpGet("options")]
    public Task<IActionResult> Options(CancellationToken ct) => ExecuteAsync(user => Task.FromResult<IActionResult>(Ok(new {
        configured = gemini.Configured, model = gemini.Model, ttsModel = gemini.TtsModel,
        voices = new[] { "Kore", "Puck", "Aoede", "Charon" }, coverImageUrl = AiCourseService.CoverUrl,
        maxLessonsPerSkill = 3, maxLessons = 15, maxFileBytes = AiCourseSource.MaxBytes, skills = AiCourseContent.Skills
    })), ct);

    [HttpGet]
    public Task<IActionResult> List(CancellationToken ct) => ExecuteAsync(async user => {
        using var gate = await store.LockAsync(ct);
        return Ok(new { items = store.Jobs().Where(job => job.UserId == user.UserId)
            .OrderByDescending(job => job.CreatedAt).Take(30).Select(PublicJob) });
    }, ct);

    [HttpGet("{id:guid}")]
    public Task<IActionResult> Get(Guid id, CancellationToken ct) => ExecuteAsync(async user =>
        Ok(PublicJob(await store.RequireJobAsync(id, user.UserId, ct))), ct);

    [HttpPost, Consumes("multipart/form-data")]
    [RequestSizeLimit(AiCourseSource.MaxBytes + 65536), RequestFormLimits(MultipartBodyLengthLimit = AiCourseSource.MaxBytes + 65536)]
    public Task<IActionResult> Create(IFormFile? file, [FromForm] string config, CancellationToken ct) =>
        ExecuteAsync(async user => {
            if (file is null || !Guid.TryParse(Request.Headers["Idempotency-Key"], out var id) || id == Guid.Empty)
                throw new AiCourseException(400, "invalid_request", "Chọn tài liệu và gửi mã yêu cầu hợp lệ.");
            AiCourseConfig? value;
            try { value = JsonSerializer.Deserialize<AiCourseConfig>(config, AiCourseStore.Json); }
            catch (JsonException) { throw new AiCourseException(400, "invalid_config", "Cấu hình tạo khóa chưa hợp lệ."); }
            if (value is null) throw new AiCourseException(400, "invalid_config", "Cấu hình tạo khóa chưa hợp lệ.");
            return StatusCode(202, PublicJob(await service.CreateAsync(user.UserId, id, file, value, ct)));
        }, ct);

    [HttpPut("{id:guid}/outline"), RequestSizeLimit(65536)]
    public Task<IActionResult> Outline(Guid id, AiOutlineUpdate input, CancellationToken ct) =>
        ExecuteAsync(async user => Ok(PublicJob(await service.UpdateOutlineAsync(id, user.UserId, input, ct))), ct);

    [HttpPost("{id:guid}/generate")]
    public Task<IActionResult> Generate(Guid id, AiCourseRevision input, CancellationToken ct) =>
        ExecuteAsync(async user => StatusCode(202, PublicJob(await service.GenerateAsync(id, user.UserId, input.Revision, ct))), ct);

    [HttpPost("{id:guid}/retry")]
    public Task<IActionResult> Retry(Guid id, CancellationToken ct) =>
        ExecuteAsync(async user => StatusCode(202, PublicJob(await service.RetryAsync(id, user.UserId, ct))), ct);

    [HttpPost("{id:guid}/activate")]
    public Task<IActionResult> Activate(Guid id, AiCourseActivate input, CancellationToken ct) =>
        ExecuteAsync(async user => Ok(PublicJob(await service.ActivateAsync(id, user.UserId, input.Revision, ct))), ct);

    [HttpGet("{id:guid}/audio/{lessonId:guid}")]
    public Task<IActionResult> Audio(Guid id, Guid lessonId, CancellationToken ct) => ExecuteAsync(async user => {
        var job = await store.RequireJobAsync(id, user.UserId, ct);
        var lesson = job.Outline?.Lessons.SingleOrDefault(item => item.Id == lessonId);
        var path = Path.Combine(store.JobDirectory(id), lessonId.ToString("N") + ".wav");
        if (lesson?.AudioFileName is null || !System.IO.File.Exists(path)) return NotFound();
        return PhysicalFile(path, "audio/wav", enableRangeProcessing: true);
    }, ct);

    [HttpGet("{id:guid}/source")]
    public Task<IActionResult> Source(Guid id, CancellationToken ct) => ExecuteAsync(async user => {
        var job = await store.RequireJobAsync(id, user.UserId, ct);
        return PhysicalFile(Path.Combine(store.JobDirectory(id), "source." + job.FileType),
            job.FileType == "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            job.OriginalFileName);
    }, ct);

    private object PublicJob(AiCourseJob job) => new {
        job.Id, job.Status, fileName = job.OriginalFileName, job.Config, job.CreatedAt, job.UpdatedAt,
        job.OutlineRevision, job.CourseId, courseUrl = job.CourseId is int id ? "/courses/" + id : null,
        coverImageUrl = AiCourseService.CoverUrl,
        completedLessons = job.Outline?.Lessons.Count(lesson => lesson.IsComplete) ?? 0,
        totalLessons = job.Outline?.Lessons.Length ?? job.Config.TotalLessons,
        job.NextAttemptAt, error = job.Error is not null ? new { code = job.ErrorCode, message = job.Error } : null,
        outline = job.Outline is null ? null : new {
            job.Outline.Summary, job.Outline.Title, job.Outline.Description,
            lessons = job.Outline.Lessons.Select(lesson => new {
                lesson.Id, lesson.Title, lesson.Objective, lesson.SkillType, lesson.Listening, lesson.Speaking,
                lesson.Reading, lesson.Writing, lesson.Grammar, lesson.AudioSeconds,
                audioUrl = lesson.AudioFileName is not null ? $"/api/ai-courses/{job.Id}/audio/{lesson.Id}" : null
            })
        }
    };

    private async Task<IActionResult> ExecuteAsync(Func<User, Task<IActionResult>> action, CancellationToken ct)
    {
        Response.Headers.CacheControl = "private, no-store";
        if (!int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var userId)) return Unauthorized();
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(item => item.UserId == userId && item.IsActive, ct);
        if (user is null) return Unauthorized();
        try { return await action(user); }
        catch (AiCourseException error)
        {
            if (error.RetryAfter is int seconds) Response.Headers.RetryAfter = seconds.ToString();
            return Problem(statusCode: error.Status, title: error.Message, extensions: new Dictionary<string, object?> { ["code"] = error.Code });
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { return StatusCode(499); }
        catch (Exception error) when (error is IOException or DbUpdateException or Microsoft.Data.SqlClient.SqlException)
        {
            logger.LogError(error, "AI course storage request failed.");
            return Problem(statusCode: 503, title: "Chưa kết nối được dữ liệu tạo khóa học. Hãy thử lại.");
        }
    }
}
