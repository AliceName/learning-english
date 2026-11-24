using System.Globalization;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using EnglishLearning.Api.Data;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Authentication;

internal static class AccountTokenValidation
{
    private const string Unavailable = "account-auth-unavailable";

    public static async Task Validate(TokenValidatedContext context)
    {
        var principal = context.Principal;
        var versionClaim = principal?.FindFirstValue(JwtTokenService.VersionClaim);
        if (!int.TryParse(principal?.FindFirstValue(JwtRegisteredClaimNames.Sub), out var userId) || userId <= 0 ||
            versionClaim is not null && (!int.TryParse(versionClaim, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed) || parsed < 0))
        {
            context.Fail("Invalid account."); return;
        }
        var version = versionClaim is null ? 0 : int.Parse(versionClaim, CultureInfo.InvariantCulture);
        var session = principal?.FindFirstValue(RefreshSessions.SessionClaim);
        if (session is not null && (!Guid.TryParseExact(session, "N", out var id) ||
            !context.HttpContext.RequestServices.GetRequiredService<RefreshSessions>().Touch(id)))
        {
            context.Fail("Session expired or revoked."); return;
        }
        try
        {
            var db = context.HttpContext.RequestServices.GetRequiredService<EnglishLearningDbContext>();
            var account = await db.Users.AsNoTracking().Where(user => user.UserId == userId)
                .Select(user => new { user.IsActive, user.AuthVersion }).SingleOrDefaultAsync(context.HttpContext.RequestAborted);
            if (account is null || !account.IsActive || account.AuthVersion != version)
                context.Fail("Account session revoked.");
        }
        catch (Exception error) when (error is SqlException or OperationCanceledException)
        {
            context.HttpContext.Items[Unavailable] = context.HttpContext.RequestAborted.IsCancellationRequested ? 499 : 503;
            context.Fail("Account validation unavailable.");
        }
    }

    public static async Task Challenge(JwtBearerChallengeContext context)
    {
        if (context.HttpContext.Items[Unavailable] is not int status) return;
        context.HandleResponse();
        context.Response.StatusCode = status;
        context.Response.Headers.CacheControl = "no-store";
        if (status != 499) await context.Response.WriteAsJsonAsync(new ProblemDetails
        {
            Status = status, Title = "Chưa thể kiểm tra phiên đăng nhập. Vui lòng thử lại."
        });
    }
}
