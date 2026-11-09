using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Services;
using EnglishLearning.Api.Services.CloudinaryMedia;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using MongoDB.Driver;

namespace EnglishLearning.Api.Controllers;

[ApiController, Authorize, Route("api/v1/vocabulary/definition-audio"), Tags("Vocabulary audio")]
[EnableRateLimiting("DefinitionAudio")]
public sealed class DefinitionAudioController(DefinitionAudioService audio, IDictionaryAudioStorage storage, EnglishLearningDbContext db,
    ILogger<DefinitionAudioController> logger) : ControllerBase
{
    [HttpPost("prepare"), RequestSizeLimit(4096)]
    public Task<IActionResult> Prepare(DefinitionAudioRequest request, CancellationToken token) => ExecuteAsync(request, null, token);

    [HttpGet]
    public Task<IActionResult> Get([FromQuery] string key, CancellationToken token) => ExecuteAsync(null, key, token);

    private async Task<IActionResult> ExecuteAsync(DefinitionAudioRequest? request, string? key, CancellationToken token)
    {
        Response.Headers.CacheControl = "private, no-store";
        Response.Headers.XContentTypeOptions = "nosniff";
        if (!int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var userId) || userId <= 0) return Unauthorized();
        try
        {
            if (!await db.Users.AnyAsync(user => user.UserId == userId && user.IsActive, token)) return Unauthorized();
            var entry = request is not null ? await audio.PrepareAsync(request, token) : await audio.FindAsync(key ?? "", token);
            if (entry is null) return Problem(statusCode: 404, title: "Âm thanh cần được chuẩn bị lại.", extensions: new Dictionary<string, object?> { ["code"] = "audio_not_prepared" });
            if (request is not null) return Ok(new DefinitionAudioReadyResponse("ready", request.DefinitionId, entry.Key,
                $"/api/vocabulary/definition-audio?key={entry.Key}", entry.ContentType, entry.SizeBytes, entry.Attribution));
            var read = await storage.OpenAsync(entry, Request.Headers.Range.ToString(), token);
            Response.Headers.AcceptRanges = "bytes";
            Response.StatusCode = read.Status;
            Response.ContentLength = read.Length;
            if (read.ContentRange is not null) Response.Headers.ContentRange = read.ContentRange;
            if (read.Status == 416) { await read.DisposeAsync(); return StatusCode(416); }
            return File(read.Body, read.ContentType, enableRangeProcessing: read.EnableRangeProcessing);
        }
        catch (VocabularyException error)
        {
            if (error.RetryAfterSeconds is int seconds) Response.Headers.RetryAfter = seconds.ToString(System.Globalization.CultureInfo.InvariantCulture);
            return Problem(statusCode: error.StatusCode, title: error.Message, extensions: new Dictionary<string, object?> { ["code"] = error.Code });
        }
        catch (CloudMediaException error)
        {
            if (error.RetryAfterSeconds is int seconds) Response.Headers.RetryAfter = seconds.ToString(System.Globalization.CultureInfo.InvariantCulture);
            return Problem(statusCode: error.Status, title: "Kho âm thanh tạm thời chưa sẵn sàng.", extensions: new Dictionary<string, object?> { ["code"] = error.Code });
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { return StatusCode(499); }
        catch (Exception error) when (error is SqlException or MongoException or IOException or TimeoutException or OperationCanceledException or InvalidOperationException or UnauthorizedAccessException)
        {
            logger.LogWarning("Definition audio failed ({ErrorType}).", error.GetType().Name);
            return Problem(statusCode: 503, title: "Chưa chuẩn bị được giọng đọc. Hãy thử lại.");
        }
    }
}
