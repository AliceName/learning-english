using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Controllers;

[ApiController, Authorize, Route("api/v1/translation-practice"), Tags("Translation practice")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None), RequestSizeLimit(8192)]
public sealed class TranslationPracticeController(TranslationPracticeService practice, TranslationRequestReplay replay,
    ILogger<TranslationPracticeController> logger) : ControllerBase
{
    [HttpPost("prompts/next"), EnableRateLimiting("TranslationNext")]
    public Task<IActionResult> Next(TranslationNextRequest request, CancellationToken ct) => ExecuteAsync((userId) =>
        replay.RunAsync("next", userId, request.RequestId, $"{request.Level}:{request.Review}",
            token => practice.NextAsync(userId, request.Level, request.Review, token), ct));

    [HttpPost("grade"), EnableRateLimiting("TranslationGrade")]
    public Task<IActionResult> Grade(TranslationGradeRequest request, CancellationToken ct) => ExecuteAsync((userId) =>
        replay.RunAsync("grade", userId, request.RequestId,
            Convert.ToHexString(TranslationPracticeSupport.Hash($"{request.AttemptToken}:{request.IncludeAiFeedback}:{request.Answer}")),
            token => practice.GradeAsync(userId, request, token), ct));

    private async Task<IActionResult> ExecuteAsync<T>(Func<int, Task<T>> run)
    {
        if (!int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var userId) || userId <= 0) return Unauthorized();
        try { return Ok(await run(userId)); }
        catch (TranslationPracticeException error)
        {
            if (error.RetryAfter is { } seconds)
                Response.Headers.RetryAfter = seconds.ToString(System.Globalization.CultureInfo.InvariantCulture);
            return Problem(statusCode: error.Status, title: error.Message, extensions: new Dictionary<string, object?> { ["code"] = error.Code });
        }
        catch (Exception error) when (error is SqlException or DbUpdateException)
        {
            logger.LogWarning("The translation practice store could not complete a request.");
            return Problem(statusCode: 503, title: "Kho câu hiện chưa sẵn sàng. Vui lòng thử lại sau.",
                extensions: new Dictionary<string, object?> { ["code"] = "bank_unavailable" });
        }
    }
}
