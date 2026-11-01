using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.Json;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Services;
using EnglishLearning.Api.Services.CloudinaryMedia;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Controllers;

[ApiController, Authorize, Route("api/v1"), Tags("Course media")]
public sealed class MediaController(IMediaStorage storage, EnglishLearningDbContext db, ILogger<MediaController> logger) : ControllerBase
{
    [Authorize(Roles = UserRoles.Admin), HttpPost("admin/uploads"), RequestSizeLimit(27 * 1024 * 1024)]
    [RequestFormLimits(MemoryBufferThreshold = 28 * 1024 * 1024, MultipartBodyLengthLimit = 27 * 1024 * 1024)]
    public async Task<IActionResult> Upload(IFormFile file, [FromForm] string kind, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        Response.Headers.XContentTypeOptions = "nosniff";
        try
        {
            var user = await CurrentUserAsync(ct);
            if (user is null) return Unauthorized();
            if (user.Role != UserRoles.Admin) return Forbid();
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct); deadline.CancelAfter(TimeSpan.FromSeconds(90));
            var saved = await storage.SaveAsync(file, kind, deadline.Token);
            return Ok(new UploadedMediaResponse("/api/media/" + saved.FileName, file.FileName, saved.SizeBytes, saved.ContentType));
        }
        catch (CloudMediaException error) { return CloudProblem(error); }
        catch (AuthoringException error) { return Problem(statusCode: error.Status, title: error.Message); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { return StatusCode(499); }
        catch (Exception error) when (error is SqlException or IOException or OperationCanceledException)
        {
            logger.LogError(error, "Course media upload failed.");
            return Problem(statusCode: 503, title: "Chưa thể tải tệp lên. Vui lòng thử lại.");
        }
    }

    [HttpGet("media/{fileName}")]
    public async Task<IActionResult> Get(string fileName, CancellationToken ct)
    {
        Response.Headers.CacheControl = "private, no-store";
        try
        {
            var user = await CurrentUserAsync(ct);
            if (user is null) return Unauthorized();
            if (!MediaStorage.IsManagedFileName(fileName)) return NotFound();
            var url = "/api/media/" + fileName;
            if (user.Role != UserRoles.Admin)
            {
                var visible = db.Courses.Where(course => course.IsPublished && (course.SourceType == "system" || course.CreatedBy == user.UserId));
                var canRead = await visible.AnyAsync(course => course.CoverImageUrl == url || db.Lessons.Any(lesson => lesson.CourseId == course.CourseId && lesson.IsActive && lesson.AudioUrl == url), ct);
                if (!canRead)
                {
                    var candidates = db.Lessons.AsNoTracking().Where(lesson => lesson.IsActive && lesson.SkillType == "speaking" &&
                        visible.Any(course => course.CourseId == lesson.CourseId) && lesson.Content != null && lesson.Content.Contains(url)).Select(lesson => lesson.Content);
                    await foreach (var content in candidates.AsAsyncEnumerable().WithCancellation(ct))
                    {
                        try
                        {
                            var document = JsonSerializer.Deserialize<LessonContentDocument>(content!, new JsonSerializerOptions(JsonSerializerDefaults.Web));
                            if (document is { Version: 1 } && document.Speaking?.Sentences?.Any(sentence => sentence?.AudioUrl == url) == true) { canRead = true; break; }
                        }
                        catch (JsonException) { }
                    }
                }
                if (!canRead) return NotFound();
            }
            Response.Headers.XContentTypeOptions = "nosniff";
            var read = await storage.OpenAsync(fileName, Request.Headers.Range.ToString(), ct);
            if (read is null) return NotFound();
            Response.Headers.AcceptRanges = "bytes";
            if (read.EnableRangeProcessing) return File(read.Body, read.ContentType, enableRangeProcessing: true);
            Response.StatusCode = read.Status; Response.ContentLength = read.Length;
            if (read.ContentRange is not null) Response.Headers.ContentRange = read.ContentRange;
            if (read.Status == 416) { await read.DisposeAsync(); return StatusCode(416); }
            return File(read.Body, read.ContentType, enableRangeProcessing: false);
        }
        catch (CloudMediaException error) { return CloudProblem(error); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { return StatusCode(499); }
        catch (Exception error) when (error is SqlException or IOException or OperationCanceledException)
        {
            logger.LogError(error, "Course media read failed.");
            return Problem(statusCode: 503, title: "Chưa thể tải tệp.");
        }
    }
    private IActionResult CloudProblem(CloudMediaException error)
    {
        logger.LogWarning("Course cloud media failed ({Code}).", error.Code);
        if (error.RetryAfterSeconds is int seconds) Response.Headers.RetryAfter = seconds.ToString(System.Globalization.CultureInfo.InvariantCulture);
        return Problem(statusCode: error.Status, title: "Kho media tạm thời chưa sẵn sàng. Vui lòng thử lại.", extensions: new Dictionary<string, object?> { ["code"] = error.Code });
    }
    private async Task<Entities.User?> CurrentUserAsync(CancellationToken ct) =>
        int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var id)
            ? await db.Users.AsNoTracking().SingleOrDefaultAsync(user => user.UserId == id && user.IsActive, ct) : null;
}
