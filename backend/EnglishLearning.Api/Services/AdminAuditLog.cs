using System.Text.Json;

namespace EnglishLearning.Api.Services;

/// <summary>
/// Append-only JSONL log of admin actions on accounts (lock, unlock, role change), kept under App_Data
/// like the AI quota history. A database table can replace it once a schema change is approved.
/// Lines hold ids, the action, before/after values and the admin's reason; never learning content.
/// </summary>
public sealed class AdminAuditLog(IWebHostEnvironment environment, IConfiguration configuration, TimeProvider time)
{
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public sealed record Entry(DateTimeOffset At, int ActorId, int TargetId, string Action, string? From, string? To, string Reason);

    private string FilePath => Path.Combine(configuration["AdminAudit:Root"] is { Length: > 0 } root ? root
        : Path.Combine(environment.ContentRootPath, "App_Data", "admin-audit"), "user-actions.jsonl");

    public async Task WriteAsync(int actorId, int targetId, string action, string? from, string? to, string reason, CancellationToken ct)
    {
        var line = JsonSerializer.Serialize(new Entry(time.GetUtcNow(), actorId, targetId, action, from, to, reason), Json);
        await Gate.WaitAsync(ct);
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            await File.AppendAllTextAsync(FilePath, line + Environment.NewLine, ct);
        }
        finally { Gate.Release(); }
    }

    /// <summary>Newest first; a damaged line is skipped instead of breaking the page.</summary>
    public async Task<IReadOnlyList<Entry>> ReadAsync(int? targetId, int take, CancellationToken ct)
    {
        if (!File.Exists(FilePath)) return [];
        await Gate.WaitAsync(ct);
        try
        {
            var entries = new List<Entry>();
            foreach (var line in await File.ReadAllLinesAsync(FilePath, ct))
            {
                try
                {
                    if (JsonSerializer.Deserialize<Entry>(line, Json) is { } entry && (targetId is null || entry.TargetId == targetId))
                        entries.Add(entry);
                }
                catch (JsonException) { }
            }
            return entries.OrderByDescending(entry => entry.At).Take(take).ToArray();
        }
        finally { Gate.Release(); }
    }
}
