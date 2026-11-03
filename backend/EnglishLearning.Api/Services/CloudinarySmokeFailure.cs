using System.Net.Http;
using System.Security.Authentication;

namespace EnglishLearning.Api.Services;

// Only allowlisted codes/statuses leave the SDK boundary. Never retain its error message.
public sealed class CloudinarySmokeFailure(string code, int? httpStatus = null) : Exception(code)
{
    public string Code { get; } = code;
    public int? HttpStatus { get; } = httpStatus;

    public static CloudinarySmokeFailure FromResponse(string operation, int status, string? message)
    {
        var text = message ?? "";
        var code = status switch
        {
            401 => "cloudinary_authentication_failed",
            403 => "cloudinary_permission_denied",
            420 or 429 => "cloudinary_rate_limited",
            >= 500 => "cloudinary_service_unavailable",
            _ => operation == "cleanup" ? "cloudinary_cleanup_rejected" : "cloudinary_upload_rejected"
        };
        if (text.Contains("cloud_name", StringComparison.OrdinalIgnoreCase) || text.Contains("cloud name", StringComparison.OrdinalIgnoreCase))
            code = "cloudinary_invalid_cloud_name";
        else if (text.Contains("api_key", StringComparison.OrdinalIgnoreCase) || text.Contains("api key", StringComparison.OrdinalIgnoreCase))
            code = "cloudinary_invalid_api_key";
        else if (text.Contains("signature", StringComparison.OrdinalIgnoreCase))
            code = "cloudinary_invalid_signature_or_secret";
        else if (text.Contains("disabled", StringComparison.OrdinalIgnoreCase))
            code = "cloudinary_account_or_feature_disabled";
        return new(code, status is >= 100 and <= 599 ? status : null);
    }

    public static CloudinarySmokeFailure FromException(Exception error)
    {
        if (error is CloudinarySmokeFailure known) return known;
        var cause = error.GetBaseException();
        if (cause is AuthenticationException) return new("cloudinary_tls_failed");
        var request = error as HttpRequestException ?? cause as HttpRequestException;
        if (request is not null)
            return new(request.HttpRequestError switch
            {
                HttpRequestError.NameResolutionError => "cloudinary_dns_failed",
                HttpRequestError.ConnectionError => "cloudinary_connection_failed",
                HttpRequestError.SecureConnectionError => "cloudinary_tls_failed",
                _ => "cloudinary_http_request_failed"
            }, request.StatusCode is null ? null : (int)request.StatusCode);
        if (error is OperationCanceledException || cause is OperationCanceledException or TimeoutException) return new("cloudinary_request_timeout_or_cancelled");
        if (cause is IOException) return new("cloudinary_stream_failed");
        return new("cloudinary_smoke_operation_failed");
    }
}
