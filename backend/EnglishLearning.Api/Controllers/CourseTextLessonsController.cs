using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Controllers;

[ApiController, Authorize, Route("api/v1/courses/{courseId:int:min(1)}/lessons/{lessonId:int:min(1)}"), RequestSizeLimit(128 * 1024)]
public sealed class CourseTextLessonsController(EnglishLearningDbContext db, CourseTextLessonService lessons,
    ILogger<CourseTextLessonsController> logger) : ControllerBase
{
    [HttpGet("reading")]
    public Task<IActionResult> Reading(int courseId, int lessonId, CancellationToken ct) =>
        ExecuteAsync(async user => Ok(await lessons.ReadingAsync(user, courseId, lessonId, ct)), ct);
    [HttpPost("reading/submissions"), LearningActivity(LearningKind.Reading)]
    public Task<IActionResult> ReadingSubmit(int courseId, int lessonId, ListeningSubmissionRequest input, CancellationToken ct) =>
        ExecuteAsync(async user => Ok(await lessons.SubmitReadingAsync(user, courseId, lessonId, input, ct)), ct);
    [HttpGet("writing")]
    public Task<IActionResult> Writing(int courseId, int lessonId, CancellationToken ct) =>
        ExecuteAsync(async user => Ok(await lessons.WritingAsync(user, courseId, lessonId, ct)), ct);
    [HttpPost("writing/submissions"), LearningActivity(LearningKind.Writing)]
    public Task<IActionResult> WritingSubmit(int courseId, int lessonId, CourseWritingRequest input, CancellationToken ct) =>
        ExecuteAsync(async user => Ok(await lessons.SubmitWritingAsync(user, courseId, lessonId, input, ct)), ct);
    private async Task<IActionResult> ExecuteAsync(Func<int, Task<IActionResult>> action, CancellationToken ct)
    {
        Response.Headers.CacheControl = "private, no-store";
        if (!int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var user)) return Unauthorized();
        try {
            if (!await db.Users.AnyAsync(item => item.UserId == user && item.IsActive, ct)) return Unauthorized();
            return await action(user);
        }
        catch (CourseTextLessonException error) { return Problem(statusCode: error.Status, title: error.Message); }
        catch (ListeningPracticeException error) { return Problem(statusCode: error.Status, title: error.Message); }
        catch (WritingAiException error) { return Problem(statusCode: error.StatusCode, title: error.Message); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { return StatusCode(499); }
        catch (Exception error) when (error is DbUpdateException or Microsoft.Data.SqlClient.SqlException or OperationCanceledException or HttpRequestException) {
            logger.LogError(error, "Course reading/writing request failed.");
            return Problem(statusCode: 503, title: "Chưa xử lý được bài học. Nội dung đang nhập vẫn được giữ để thử lại.");
        }
    }
}
