using System.Net.Http;
using System.Security.Authentication;

namespace EnglishLearning.Api.Services.CloudinaryMedia;

public static class CloudMediaErrors
{
    public static CloudMediaException Response(int status, string? providerMessage = null)
    {
        var text = providerMessage ?? "";
        if (text.Contains("quota", StringComparison.OrdinalIgnoreCase) || text.Contains("bandwidth limit", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("storage limit", StringComparison.OrdinalIgnoreCase) || text.Contains("credit limit", StringComparison.OrdinalIgnoreCase))
            return new(503, "media_storage_quota_exceeded");
        return status switch
        {
            401 or 403 => new(503, "media_storage_credentials_or_permission"),
            420 or 429 => new(503, "media_storage_rate_limited", true, 10),
            404 => new(404, "media_asset_missing"),
            >= 500 => new(503, "media_storage_unavailable", true),
            _ => new(502, "media_storage_rejected")
        };
    }
    public static CloudMediaException Failure(Exception error, CancellationToken caller)
    {
        if (error is CloudMediaException known) return known;
        if (error is OperationCanceledException && caller.IsCancellationRequested) throw new OperationCanceledException(caller);
        if (error is OperationCanceledException) return new(504, "media_storage_timeout", true);
        if (error is HttpRequestException or IOException or AuthenticationException) return new(503, "media_storage_connection", true);
        return new(502, "media_storage_invalid_response");
    }
}
