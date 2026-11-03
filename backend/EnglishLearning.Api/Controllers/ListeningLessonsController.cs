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

[ApiController, Authorize, Route("api/v1/courses/{courseId:int:min(1)}/lessons/{lessonId:int:min(1)}/listening")]
[Tags("Listening practice"), RequestSizeLimit(128 * 1024)]
[Produces("application/json")]
public sealed class ListeningLessonsController(ListeningPracticeService practice, EnglishLearningDbContext db,
    ILogger<ListeningLessonsController> logger) : ControllerBase
{
    [HttpGet]
    public Task<ActionResult<ListeningPracticeResponse>> Get(int courseId, int lessonId, CancellationToken ct) =>
        ExecuteAsync(userId => practice.GetAsync(userId, courseId, lessonId, ct), ct);

    [HttpPost("start")]
    public Task<ActionResult<ListeningStartResponse>> Start(int courseId, int lessonId, CancellationToken ct) =>
        ExecuteAsync(userId => practice.StartAsync(userId, courseId, lessonId, ct), ct);

    [HttpGet("transcript")]
    public Task<ActionResult<ListeningTranscriptResponse>> Transcript(int courseId, int lessonId, CancellationToken ct) =>
        ExecuteAsync(userId => practice.TranscriptAsync(userId, courseId, lessonId, ct), ct);

    [HttpPut("position")]
    public Task<ActionResult<ListeningPositionResponse>> Position(int courseId, int lessonId, ListeningPositionRequest request, CancellationToken ct) =>
        ExecuteAsync(userId => practice.SavePositionAsync(userId, courseId, lessonId, request, ct), ct);

    [HttpPost("submissions")]
    public Task<ActionResult<ListeningResultResponse>> Submit(int courseId, int lessonId, ListeningSubmissionRequest request, CancellationToken ct) =>
        ExecuteAsync(userId => practice.SubmitAsync(userId, courseId, lessonId, request, ct), ct);

    [HttpGet("results")]
    public Task<ActionResult<ListeningResultsResponse>> History(int courseId, int lessonId, [FromQuery] ListeningResultsQuery query, CancellationToken ct) =>
        ExecuteAsync(userId => practice.HistoryAsync(userId, courseId, lessonId, query, ct), ct);

    [HttpGet("results/{resultId:int:min(1)}")]
    public Task<ActionResult<ListeningResultResponse>> Result(int courseId, int lessonId, int resultId, CancellationToken ct) =>
        ExecuteAsync(userId => practice.ResultAsync(userId, courseId, lessonId, resultId, ct), ct);

    private async Task<ActionResult<T>> ExecuteAsync<T>(Func<int, Task<T>> action, CancellationToken ct)
    {
        Response.Headers.CacheControl = "private, no-store";
        if (!int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var userId) || userId <= 0) return Unauthorized();
        try
        {
            if (!await db.Users.AnyAsync(item => item.UserId == userId && item.IsActive, ct)) return Unauthorized();
            return Ok(await action(userId));
        }
        catch (ListeningPracticeException error) { return Problem(statusCode: error.Status, title: error.Message); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { return StatusCode(499); }
        catch (Exception error) when (error is SqlException or DbUpdateException or OperationCanceledException)
        {
            logger.LogError(error, "Listening practice request failed.");
            return Problem(statusCode: 503, title: "Chưa thể xử lý bài nghe. Vui lòng thử lại.");
        }
    }
}
