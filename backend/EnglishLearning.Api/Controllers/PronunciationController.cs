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

[ApiController, Authorize(Roles = UserRoles.Admin), Route("api/v1/admin/pronunciation"), Tags("Pronunciation")]
public sealed class PronunciationController(IpaTranscriber transcriber, EnglishLearningDbContext db,
    ILogger<PronunciationController> logger) : ControllerBase
{
    [HttpPost("ipa"), RequestSizeLimit(16 * 1024)]
    public async Task<ActionResult<GenerateIpaResponse>> Generate(GenerateIpaRequest request, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        if (!int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var userId)) return Unauthorized();
        try
        {
            var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(item => item.UserId == userId && item.IsActive, ct);
            if (user is null) return Unauthorized();
            if (user.Role != UserRoles.Admin) return Forbid();
            return Ok(transcriber.Transcribe(request.Text));
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { return StatusCode(499); }
        catch (Exception error) when (error is SqlException or OperationCanceledException)
        {
            logger.LogError(error, "Pronunciation authorization database request failed.");
            return Problem(statusCode: 503, title: "Chưa thể tạo IPA. Vui lòng thử lại.");
        }
    }
}
