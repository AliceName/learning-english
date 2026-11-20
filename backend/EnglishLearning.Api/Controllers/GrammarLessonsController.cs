using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Controllers;

[ApiController, Authorize, Route("api/v1/courses/{courseId:int:min(1)}/lessons/{lessonId:int:min(1)}/grammar")]
[Tags("Grammar practice"), RequestSizeLimit(128 * 1024)]
[Produces("application/json")]
public sealed class GrammarLessonsController(GrammarPracticeService practice, EnglishLearningDbContext db,
    ILogger<GrammarLessonsController> logger) : ControllerBase
{
    [HttpGet]
    public Task<ActionResult<GrammarPracticeResponse>> Get(int courseId, int lessonId, CancellationToken ct) =>
        ExecuteAsync(userId => practice.GetAsync(userId, courseId, lessonId, ct), ct);

    [HttpPost("submissions")]
    public Task<ActionResult<GrammarResultResponse>> Submit(int courseId, int lessonId, GrammarSubmissionRequest request, CancellationToken ct) =>
        ExecuteAsync(userId => practice.SubmitAsync(userId, courseId, lessonId, request, ct), ct);

    private async Task<ActionResult<T>> ExecuteAsync<T>(Func<int, Task<T>> action, CancellationToken ct)
    {
        Response.Headers.CacheControl = "private, no-store";
        if (!int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var userId) || userId <= 0) return Unauthorized();
        try
        {
            if (!await db.Users.AnyAsync(item => item.UserId == userId && item.IsActive, ct)) return Unauthorized();
            return Ok(await action(userId));
        }
        catch (GrammarPracticeException error) { return Problem(statusCode: error.Status, title: error.Message); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { return StatusCode(499); }
        catch (Exception error) when (error is SqlException or DbUpdateException or OperationCanceledException)
        {
            logger.LogError(error, "Grammar practice request failed.");
            return Problem(statusCode: 503, title: "Chưa thể xử lý bài ngữ pháp. Vui lòng thử lại.");
        }
    }
}
