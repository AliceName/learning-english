using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.Json;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Services.AiCourses;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Controllers;

[ApiController, Authorize(Roles = UserRoles.Admin), Route("api/v1/admin/ai")]
public sealed class AiUsageController(EnglishLearningDbContext db, AiCourseStore store,
    AiApiGateway gateway, TimeProvider time, ILogger<AiUsageController> logger) : ControllerBase
{
    [HttpGet("overview")]
    public Task<IActionResult> Overview([FromQuery] int days = 1, CancellationToken ct = default) => ExecuteAsync(async actor => {
        if (days is < 1 or > 30) return BadRequest();
        using var gate = await store.LockAsync(ct);
        var now = time.GetUtcNow();
        var from = now.AddDays(-days);
        var calls = store.Calls().Where(call => call.StartedAt >= from).OrderByDescending(call => call.StartedAt).ToArray();
        var jobs = store.Jobs().Where(job => job.CreatedAt >= from).ToArray();
        var policy = store.Read<AiApiPolicy>(store.PolicyFile) ?? new();
        var today = store.Calls().Where(call => call.StartedAt >= AiApiGateway.DayStart(now)).ToArray();
        var changes = Path.Combine(store.Root, "policy-changes.jsonl");
        var audit = System.IO.File.Exists(changes)
            ? System.IO.File.ReadLines(changes).TakeLast(10).Select(line => JsonSerializer.Deserialize<JsonElement>(line)).Reverse().ToArray() : [];
        var userRows = calls.GroupBy(call => call.UserId).Select(group => new {
            userId = group.Key, calls = group.Count(), tokens = group.Sum(call => call.TotalTokens ?? 0)
        }).OrderByDescending(row => row.calls).Take(20).ToArray();
        var ids = userRows.Where(row => row.userId is not null).Select(row => row.userId!.Value).ToArray();
        // Admins see who used the quota by name, not just an id.
        var names = await db.Users.AsNoTracking().Where(item => ids.Contains(item.UserId))
            .ToDictionaryAsync(item => item.UserId, item => new { item.FullName, item.Email }, ct);
        return Ok(new {
            asOfUtc = now, fromUtc = from, days, storageMode = "single_host_pilot",
            counts = new {
                requests = jobs.Length, calls = calls.Length, retries = calls.Count(call => call.AttemptNo > 1),
                errors = calls.Count(call => call.Outcome != "success" || call.ContentOutcome.StartsWith("invalid")), ttsCalls = calls.Count(call => call.Operation == "speech_synthesis"),
                finishedCourses = jobs.Count(job => job.Status == "completed")
            },
            tokens = new {
                reportedTotal = calls.Sum(call => call.TotalTokens ?? 0),
                knownCalls = calls.Count(call => call.TotalTokens is not null), unknownCalls = calls.Count(call => call.TotalTokens is null),
                audioSeconds = calls.Sum(call => call.AudioSeconds ?? 0)
            },
            policy, usage = new {
                callsToday = today.Length, tokensToday = today.Sum(call => call.TotalTokens ?? call.ReservedTokens),
                resetAtUtc = AiApiGateway.DayStart(now).AddDays(1)
            },
            series = calls.GroupBy(call => call.StartedAt.UtcDateTime.ToString(days == 1 ? "yyyy-MM-ddTHH:00:00Z" : "yyyy-MM-dd"))
                .OrderBy(group => group.Key).Select(group => new { at = group.Key, calls = group.Count(), errors = group.Count(call => call.Outcome != "success") }),
            users = userRows.Select(row => new {
                row.userId, row.calls, row.tokens,
                fullName = row.userId is int id && names.TryGetValue(id, out var user) ? user.FullName : null,
                email = row.userId is int key && names.TryGetValue(key, out var match) ? match.Email : null
            }),
            calls = calls.Take(150), policyChanges = audit
        });
    }, ct);

    [HttpPut("limits"), RequestSizeLimit(16384)]
    public Task<IActionResult> Limits(AiPolicyUpdate change, CancellationToken ct) =>
        ExecuteAsync(async actor => Ok(await gateway.UpdatePolicyAsync(change, actor, ct)), ct);

    private async Task<IActionResult> ExecuteAsync(Func<int, Task<IActionResult>> action, CancellationToken ct)
    {
        Response.Headers.CacheControl = "private, no-store";
        if (!int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var id)) return Unauthorized();
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(item => item.UserId == id && item.IsActive, ct);
        if (user is null) return Unauthorized();
        if (user.Role != UserRoles.Admin) return Forbid();
        try { return await action(id); }
        catch (AiCourseException error)
        { return Problem(statusCode: error.Status, title: error.Message, extensions: new Dictionary<string, object?> { ["code"] = error.Code }); }
        catch (IOException error)
        {
            logger.LogError(error, "AI usage data could not be loaded.");
            return Problem(statusCode: 503, title: "Chưa tải được thống kê AI.");
        }
    }
}
