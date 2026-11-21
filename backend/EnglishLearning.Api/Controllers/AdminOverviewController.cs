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

/// <summary>Admin overview and content statistics: learner activity, service status (split so a slow service does not delay the counts), Writing tasks and course lessons.</summary>
[ApiController, Authorize(Roles = UserRoles.Admin), Route("api/v1/admin/overview"), Tags("Admin overview")]
[ProducesResponseType(StatusCodes.Status401Unauthorized)]
[ProducesResponseType(StatusCodes.Status403Forbidden)]
public sealed class AdminOverviewController(EnglishLearningDbContext db, ILogger<AdminOverviewController> logger) : ControllerBase
{
    [HttpGet]
    public Task<ActionResult<AdminOverview>> Get([FromServices] AdminOverviewService overview, CancellationToken ct) =>
        ExecuteAsync(() => overview.GetAsync(ct), ct);

    [HttpGet("services")]
    public Task<ActionResult<AdminServiceReport>> Services([FromServices] AdminServiceHealth health, [FromQuery] bool refresh = false,
        CancellationToken ct = default) => ExecuteAsync(() => health.GetAsync(refresh, ct), ct);

    /// <summary>Per Writing library task: learners, rounds, revisions, errors per 100 words, off-topic share.</summary>
    [HttpGet("/api/v1/admin/stats/writing-tasks")]
    public Task<ActionResult<AdminWritingTaskReport>> WritingTasks([FromServices] AdminContentStatsService stats, CancellationToken ct) =>
        ExecuteAsync(() => stats.WritingTasksAsync(ct), ct);

    /// <summary>Per lesson of a system course: learners, scores, time, pass rate, not started, most-missed questions.</summary>
    [HttpGet("/api/v1/admin/courses/{id:int:min(1)}/stats")]
    public Task<ActionResult<AdminCourseStats>> CourseStats(int id, [FromServices] AdminContentStatsService stats, CancellationToken ct) =>
        ExecuteAsync(() => stats.CourseAsync(id, ct), ct);

    private async Task<ActionResult<T>> ExecuteAsync<T>(Func<Task<T?>> action, CancellationToken ct) where T : class
    {
        Response.Headers.CacheControl = "no-store";
        if (!int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId)) return Unauthorized();
        try
        {
            var actor = await db.Users.AsNoTracking().SingleOrDefaultAsync(item => item.UserId == actorId && item.IsActive, ct);
            if (actor is null) return Unauthorized();
            if (actor.Role != UserRoles.Admin) return Forbid();
            return await action() is { } result ? Ok(result) : NotFound();
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { return StatusCode(499); }
        catch (Exception error) when (error is SqlException or DbUpdateException or IOException or InvalidOperationException)
        {
            logger.LogError(error, "Admin overview request failed.");
            return Problem(statusCode: 503, title: "Chưa thể tải số liệu tổng quan. Vui lòng thử lại.");
        }
    }
}
