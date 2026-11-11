using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using EnglishLearning.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Services;

public sealed class TranslationPracticeException(int status, string code, string message, int? retryAfter = null) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public int? RetryAfter { get; } = retryAfter;
}

internal static partial class TranslationPracticeSupport
{
    internal static readonly System.Text.Json.JsonSerializerOptions Json = new(System.Text.Json.JsonSerializerDefaults.Web);
    internal static bool ValidLevel(string? level) => level is "A1" or "A2" or "B1";

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();

    internal static byte[] AnswerHash(string value) => Hash(Whitespace().Replace(value.Trim().Normalize(), " "));

    internal static byte[] PromptHash(string value) =>
        Hash(Whitespace().Replace(value.Trim().Normalize(), " ").TrimEnd('.', '!', '?', '…').TrimEnd().ToLowerInvariant());

    internal static byte[] Hash(string value) => SHA256.HashData(Encoding.UTF8.GetBytes(value));

    internal static async Task LockAsync(EnglishLearningDbContext db, string key, CancellationToken ct)
    {
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            DECLARE @result INT;
            EXEC @result = sys.sp_getapplock @Resource = {key}, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 5000;
            IF @result < 0 THROW 51030, 'Unable to acquire translation practice lock.', 1;
            """, ct);
    }
}

public sealed class TranslationRequestReplay(TimeProvider time, IHostApplicationLifetime lifetime)
{
    private readonly Dictionary<(string Action, int UserId, Guid RequestId), Entry> entries = [];
    private DateTimeOffset nextCleanup;

    private sealed class Entry(string fingerprint, DateTimeOffset now)
    {
        public string Fingerprint { get; } = fingerprint;
        public DateTimeOffset Expires { get; set; } = now.AddMinutes(5);
        public TaskCompletionSource<object>? Pending { get; set; }
    }

    public async Task<T> RunAsync<T>(string action, int userId, Guid requestId, string fingerprint,
        Func<CancellationToken, Task<T>> run, CancellationToken caller) where T : class
    {
        if (requestId == Guid.Empty)
            throw new TranslationPracticeException(400, "invalid_request_id", "Mã yêu cầu không hợp lệ.");

        caller.ThrowIfCancellationRequested();
        var now = time.GetUtcNow();
        var key = (action, userId, requestId);
        TaskCompletionSource<object> completion;
        Entry entry;
        bool starts;
        lock (entries)
        {
            if (now >= nextCleanup)
            {
                foreach (var pair in entries.Where(pair => IsExpired(pair.Value, now)).ToArray()) entries.Remove(pair.Key);
                nextCleanup = now.AddSeconds(30);
            }
            if (entries.TryGetValue(key, out var found) && !IsExpired(found, now))
            {
                entry = found;
                if (entry.Fingerprint != fingerprint)
                    throw new TranslationPracticeException(409, "request_id_reused", "Mã yêu cầu đã được dùng cho nội dung khác.");
            }
            else
            {
                if (entries.Count >= 10000)
                    throw new TranslationPracticeException(503, "request_capacity", "Hệ thống đang bận. Vui lòng thử lại.");
                entries[key] = entry = new(fingerprint, now);
            }
            starts = entry.Pending is null;
            completion = entry.Pending ??= new(TaskCreationOptions.RunContinuationsAsynchronously);
        }

        if (starts)
        {
            // Keep the owner request scope alive while the operation completes, including after a disconnect.
            try
            {
                var value = await run(lifetime.ApplicationStopping);
                lock (entries)
                {
                    entry.Expires = time.GetUtcNow().AddMinutes(5);
                    completion.SetResult(value);
                }
            }
            catch (Exception error)
            {
                lock (entries)
                {
                    entry.Expires = time.GetUtcNow().AddMinutes(5);
                    entry.Pending = null;
                    completion.SetException(error);
                }
                return (T)await completion.Task;
            }
        }

        return (T)await completion.Task.WaitAsync(caller);
    }

    private static bool IsExpired(Entry entry, DateTimeOffset now) =>
        entry.Expires <= now && entry.Pending?.Task.IsCompleted != false;
}
