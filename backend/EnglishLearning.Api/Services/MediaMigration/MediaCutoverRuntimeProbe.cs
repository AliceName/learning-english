using System.Text.Json;
using EnglishLearning.Api.Configuration;

namespace EnglishLearning.Api.Services.MediaMigration;

public static class MediaCutoverRuntimeProbe
{
    public static async Task<MediaRuntimeStatus> ReadAsync(HttpClient http, string baseUrl, CloudinarySettings settings,
        MediaMigrationReport verified, CancellationToken token)
    {
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(uri.UserInfo))
            throw new MediaMigrationException("invalid_backend_url");
        try
        {
            using var response = await http.GetAsync(new Uri(uri, "/api/v1/health/media"), token);
            if (response.StatusCode == System.Net.HttpStatusCode.NotFound) throw new MediaMigrationException("restart_backend_with_cutover_code_required");
            if (!response.IsSuccessStatusCode) throw new MediaMigrationException("backend_media_health_unavailable");
            var status = JsonSerializer.Deserialize<MediaRuntimeStatus>(await response.Content.ReadAsStringAsync(token), MediaMigrationJson.Options);
            if (status is null || status.Revision != "cloud-cutover-v1" || status.Mode != "cloud-only" || status.TargetHash != MediaRuntimeState.TargetHash(settings))
                throw new MediaMigrationException("backend_is_not_cloud_only_or_target_differs");
            if (status.StartedAtUtc <= verified.TestedAtUtc) throw new MediaMigrationException("backend_restart_after_migration_required");
            return status;
        }
        catch (HttpRequestException error)
        {
            throw new MediaMigrationException(error.HttpRequestError == HttpRequestError.SecureConnectionError
                ? "backend_tls_validation_failed" : "backend_unreachable");
        }
        catch (OperationCanceledException) when (!token.IsCancellationRequested) { throw new MediaMigrationException("backend_health_timeout"); }
        catch (JsonException) { throw new MediaMigrationException("backend_media_health_invalid_json"); }
    }
}
