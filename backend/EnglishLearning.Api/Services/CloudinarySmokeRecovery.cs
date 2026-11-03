using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Services.CloudinaryMedia;

namespace EnglishLearning.Api.Services;

public static class CloudinarySmokeRecovery
{
    // Recovery is restricted to the exact fixture names in one recorded dev/test smoke run.
    public static async Task<CloudinarySmokeReport> RunAsync(CloudinarySettings settings, CloudinarySmokeReport previous,
        Func<string, ICloudinarySmokeClient>? createClient = null)
    {
        var checks = new List<CloudinarySmokeCheck>();
        var pending = new List<string>();
        var issues = new List<CloudinarySmokeCleanupIssue>();
        var assets = new List<CloudinarySmokeAsset>();
        try
        {
            if (previous.RunPrefix is null) throw new InvalidOperationException();
            CloudinaryEnvironmentSmoke.EnsureSmokePrefix(settings, previous.RunPrefix);
            if (previous.AssetsNeedingCleanup.Count is 0 or > 32) throw new InvalidOperationException();
            foreach (var id in previous.AssetsNeedingCleanup.Distinct())
            {
                assets.Add(CleanupAsset(previous.RunPrefix, id));
            }
        }
        catch (Exception)
        { return new("failed", DateTime.UtcNow, null, checks, [], "invalid_smoke_recovery_scope"); }

        try
        {
            using var client = createClient?.Invoke(previous.RunPrefix!) ?? new CloudinarySmokeClient(settings, previous.RunPrefix!);
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(90));
            foreach (var asset in assets)
            {
                try
                {
                    var removed = await DeleteWithRetryAsync(client, asset, deadline.Token);
                    checks.Add(new("recover_" + asset.ResourceType, removed));
                    if (!removed) { pending.Add(asset.PublicId); issues.Add(new(asset.PublicId, "cloudinary_cleanup_unconfirmed", null)); }
                }
                catch (Exception error)
                {
                    var safe = CloudinarySmokeFailure.FromException(error);
                    checks.Add(new("recover_" + asset.ResourceType, false, safe.HttpStatus));
                    pending.Add(asset.PublicId); issues.Add(new(asset.PublicId, safe.Code, safe.HttpStatus));
                }
            }
        }
        catch (Exception error)
        {
            var safe = CloudinarySmokeFailure.FromException(error);
            pending.AddRange(assets.Select(asset => asset.PublicId));
            issues.AddRange(assets.Select(asset => new CloudinarySmokeCleanupIssue(asset.PublicId, safe.Code, safe.HttpStatus)));
        }
        return new(pending.Count == 0 ? "passed" : "failed", DateTime.UtcNow, previous.RunPrefix, checks, pending,
            pending.Count == 0 ? null : "cloudinary_cleanup_recovery_failed", CleanupIssues: issues)
        { CleanupTargets = assets.Select(asset => asset.PublicId).ToArray() };
    }

    // Caller must first validate runPrefix against the configured dev/test smoke namespace.
    public static CloudinarySmokeAsset CleanupAsset(string runPrefix, string id)
    {
        if (id == runPrefix + "/image") return new(id, "image", "png", "");
        if (id == runPrefix + "/audio") return new(id, "video", "ogg", "");
        if (id == runPrefix + "/manifest.json") return new(id, "raw", "json", "");
        var names = new CloudMediaNames(runPrefix);
        var suffix = id.StartsWith(runPrefix + "/", StringComparison.Ordinal) ? id[(runPrefix.Length + 1)..] : "";
        var type = suffix.StartsWith("courses/covers/", StringComparison.Ordinal) ? "image" :
            suffix.StartsWith("courses/audio/", StringComparison.Ordinal) || suffix.StartsWith("dictionary/audio/", StringComparison.Ordinal) ? "video" : "raw";
        try { names.EnsureOwned(id, type); }
        catch (CloudMediaException) { throw new InvalidOperationException("Refusing cleanup outside this exact smoke namespace."); }
        return new(id, type, "", ""); // Destroy uses the exact ID/type, not format or a delivery URL.
    }

    public static async Task<bool> DeleteWithRetryAsync(ICloudinarySmokeClient client, CloudinarySmokeAsset asset, CancellationToken token)
    {
        for (var attempt = 0; ; attempt++)
        {
            token.ThrowIfCancellationRequested();
            try { return await client.DeleteAsync(asset, token); }
            catch (Exception error)
            {
                var safe = CloudinarySmokeFailure.FromException(error);
                var transient = safe.Code is "cloudinary_request_timeout_or_cancelled" or "cloudinary_connection_failed" or
                    "cloudinary_dns_failed" or "cloudinary_http_request_failed" or "cloudinary_stream_failed" or
                    "cloudinary_service_unavailable" or "cloudinary_rate_limited";
                if (!transient || attempt >= 2 || token.IsCancellationRequested) throw safe;
                await Task.Delay(TimeSpan.FromMilliseconds(250 * (attempt + 1)), token);
            }
        }
    }
}
