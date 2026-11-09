using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using EnglishLearning.Api.Configuration;

namespace EnglishLearning.Api.Controllers;

[ApiController, Authorize, Route("api/v1/vocabulary"), Tags("Vocabulary")]
[EnableRateLimiting("Vocabulary")]
public sealed class VocabularyController(VocabularyLookupService lookup, IBilingualVocabularyService bilingual, IOptions<DefinitionAudioSettings> audioOptions, EnglishLearningDbContext db,
    ILogger<VocabularyController> logger) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType<VocabularyResponse>(200)]
    [ProducesResponseType<ProblemDetails>(400)]
    [ProducesResponseType(401)]
    [ProducesResponseType<ProblemDetails>(404)]
    [ProducesResponseType<ProblemDetails>(429)]
    [ProducesResponseType<ProblemDetails>(502)]
    [ProducesResponseType<ProblemDetails>(503)]
    [ProducesResponseType<ProblemDetails>(504)]
    public async Task<ActionResult<VocabularyResponse>> Get([FromQuery] string? word, CancellationToken cancellationToken, [FromQuery] string direction = "en-en")
    {
        Response.Headers.CacheControl = "no-store";
        if (!VocabularyWord.IsDirection(direction)) return Problem(statusCode: 400, title: "Hướng tra chưa hợp lệ.", extensions: new Dictionary<string, object?> { ["code"] = "invalid_direction" });
        if (!VocabularyWord.TryNormalize(word, direction, out var normalized))
        {
            ModelState.AddModelError("word", direction == "en-en" ? "Nhập một từ tiếng Anh từ 1–100 ký tự; có thể có dấu nháy hoặc gạch nối bên trong từ." : "Nhập từ hoặc cụm từ từ 1–100 ký tự, đúng ngôn ngữ đã chọn.");
            return ValidationProblem(ModelState);
        }
        if (!int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var userId) || userId <= 0) return Unauthorized();
        try
        {
            if (!await db.Users.AnyAsync(user => user.UserId == userId && user.IsActive, cancellationToken)) return Unauthorized();
            var result = direction == "en-en" ? await lookup.LookupAsync(normalized, cancellationToken)
                : await bilingual.LookupAsync(normalized, direction, cancellationToken);
            return Ok(VocabularyPresentation.Apply(result, audioOptions.Value));
        }
        catch (VocabularyException error)
        {
            logger.LogWarning("Vocabulary lookup returned {Code} ({StatusCode}).", error.Code, error.StatusCode);
            if (error.RetryAfterSeconds is int seconds) Response.Headers.RetryAfter = seconds.ToString(System.Globalization.CultureInfo.InvariantCulture);
            return Problem(statusCode: error.StatusCode, title: error.Message, extensions: new Dictionary<string, object?> { ["code"] = error.Code });
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { return StatusCode(499); }
        catch (Exception error) when (error is SqlException or OperationCanceledException)
        {
            logger.LogWarning("Vocabulary account authorization failed ({ErrorType}).", error.GetType().Name);
            return Problem(statusCode: 503, title: "Chưa kiểm tra được phiên đăng nhập. Vui lòng thử lại.");
        }
    }
}
