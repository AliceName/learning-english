using System.Globalization;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Threading.RateLimiting;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Controllers;

[ApiController]
[Route("api/v1/auth")]
[Tags("Authentication")]
[Produces("application/json")]
public sealed class AuthController(
    RegistrationService registrationService,
    LoginService loginService,
    JwtTokenService tokenService,
    LoginAttemptLimiter loginAttemptLimiter,
    EnglishLearningDbContext dbContext,
    ILogger<AuthController> logger) : ControllerBase
{
    [AllowAnonymous]
    [HttpPost("register")]
    [RequestSizeLimit(16 * 1024)]
    [ProducesResponseType<RegistrationResponse>(StatusCodes.Status201Created)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status409Conflict)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<RegistrationResponse>> Register(
        RegisterRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var user = await registrationService.RegisterAsync(request, cancellationToken);
            if (user is null)
            {
                return Conflict(new ValidationProblemDetails(new Dictionary<string, string[]>
                {
                    ["email"] = ["Địa chỉ email này đã được đăng ký."]
                })
                {
                    Status = StatusCodes.Status409Conflict,
                    Title = "Không thể tạo tài khoản."
                });
            }

            return StatusCode(StatusCodes.Status201Created, new RegistrationResponse(
                "Tạo tài khoản thành công.",
                new RegisteredUser(user.UserId, user.Email, user.FullName, user.TargetLevel, user.CreatedAt, user.Role)));
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return StatusCode(StatusCodes.Status499ClientClosedRequest);
        }
        catch (Exception error) when (error is SqlException or DbUpdateException or OperationCanceledException)
        {
            logger.LogError(error, "Database request failed during account registration.");
            return Problem(statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Chưa thể tạo tài khoản.",
                detail: "Hệ thống đang bận. Vui lòng thử lại sau.");
        }
    }

    [AllowAnonymous]
    [HttpPost("login")]
    [RequestSizeLimit(16 * 1024)]
    [ProducesResponseType<LoginResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<LoginResponse>> Login(LoginRequest request, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        Response.Headers.Pragma = "no-cache";
        using var attempt = loginAttemptLimiter.Attempt(request.Email);
        if (!attempt.IsAcquired)
        {
            if (attempt.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
                Response.Headers.RetryAfter = Math.Ceiling(retryAfter.TotalSeconds).ToString(CultureInfo.InvariantCulture);
            return Problem(statusCode: StatusCodes.Status429TooManyRequests,
                title: "Bạn đã thử đăng nhập quá nhiều lần.", detail: "Vui lòng đợi một phút rồi thử lại.");
        }
        try
        {
            var user = await loginService.AuthenticateAsync(request, cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            if (user is null)
                return Problem(statusCode: StatusCodes.Status401Unauthorized,
                    title: "Đăng nhập không thành công.", detail: "Email hoặc mật khẩu không chính xác.");
            return Ok(tokenService.CreateToken(user));
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return StatusCode(StatusCodes.Status499ClientClosedRequest);
        }
        catch (Exception error) when (error is SqlException or DbUpdateException or OperationCanceledException)
        {
            logger.LogError(error, "Database request failed during login.");
            return Problem(statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Chưa thể đăng nhập.", detail: "Hệ thống đang bận. Vui lòng thử lại sau.");
        }
    }

    [Authorize]
    [HttpGet("me")]
    [ProducesResponseType<CurrentUserResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<CurrentUserResponse>> GetCurrentUser(CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        if (!int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var userId) || userId <= 0)
            return Unauthorized();
        try
        {
            var user = await dbContext.Users.AsNoTracking().SingleOrDefaultAsync(item => item.UserId == userId && item.IsActive, cancellationToken);
            if (user is null) return Unauthorized();
            return Ok(new CurrentUserResponse(user.UserId, user.Email, user.FullName, user.TargetLevel,
                user.CreatedAt, user.CurrentStreak, user.AvatarUrl, user.Role));
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return StatusCode(StatusCodes.Status499ClientClosedRequest);
        }
        catch (Exception error) when (error is SqlException or OperationCanceledException)
        {
            logger.LogError(error, "Database request failed while loading current user.");
            return Problem(statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Chưa thể tải tài khoản.", detail: "Hệ thống đang bận. Vui lòng thử lại sau.");
        }
    }
}
