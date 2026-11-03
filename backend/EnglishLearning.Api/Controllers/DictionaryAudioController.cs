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

[ApiController, Authorize, Route("api/v1/vocabulary/audio"), Tags("Vocabulary audio")]
[EnableRateLimiting("VocabularyAudio")]
public sealed class DictionaryAudioController(DictionaryAudioService audio, IDictionaryAudioStorage storage, EnglishLearningDbContext db,
    ILogger<DictionaryAudioController> logger) : ControllerBase
{
    [HttpPost("prepare"), RequestSizeLimit(4096)]
    [ProducesResponseType<DictionaryAudioReadyResponse>(200)]
    public Task<IActionResult> Prepare(DictionaryAudioRequest request, CancellationToken token) => ExecuteAsync(request, true, token);

    [HttpGet]
    public Task<IActionResult> Get([FromQuery] DictionaryAudioRequest request, CancellationToken token) => ExecuteAsync(request, false, token);

    private async Task<IActionResult> ExecuteAsync(DictionaryAudioRequest request, bool prepare, CancellationToken token)
    {
        Response.Headers.CacheControl = "private, no-store";
        Response.Headers.XContentTypeOptions = "nosniff";
        if (!int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var id) || id <= 0) return Unauthorized();
        try
        {
            if (!await db.Users.AnyAsync(user => user.UserId == id && user.IsActive, token)) return Unauthorized();
            var entry = prepare ? await audio.PrepareAsync(request, token) : await audio.FindAsync(request, token);
            if (entry is null) return Problem(statusCode: 404, title: "Bản thu cần được chuẩn bị lại.", extensions: new Dictionary<string, object?> { ["code"] = "audio_not_prepared" });
            if (prepare)
            {
                VocabularyWord.TryNormalize(request.Word, out var word);
                var url = $"/api/vocabulary/audio?word={Uri.EscapeDataString(word)}&entry={request.Entry}&phonetic={request.Phonetic}";
                return Ok(new DictionaryAudioReadyResponse("ready", url, entry.ContentType, entry.SizeBytes, entry.Attribution));
            }
            var read = await storage.OpenAsync(entry, Request.Headers.Range.ToString(), token);
            Response.Headers.AcceptRanges = "bytes";
            if (read.EnableRangeProcessing) return File(read.Body, read.ContentType, enableRangeProcessing: true);
            Response.StatusCode = read.Status;
            Response.ContentLength = read.Length;
            if (read.ContentRange is not null) Response.Headers.ContentRange = read.ContentRange;
            if (read.Status == 416) { await read.DisposeAsync(); return StatusCode(416); }
            return File(read.Body, read.ContentType, enableRangeProcessing: false);
        }
        catch (CloudMediaException error)
        {
            logger.LogWarning("Dictionary cloud storage failed ({Code}).", error.Code);
            if (error.RetryAfterSeconds is int seconds) Response.Headers.RetryAfter = seconds.ToString(System.Globalization.CultureInfo.InvariantCulture);
            return Problem(statusCode: error.Status, title: "Kho âm thanh tạm thời chưa sẵn sàng. Vui lòng thử lại.",
                extensions: new Dictionary<string, object?> { ["code"] = error.Code });
        }
        catch (VocabularyException error)
        {
            if (error.RetryAfterSeconds is int seconds) Response.Headers.RetryAfter = seconds.ToString(System.Globalization.CultureInfo.InvariantCulture);
            return Problem(statusCode: error.StatusCode, title: error.Message, extensions: new Dictionary<string, object?> { ["code"] = error.Code });
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { return StatusCode(499); }
        catch (Exception error) when (error is SqlException or MongoException or IOException or UnauthorizedAccessException or OperationCanceledException or TimeoutException)
        {
            logger.LogWarning("Dictionary audio request failed ({ErrorType}).", error.GetType().Name);
            return Problem(statusCode: 503, title: "Chưa chuẩn bị được âm thanh. Vui lòng thử lại.");
        }
    }
}
