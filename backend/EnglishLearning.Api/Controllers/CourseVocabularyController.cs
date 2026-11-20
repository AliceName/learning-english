using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Controllers;

[ApiController, Authorize, Route("api/v1/courses/{courseId:int:min(1)}/vocabulary"), RequestSizeLimit(16 * 1024)]
public sealed class CourseVocabularyController(EnglishLearningDbContext db, CourseVocabularyService vocabulary,
    ILogger<CourseVocabularyController> logger) : ControllerBase
{
    [HttpGet]
    public Task<IActionResult> Get(int courseId, CancellationToken ct) => Execute(user => vocabulary.GetAsync(user, courseId, ct), ct);
    [HttpPost("{lessonId:int:min(1)}/copy")]
    public Task<IActionResult> Copy(int courseId, int lessonId, CopyReadingVocabularyRequest request, CancellationToken ct) =>
        Execute(user => vocabulary.CopyReadingAsync(user, courseId, lessonId, request, ct), ct, 201);

    private async Task<IActionResult> Execute<T>(Func<int, Task<T>> action, CancellationToken ct, int status = 200)
    {
        Response.Headers.CacheControl = "private, no-store";
        if (!int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var user)) return Unauthorized();
        try {
            if (!await db.Users.AnyAsync(item => item.UserId == user && item.IsActive, ct)) return Unauthorized();
            return StatusCode(status, await action(user));
        }
        catch (CourseTextLessonException error) { return Problem(statusCode: error.Status, title: error.Message); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { return StatusCode(499); }
        catch (Exception error) when (error is DbUpdateException or Microsoft.Data.SqlClient.SqlException or OperationCanceledException) {
            logger.LogError(error, "Course vocabulary request failed.");
            return Problem(statusCode: 503, title: "Chưa xử lý được bộ thẻ khóa học. Hãy tải lại để kiểm tra trước khi thử lại.");
        }
    }
}
