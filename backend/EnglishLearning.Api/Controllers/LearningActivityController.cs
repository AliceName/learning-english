using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Controllers;

[ApiController, Authorize, Route("api/v1/learning-activity")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class LearningActivityController(EnglishLearningDbContext db, LearningActivityService activity) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Calendar([FromQuery] int? year, CancellationToken ct)
    {
        if (!int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var id)) return Unauthorized();
        try
        {
            var createdAt = await db.Users.AsNoTracking().Where(user => user.UserId == id && user.IsActive)
                .Select(user => (DateTime?)user.CreatedAt).SingleOrDefaultAsync(ct);
            if (createdAt is null) return Unauthorized();
            var today = activity.Today;
            var first = DateOnly.FromDateTime(createdAt.Value);
            if (first > today) first = today;
            var selected = year ?? today.Year;
            if (selected < first.Year || selected > today.Year)
                return BadRequest(new { title = "Năm nằm ngoài lịch học của tài khoản." });
            return Ok(await activity.CalendarAsync(id, selected, first, today, ct));
        }
        catch (Exception error) when (error is SqlException or OperationCanceledException)
        {
            return Problem(statusCode: 503, title: "Chưa tải được lịch học. Vui lòng thử lại.");
        }
    }

    [HttpPost("{kind}"), RequestSizeLimit(1024)]
    public async Task<IActionResult> Record(string kind, CancellationToken ct)
    {
        var learningKind = kind switch
        {
            "listening" => LearningKind.Listening,
            "speaking" => LearningKind.Speaking,
            "reading" => LearningKind.Reading,
            "writing" => LearningKind.Writing,
            "grammar" => LearningKind.Grammar,
            "flashcards" => LearningKind.Flashcards,
            "vocabulary" => LearningKind.Vocabulary,
            _ => (LearningKind?)null
        };
        if (learningKind is null) return BadRequest(new { title = "Loại hoạt động học chưa hợp lệ." });
        if (!int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var id)) return Unauthorized();
        try
        {
            if (!await db.Users.AnyAsync(user => user.UserId == id && user.IsActive, ct)) return Unauthorized();
            await activity.RecordAsync(id, learningKind.Value, activity.Today, ct);
            return NoContent();
        }
        catch (Exception error) when (error is SqlException or DbUpdateException or OperationCanceledException)
        {
            return Problem(statusCode: 503, title: "Chưa ghi nhận được hoạt động học.");
        }
    }
}
