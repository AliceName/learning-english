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

/// <summary>Account administration for admins. The caller is re-checked as an active admin on every request.</summary>
[ApiController, Authorize(Roles = UserRoles.Admin), Route("api/v1/admin/users"), Tags("Admin users")]
[ProducesResponseType(StatusCodes.Status401Unauthorized)]
[ProducesResponseType(StatusCodes.Status403Forbidden)]
public sealed class AdminUsersController(AdminUserService users, EnglishLearningDbContext db, ILogger<AdminUsersController> logger) : ControllerBase
{
    [HttpGet]
    public Task<ActionResult<AdminUserListResponse>> List([FromQuery] AdminUserQuery query, CancellationToken ct) =>
        ExecuteAsync(_ => users.ListAsync(query, ct), false, ct);

    [HttpGet("audit")]
    public Task<ActionResult<IReadOnlyList<AdminAuditEntry>>> Recent(CancellationToken ct) =>
        ExecuteAsync(_ => users.RecentAsync(ct), false, ct);

    [HttpGet("{id:int:min(1)}")]
    public Task<ActionResult<AdminUserDetail>> Get(int id, CancellationToken ct) =>
        ExecuteAsync(actor => users.GetAsync(actor, id, ct), false, ct);

    [HttpPost("{id:int:min(1)}/lock"), RequestSizeLimit(4096)]
    public Task<ActionResult<AdminUserDetail>> Lock(int id, AdminUserActionRequest request, CancellationToken ct) =>
        ExecuteAsync(actor => users.SetActiveAsync(actor, id, false, request.Reason, ct), true, ct);

    [HttpPost("{id:int:min(1)}/unlock"), RequestSizeLimit(4096)]
    public Task<ActionResult<AdminUserDetail>> Unlock(int id, AdminUserActionRequest request, CancellationToken ct) =>
        ExecuteAsync(actor => users.SetActiveAsync(actor, id, true, request.Reason, ct), true, ct);

    [HttpPut("{id:int:min(1)}/role"), RequestSizeLimit(4096)]
    public Task<ActionResult<AdminUserDetail>> Role(int id, AdminUserRoleRequest request, CancellationToken ct) =>
        ExecuteAsync(actor => users.SetRoleAsync(actor, id, request.Role, request.Reason, ct), true, ct);

    private async Task<ActionResult<T>> ExecuteAsync<T>(Func<int, Task<T>> action, bool write, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        if (!int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId)) return Unauthorized();
        try
        {
            var actor = await db.Users.AsNoTracking().SingleOrDefaultAsync(item => item.UserId == actorId && item.IsActive, ct);
            if (actor is null) return Unauthorized();
            if (actor.Role != UserRoles.Admin) return Forbid();
            // Serializable so two admins cannot each remove the other as "not the last admin".
            await using var transaction = write && db.Database.CurrentTransaction is null
                ? await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct) : null;
            var result = await action(actorId);
            if (transaction is not null) await transaction.CommitAsync(ct);
            return Ok(result);
        }
        catch (AdminUserException error) { return Problem(statusCode: error.Status, title: error.Message); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { return StatusCode(499); }
        catch (Exception error) when (error is SqlException or DbUpdateException or IOException)
        {
            logger.LogError(error, "Admin user request failed.");
            return Problem(statusCode: 503, title: "Chưa thể tải hoặc lưu thông tin người dùng. Vui lòng thử lại.");
        }
    }
}
