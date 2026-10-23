using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Controllers;

[ApiController, Authorize, Route("api/v1"), Tags("Course media")]
public sealed class MediaController(MediaStorage storage, EnglishLearningDbContext db, ILogger<MediaController> logger) : ControllerBase
{
    [Authorize(Roles = UserRoles.Admin), HttpPost("admin/uploads"), RequestSizeLimit(27 * 1024 * 1024)]
    public async Task<IActionResult> Upload(IFormFile file, [FromForm] string kind, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        try
        {
            var user = await CurrentUserAsync(ct);
            if (user is null) return Unauthorized();
            if (user.Role != UserRoles.Admin) return Forbid();
            var saved = await storage.SaveAsync(file, kind, ct);
            return Ok(new UploadedMediaResponse("/api/media/" + saved.FileName, file.FileName, file.Length, saved.ContentType));
        }
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
            var path = storage.Resolve(fileName);
            if (path is null || !System.IO.File.Exists(path)) return NotFound();
            var url = "/api/media/" + fileName;
            if (user.Role != UserRoles.Admin)
            {
                var visible = db.Courses.Where(course => course.IsPublished && (course.SourceType == "system" || course.CreatedBy == user.UserId));
                var canRead = await visible.AnyAsync(course => course.CoverImageUrl == url || db.Lessons.Any(lesson => lesson.CourseId == course.CourseId && lesson.IsActive &&
                    (lesson.AudioUrl == url || lesson.Content != null && lesson.Content.Contains(url))), ct);
                if (!canRead) return NotFound();
            }
            Response.Headers.XContentTypeOptions = "nosniff";
            return PhysicalFile(path, MediaStorage.ContentType(fileName)!, enableRangeProcessing: true);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { return StatusCode(499); }
        catch (Exception error) when (error is SqlException or IOException or OperationCanceledException)
        {
            logger.LogError(error, "Course media read failed.");
            return Problem(statusCode: 503, title: "Chưa thể tải tệp.");
        }
    }
    private async Task<Entities.User?> CurrentUserAsync(CancellationToken ct) =>
        int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var id)
            ? await db.Users.AsNoTracking().SingleOrDefaultAsync(user => user.UserId == id && user.IsActive, ct) : null;
}
