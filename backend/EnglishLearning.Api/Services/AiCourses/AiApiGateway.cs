using System.Diagnostics;
using System.Text.Json;

namespace EnglishLearning.Api.Services.AiCourses;

public sealed class AiApiGateway(AiCourseStore store, TimeProvider time, ILogger<AiApiGateway> logger)
{
    public const string CallHeader = "X-Lewa-Ai-Call";
    public static DateTimeOffset DayStart(DateTimeOffset now) => new(now.ToOffset(TimeSpan.FromHours(7)).Date, TimeSpan.FromHours(7));

    public async Task<HttpResponseMessage> SendAsync(HttpClient client, HttpRequestMessage request,
        AiCallContext context, CancellationToken ct)
    {
        var call = await ReserveAsync(context, ct);
        var watch = Stopwatch.StartNew();
        HttpResponseMessage? response = null;
        try
        {
            response = await client.SendAsync(request, ct);
            var bytes = await response.Content.ReadAsByteArrayAsync(ct);
            call.HttpStatus = (int)response.StatusCode;
            call.Outcome = response.IsSuccessStatusCode ? "success" : "provider_error";
            call.ErrorCode = response.IsSuccessStatusCode ? null : "provider_http_" + call.HttpStatus;
            try
            {
                using var data = JsonDocument.Parse(bytes);
                if (data.RootElement.ValueKind == JsonValueKind.Object && data.RootElement.TryGetProperty("usageMetadata", out var usage)
                    && usage.ValueKind == JsonValueKind.Object)
                {
                    call.InputTokens = Token(usage, "promptTokenCount");
                    call.OutputTokens = Token(usage, "candidatesTokenCount");
                    call.ThoughtTokens = Token(usage, "thoughtsTokenCount");
                    call.TotalTokens = Token(usage, "totalTokenCount");
                }
            }
            catch (JsonException) { }
            call.FinishedAt = time.GetUtcNow();
            using (var gate = await store.LockAsync(ct))
            {
                store.Write(store.CallFile(call.Id), call);
                if ((int)response.StatusCode == 429)
                {
                    var policy = store.Read<AiApiPolicy>(store.PolicyFile) ?? new();
                    var wait = response.Headers.RetryAfter?.Delta ??
                        (response.Headers.RetryAfter?.Date is { } date ? date - time.GetUtcNow() : TimeSpan.FromSeconds(60));
                    var until = time.GetUtcNow().AddSeconds(Math.Clamp(wait.TotalSeconds, 1, 3600));
                    if (policy.CooldownUntil is null || until > policy.CooldownUntil) policy.CooldownUntil = until;
                    store.Write(store.PolicyFile, policy);
                }
            }
            response.Headers.Add(CallHeader, call.Id.ToString());
            logger.LogInformation("AI {Feature}/{Operation} completed with HTTP {Status} in {Milliseconds} ms.",
                call.Feature, call.Operation, call.HttpStatus, watch.ElapsedMilliseconds);
            return response;
        }
        catch (Exception failure) when (failure is HttpRequestException or OperationCanceledException or IOException)
        {
            response?.Dispose();
            call.Outcome = failure is OperationCanceledException ? "timeout_or_cancelled" : "unknown";
            call.ErrorCode = failure is OperationCanceledException ? "ai_timeout" : "ai_connection_failed";
            call.FinishedAt = time.GetUtcNow();
            using var recovery = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            try
            {
                using var gate = await store.LockAsync(recovery.Token);
                store.Write(store.CallFile(call.Id), call);
            }
            catch (Exception writeFailure) when (writeFailure is IOException or OperationCanceledException)
            { logger.LogWarning("AI call {Id} requires usage reconciliation.", call.Id); }
            throw;
        }
    }

    private async Task<AiApiCall> ReserveAsync(AiCallContext context, CancellationToken ct)
    {
        using var gate = await store.LockAsync(ct);
        var policy = store.Read<AiApiPolicy>(store.PolicyFile) ?? new();
        var now = time.GetUtcNow();
        var calls = store.Calls();
        var today = calls.Where(call => call.StartedAt >= DayStart(now)).ToArray();
        var recent = calls.Where(call => call.StartedAt > now.AddMinutes(-1)).ToArray();
        string? reason = null;
        var retry = 60;
        if (!policy.Enabled) reason = "ai_paused";
        else if (policy.CooldownUntil > now)
        {
            reason = "ai_provider_cooldown";
            retry = (int)Math.Ceiling((policy.CooldownUntil.Value - now).TotalSeconds);
        }
        else if (recent.Length >= policy.RequestsPerMinute)
        {
            reason = "ai_minute_limit";
            retry = Math.Max(1, (int)Math.Ceiling((recent.Min(call => call.StartedAt).AddMinutes(1) - now).TotalSeconds));
        }
        else if (today.Length >= policy.CallsPerDay ||
            context.UserId is int user && today.Count(call => call.UserId == user) >= policy.CallsPerUserPerDay)
        {
            reason = "ai_daily_limit";
            retry = (int)Math.Ceiling((DayStart(now).AddDays(1) - now).TotalSeconds);
        }
        else if (today.Sum(call => call.TotalTokens ?? call.ReservedTokens) + context.ReservedTokens > policy.TokensPerDay)
        {
            reason = "ai_token_limit";
            retry = (int)Math.Ceiling((DayStart(now).AddDays(1) - now).TotalSeconds);
        }
        if (reason is not null)
        {
            File.AppendAllText(Path.Combine(store.Root, "quota-decisions.jsonl"), JsonSerializer.Serialize(new {
                at = now, context.OperationId, context.GenerationId, context.UserId, context.Feature, reason, retry
            }, AiCourseStore.Json) + "\n");
            throw new AiCourseException(429, reason, "Hạn mức AI đang bận hoặc đã hết. Lần tạo được giữ để tiếp tục.", retry);
        }

        var call = new AiApiCall {
            OperationId = context.OperationId, GenerationId = context.GenerationId, UserId = context.UserId,
            Feature = context.Feature, Operation = context.Operation, Model = context.Model,
            AttemptNo = calls.Count(item => item.OperationId == context.OperationId) + 1,
            ReservedTokens = context.ReservedTokens, InputCharacters = context.InputCharacters,
            PolicyVersion = policy.Version, StartedAt = now
        };
        store.Write(store.CallFile(call.Id), call);
        return call;
    }

    public async Task MarkContentAsync(HttpResponseMessage response, string outcome, CancellationToken ct, decimal? audioSeconds = null,
        AiContentIssue? issue = null, string? finishReason = null)
    {
        if (!response.Headers.TryGetValues(CallHeader, out var values) || !Guid.TryParse(values.SingleOrDefault(), out var id)) return;
        using var gate = await store.LockAsync(ct);
        var call = store.Read<AiApiCall>(store.CallFile(id));
        if (call is null) return;
        call.ContentOutcome = outcome;
        call.AudioSeconds = audioSeconds;
        call.ContentFailureCode = issue?.Code;
        call.ContentFailurePath = issue?.Path;
        call.ProviderFinishReason = finishReason;
        store.Write(store.CallFile(id), call);
        if (issue is not null) logger.LogWarning("AI call {CallId} rejected: {Code} at {Path}; finish {FinishReason}.", call.Id, issue.Code, issue.Path, finishReason);
    }

    public async Task<AiApiPolicy> PolicyAsync(CancellationToken ct)
    {
        using var gate = await store.LockAsync(ct);
        return store.Read<AiApiPolicy>(store.PolicyFile) ?? new();
    }

    public async Task<AiApiPolicy> UpdatePolicyAsync(AiPolicyUpdate change, int actor, CancellationToken ct)
    {
        var policy = new AiApiPolicy {
            Enabled = change.Enabled, RequestsPerMinute = change.RequestsPerMinute,
            CallsPerDay = change.CallsPerDay, CallsPerUserPerDay = change.CallsPerUserPerDay, TokensPerDay = change.TokensPerDay
        };
        if (!System.ComponentModel.DataAnnotations.Validator.TryValidateObject(policy,
                new System.ComponentModel.DataAnnotations.ValidationContext(policy), [], true) ||
            string.IsNullOrWhiteSpace(change.Reason) || change.Reason.Length > 1000)
            throw new AiCourseException(400, "invalid_policy", "Kiểm tra giới hạn và nhập lý do thay đổi.");
        using var gate = await store.LockAsync(ct);
        var previous = store.Read<AiApiPolicy>(store.PolicyFile) ?? new();
        if (change.Version != previous.Version)
            throw new AiCourseException(409, "policy_changed", "Hạn mức đã được cập nhật. Hãy tải lại trang.");
        policy.Version = previous.Version + 1;
        policy.CooldownUntil = previous.CooldownUntil;
        // The audit record includes the accepted version so a failed final write remains identifiable.
        File.AppendAllText(Path.Combine(store.Root, "policy-changes.jsonl"), JsonSerializer.Serialize(new {
            at = time.GetUtcNow(), actor, previous, next = policy, reason = change.Reason.Trim()
        }, AiCourseStore.Json) + "\n");
        store.Write(store.PolicyFile, policy);
        return policy;
    }

    private static long? Token(JsonElement usage, string name) => usage.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var number) && number >= 0 ? number : null;
}
