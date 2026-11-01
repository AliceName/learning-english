using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using EnglishLearning.Api.Configuration;

namespace EnglishLearning.Api.Services;

public sealed record CloudinarySmokeCheck(string Name, bool Passed, int? HttpStatus = null);
public sealed record CloudinarySmokeCleanupIssue(string PublicId, string ErrorCode, int? HttpStatus);
public sealed record CloudinarySmokeRangeResponse(int HttpStatus, string? ContentRange, long? ContentLength, long ExpectedAssetLength);
public sealed record CloudinarySmokeDeliveryObservation(string Operation, string ResourceType, string Format,
    int? HttpStatus, long? ExpectedAssetLength, long? ContentLength);
public sealed record CloudinarySmokeAdapterFailure(string Stage, CloudinarySmokeDeliveryObservation? LastDelivery);
public sealed record CloudinarySmokeReport(string Status, DateTime TestedAtUtc, string? RunPrefix,
    IReadOnlyList<CloudinarySmokeCheck> Checks, IReadOnlyList<string> AssetsNeedingCleanup, string? ErrorCode,
    IReadOnlyList<string>? ConfigurationIssues = null, IReadOnlyList<CloudinarySmokeCleanupIssue>? CleanupIssues = null)
{
    public IReadOnlyDictionary<string, string>? ConfigurationSources { get; init; }
    public IReadOnlyDictionary<string, CloudinarySmokeRangeResponse>? AudioRangeResponses { get; init; }
    public IReadOnlyList<string>? CapabilityNotes { get; init; }
    public CloudinarySmokeAdapterFailure? AdapterFailure { get; init; }
    public IReadOnlyList<string>? CleanupTargets { get; init; }
}

public static class CloudinaryEnvironmentSmoke
{
    public static void EnsureSmokePrefix(CloudinarySettings settings, string runPrefix)
    {
        CloudinarySettingsValidator.EnsureEnabledAndValid(settings);
        if (!Regex.IsMatch(settings.EnvironmentPrefix, @"\Aels/(dev|test)(/|\z)") ||
            !Regex.IsMatch(runPrefix, "\\A" + Regex.Escape(settings.EnvironmentPrefix) + @"/smoke/[a-f0-9]{32}\z"))
            throw new InvalidOperationException("Smoke tests only run in an isolated els/dev or els/test namespace.");
    }

    public static async Task<CloudinarySmokeReport> RunAsync(CloudinarySettings settings,
        Func<string, ICloudinarySmokeClient>? createClient = null, CancellationToken token = default)
    {
        var checks = new List<CloudinarySmokeCheck>();
        var cleanup = new List<string>();
        var cleanupIssues = new List<CloudinarySmokeCleanupIssue>();
        var ranges = new Dictionary<string, CloudinarySmokeRangeResponse>();
        var notes = new List<string>();
        int? failureStatus = null;
        string? prefix = null, errorCode = null;
        try
        {
            prefix = settings.EnvironmentPrefix + "/smoke/" + Guid.NewGuid().ToString("N");
            EnsureSmokePrefix(settings, prefix);
        }
        catch (Microsoft.Extensions.Options.OptionsValidationException error)
        { return new("not_configured", DateTime.UtcNow, null, checks, cleanup, "cloudinary_configuration_required", error.Failures.ToArray()); }
        catch (InvalidOperationException)
        { return new("not_configured", DateTime.UtcNow, null, checks, cleanup, "cloudinary_smoke_namespace_required", ["Use an isolated els/dev or els/test smoke namespace."]); }

        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromMinutes(4));
        ICloudinarySmokeClient? client = null;
        var attempted = new List<CloudinarySmokeAsset>();
        var currentCheck = "create_client";
        try
        {
            client = createClient?.Invoke(prefix) ?? new CloudinarySmokeClient(settings, prefix);
            foreach (var file in Fixtures())
            {
                var id = prefix + "/" + (file.ResourceType == "raw" ? "manifest.json" : file.Name);
                var pending = new CloudinarySmokeAsset(id, file.ResourceType, file.Format, "");
                // Include an attempted ID even if the upload response is lost after Cloudinary accepted it.
                attempted.Add(pending);
                currentCheck = "upload_" + file.ResourceType;
                var asset = await client.UploadAsync(file, id, deadline.Token);
                Record(checks, "upload_" + file.ResourceType, true);

                currentCheck = "signed_stream_" + file.ResourceType;
                using (var response = await client.ReadAsync(client.DeliveryUrl(asset, true), null, deadline.Token))
                {
                    var bytes = await LimitedBodyAsync(response, file.Bytes.Length + 1024, deadline.Token);
                    Record(checks, "signed_stream_" + file.ResourceType,
                        response.StatusCode == HttpStatusCode.OK && bytes.AsSpan().SequenceEqual(file.Bytes), (int)response.StatusCode);
                }
                foreach (var publicPath in new[] { false, true })
                {
                    currentCheck = (publicPath ? "public_path_denied_" : "unsigned_authenticated_denied_") + file.ResourceType;
                    using var anonymous = await client.ReadAsync(client.DeliveryUrl(asset, false, publicPath), null, deadline.Token);
                    Record(checks, (publicPath ? "public_path_denied_" : "unsigned_authenticated_denied_") + file.ResourceType,
                        anonymous.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden or HttpStatusCode.NotFound, (int)anonymous.StatusCode);
                }
                if (file.ResourceType == "video")
                {
                    currentCheck = "audio_range_206";
                    using var range = await client.ReadAsync(client.DeliveryUrl(asset, true), new RangeHeaderValue(0, 31), deadline.Token);
                    ranges["satisfiable"] = ObserveRange(range, file.Bytes.Length);
                    var bytes = await LimitedBodyAsync(range, 1024, deadline.Token);
                    var contentRange = range.Content.Headers.ContentRange;
                    Record(checks, "audio_range_206", range.StatusCode == HttpStatusCode.PartialContent &&
                        contentRange?.From == 0 && contentRange.To == 31 && contentRange.Length == file.Bytes.Length &&
                        range.Content.Headers.ContentLength == 32 && bytes.AsSpan().SequenceEqual(file.Bytes.AsSpan(0, 32)), (int)range.StatusCode);
                    currentCheck = "upstream_unsatisfiable_range";
                    using var invalidRange = await client.ReadAsync(client.DeliveryUrl(asset, true), new RangeHeaderValue(file.Bytes.Length + 10, null), deadline.Token);
                    ranges["unsatisfiable"] = ObserveRange(invalidRange, file.Bytes.Length);
                    var unsatisfied = invalidRange.Content.Headers.ContentRange;
                    var hasContentRange = invalidRange.Content.Headers.Contains("Content-Range");
                    // RFC 9110 recommends (SHOULD), rather than mandates, this upstream 416 header.
                    // Application endpoints must still produce bytes */<verified length> using manifest metadata.
                    var rejectedRange = invalidRange.StatusCode == HttpStatusCode.RequestedRangeNotSatisfiable &&
                        (!hasContentRange || unsatisfied is { Unit: "bytes", HasRange: false } && unsatisfied.Length == file.Bytes.Length);
                    var ignoredRange = false;
                    if (invalidRange.StatusCode == HttpStatusCode.OK && !hasContentRange)
                    {
                        // A server may ignore Range (RFC 9110 section 14.2). Verify it really sent the full original.
                        var whole = await LimitedBodyAsync(invalidRange, file.Bytes.Length + 1024, deadline.Token);
                        ignoredRange = whole.AsSpan().SequenceEqual(file.Bytes) && invalidRange.Content.Headers.ContentLength == file.Bytes.Length;
                    }
                    Record(checks, "upstream_unsatisfiable_range", rejectedRange || ignoredRange, (int)invalidRange.StatusCode);
                    if (ignoredRange)
                        notes.Add("cloudinary_ignores_unsatisfiable_range: returned the verified complete file with HTTP 200; application proxy must reject out-of-bounds ranges with HTTP 416 and bytes */<verified asset length> before upstream delivery.");
                    else if (!hasContentRange)
                        notes.Add("cloudinary_416_missing_content_range: application proxy must generate bytes */<verified asset length> from manifest metadata.");
                }
            }
        }
        catch (OperationCanceledException) { errorCode = "cloudinary_smoke_timeout_or_cancelled"; }
        catch (Exception error)
        {
            var safe = CloudinarySmokeFailure.FromException(error);
            errorCode = safe.Code; failureStatus = safe.HttpStatus;
        }
        finally
        {
            foreach (var asset in attempted.AsEnumerable().Reverse())
            {
                try
                {
                    if (client is null || !await client.DeleteAsync(asset))
                    {
                        cleanup.Add(asset.PublicId);
                        cleanupIssues.Add(new(asset.PublicId, "cloudinary_cleanup_unconfirmed", null));
                    }
                }
                catch (Exception error)
                {
                    var safe = CloudinarySmokeFailure.FromException(error);
                    cleanup.Add(asset.PublicId); cleanupIssues.Add(new(asset.PublicId, safe.Code, safe.HttpStatus));
                }
            }
            client?.Dispose();
        }
        if (errorCode is not null && !checks.Any(check => check.Name == currentCheck && !check.Passed))
            checks.Add(new(currentCheck, false, failureStatus));
        checks.Add(new("cleanup_owned_assets", cleanup.Count == 0));
        if (cleanup.Count > 0 && errorCode is null) errorCode = "cloudinary_smoke_cleanup_failed";
        return new(errorCode is null && cleanup.Count == 0 ? "passed" : "failed", DateTime.UtcNow, prefix, checks, cleanup, errorCode, CleanupIssues: cleanupIssues)
        { AudioRangeResponses = ranges, CapabilityNotes = notes };
    }

    private static CloudinarySmokeRangeResponse ObserveRange(HttpResponseMessage response, long expectedLength) =>
        new((int)response.StatusCode, response.Content.Headers.ContentRange?.ToString(), response.Content.Headers.ContentLength, expectedLength);

    private static void Record(List<CloudinarySmokeCheck> checks, string name, bool passed, int? status = null)
    {
        checks.Add(new(name, passed, status));
        if (!passed) throw new InvalidOperationException("Cloudinary smoke assertion failed.");
    }

    private static async Task<byte[]> LimitedBodyAsync(HttpResponseMessage response, int maxBytes, CancellationToken token)
    {
        if (response.Content.Headers.ContentLength > maxBytes) throw new InvalidOperationException("Unexpected smoke response size.");
        await using var stream = await response.Content.ReadAsStreamAsync(token);
        using var output = new MemoryStream();
        var buffer = new byte[1024]; int count;
        while ((count = await stream.ReadAsync(buffer, token)) > 0)
        {
            if (output.Length + count > maxBytes) throw new InvalidOperationException("Unexpected smoke response size.");
            output.Write(buffer, 0, count);
        }
        return output.ToArray();
    }

    public static IReadOnlyList<CloudinarySmokeFile> Fixtures()
    {
        using var audio = typeof(CloudinaryEnvironmentSmoke).Assembly.GetManifestResourceStream("EnglishLearning.Api.Resources.Cloudinary.smoke-match.ogg")
            ?? throw new InvalidOperationException("Missing embedded audio fixture.");
        using var buffer = new MemoryStream(); audio.CopyTo(buffer);
        var ogg = buffer.ToArray();
        if (Convert.ToHexStringLower(SHA256.HashData(ogg)) != "71bec08d01a0622ac95c4290aa256104cf11745f61b323f1e3e2f659a3bf5866")
            throw new InvalidOperationException("Unexpected embedded audio fixture.");
        return [
            new("image", "image", "png", Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=")),
            new("audio", "video", "ogg", ogg),
            new("manifest", "raw", "json", Encoding.UTF8.GetBytes("""{"schemaVersion":1,"purpose":"cloudinary-environment-smoke","sourceUrl":"https://commons.wikimedia.org/wiki/File:En-us-match.ogg","author":"Dvortygirl","license":"CC BY-SA 3.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/3.0/"}"""))
        ];
    }
}
