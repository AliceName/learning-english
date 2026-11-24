using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/v1/auth")]
[Produces("application/json")]
public sealed class AccountSecurityController(EnglishLearningDbContext db, IPasswordHasher<User> passwords,
    RefreshSessions sessions, JwtTokenService tokens, LoginAttemptLimiter attempts,
    ILogger<AccountSecurityController> logger) : ControllerBase
{
    [HttpPost("change-password")]
    [RequestSizeLimit(4096)]
    public async Task<IActionResult> ChangePassword(ChangePasswordRequest request, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        try
        {
            var user = await CurrentUser(cancellationToken);
            if (user is null) return Unauthorized();
            using var attempt = attempts.Attempt(user.Email);
            if (!attempt.IsAcquired) return Problem(statusCode: 429, title: "Bạn đã thử quá nhiều lần. Vui lòng đợi một phút.");
            PasswordVerificationResult verification;
            try { verification = passwords.VerifyHashedPassword(user, user.PasswordHash, request.CurrentPassword); }
            catch (Exception error) when (error is FormatException or ArgumentException) { verification = PasswordVerificationResult.Failed; }
            if (verification == PasswordVerificationResult.Failed)
                return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
                { [nameof(request.CurrentPassword)] = ["Mật khẩu hiện tại không chính xác."] }) { Status = 400, Title = "Chưa đổi được mật khẩu." });
            user.PasswordHash = passwords.HashPassword(user, request.NewPassword);
            user.AuthVersion = checked(user.AuthVersion + 1);
            user.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
            sessions.RevokeUserSessions(user.UserId);
            return NoContent();
        }
        catch (DbUpdateConcurrencyException) { return ConflictProblem(); }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { return StatusCode(499); }
        catch (Exception error) when (error is SqlException or DbUpdateException or OperationCanceledException)
        {
            logger.LogError(error, "Account password update failed.");
            return Problem(statusCode: 503, title: "Chưa thể đổi mật khẩu. Vui lòng thử lại.");
        }
    }

    [HttpPost("sessions/revoke-others")]
    [RequestSizeLimit(1024)]
    public async Task<ActionResult<LoginResponse>> RevokeOtherSessions(RevokeOtherSessionsRequest request, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        RefreshGrant? replacement = null;
        var committed = false;
        try
        {
            var user = await CurrentUser(cancellationToken);
            if (user is null) return Unauthorized();
            var sid = User.FindFirstValue(RefreshSessions.SessionClaim);
            if (sid is not null && (request.RefreshToken is null ||
                sessions.FindUser(request.RefreshToken) != user.UserId || !request.RefreshToken.StartsWith(sid + ".", StringComparison.OrdinalIgnoreCase)))
                return Unauthorized();
            user.AuthVersion = checked(user.AuthVersion + 1);
            replacement = sessions.Create(user.UserId, user.AuthVersion);
            if (replacement is null) return Problem(statusCode: 503, title: "Chưa thể cập nhật phiên. Vui lòng thử lại.");
            user.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
            committed = true;
            sessions.RevokeUserSessions(user.UserId, replacement.SessionId);
            return Ok(tokens.CreateToken(user, replacement));
        }
        catch (DbUpdateConcurrencyException) { return ConflictProblem(); }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { return StatusCode(499); }
        catch (Exception error) when (error is SqlException or DbUpdateException or OperationCanceledException)
        {
            logger.LogError(error, "Other account session revocation failed.");
            return Problem(statusCode: 503, title: "Chưa thể đăng xuất các phiên khác. Vui lòng thử lại.");
        }
        finally { if (!committed && replacement is not null) sessions.Revoke(replacement.Token); }
    }

    private Task<User?> CurrentUser(CancellationToken cancellationToken)
    {
        var userId = int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var id) ? id : 0;
        var version = int.TryParse(User.FindFirstValue(JwtTokenService.VersionClaim), out var value) ? value : 0;
        return db.Users.SingleOrDefaultAsync(user => user.UserId == userId && user.IsActive && user.AuthVersion == version, cancellationToken);
    }

    private ObjectResult ConflictProblem() => Problem(statusCode: 409, title: "Tài khoản vừa được cập nhật ở phiên khác. Hãy tải lại trang.");
}
