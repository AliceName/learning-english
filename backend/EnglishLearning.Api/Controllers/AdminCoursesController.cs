using System.Data;
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

[ApiController, Authorize(Roles = UserRoles.Admin), Route("api/v1/admin/courses"), Tags("Admin courses")]
[ProducesResponseType(StatusCodes.Status401Unauthorized)]
[ProducesResponseType(StatusCodes.Status403Forbidden)]
public sealed class AdminCoursesController(CourseAuthoringService authoring, EnglishLearningDbContext db,
    ILogger<AdminCoursesController> logger) : ControllerBase
{
    [HttpGet]
    public Task<ActionResult<AdminCourseListResponse>> List([FromQuery] AdminCourseQuery query, CancellationToken ct) =>
        ExecuteAsync(_ => authoring.ListAsync(query, ct), false, ct);
    [HttpGet("{id:int:min(1)}")]
    public Task<ActionResult<AdminCourseResponse>> Get(int id, CancellationToken ct) => ExecuteAsync(_ => authoring.GetAsync(id, ct), false, ct);
    [HttpPost, RequestSizeLimit(256 * 1024)]
    public Task<ActionResult<AdminCourseResponse>> Create(CreateCourseRequest request, CancellationToken ct) =>
        ExecuteAsync(userId => authoring.CreateAsync(userId, request, ct), true, ct, created: true);
    [HttpPut("{id:int:min(1)}"), RequestSizeLimit(256 * 1024)]
    public Task<ActionResult<AdminCourseResponse>> Update(int id, SaveCourseRequest request, CancellationToken ct) =>
        ExecuteAsync(_ => authoring.UpdateAsync(id, request, ct), true, ct);
    [HttpPost("{id:int:min(1)}/lessons"), RequestSizeLimit(256 * 1024)]
    public Task<ActionResult<AdminCourseResponse>> AddLesson(int id, SaveLessonRequest request, CancellationToken ct) =>
        ExecuteAsync(_ => authoring.SaveLessonAsync(id, null, request, ct), true, ct);
    [HttpPut("{id:int:min(1)}/lessons/{lessonId:int:min(1)}"), RequestSizeLimit(256 * 1024)]
    public Task<ActionResult<AdminCourseResponse>> SaveLesson(int id, int lessonId, SaveLessonRequest request, CancellationToken ct) =>
        ExecuteAsync(_ => authoring.SaveLessonAsync(id, lessonId, request, ct), true, ct);
    [HttpPost("{id:int:min(1)}/publish")]
    public Task<ActionResult<AdminCourseResponse>> Publish(int id, CancellationToken ct) => ExecuteAsync(_ => authoring.PublishAsync(id, ct), true, ct);

    private async Task<ActionResult<T>> ExecuteAsync<T>(Func<int, Task<T>> action, bool write, CancellationToken ct, bool created = false)
    {
        Response.Headers.CacheControl = "no-store";
        if (!int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var userId)) return Unauthorized();
        try
        {
            var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(item => item.UserId == userId && item.IsActive, ct);
            if (user is null) return Unauthorized();
            if (user.Role != UserRoles.Admin) return Forbid();
            // Serialize editing/publishing of drafts; reuse the enclosing rollback transaction in integration tests.
            await using var transaction = write && db.Database.CurrentTransaction is null
                ? await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct) : null;
            var result = await action(userId);
            if (transaction is not null) await transaction.CommitAsync(ct);
            return created ? StatusCode(StatusCodes.Status201Created, result) : Ok(result);
        }
        catch (AuthoringException error) { return Problem(statusCode: error.Status, title: error.Message); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { return StatusCode(499); }
        catch (Exception error) when (error is SqlException or DbUpdateException or OperationCanceledException)
        {
            logger.LogError(error, "Course authoring database request failed.");
            return Problem(statusCode: 503, title: "Chưa thể lưu hoặc tải khóa học. Vui lòng thử lại.");
        }
    }
}
