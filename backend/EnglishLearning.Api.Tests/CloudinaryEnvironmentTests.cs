using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Services;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Tests;

public sealed class CloudinaryEnvironmentTests
{
    private static CloudinarySettings Configured(string prefix = "els/test") => new()
    { Enabled = true, CloudName = "unit-test-cloud", ApiKey = "123456789012345", ApiSecret = "unit-test-secret-do-not-use", EnvironmentPrefix = prefix };

    [Theory]
    [InlineData(401, "Unknown API key 123456789012345", "cloudinary_invalid_api_key")]
    [InlineData(401, "Invalid Signature abc-secret-do-not-print", "cloudinary_invalid_signature_or_secret")]
    [InlineData(401, "Invalid cloud_name unit-test-cloud", "cloudinary_invalid_cloud_name")]
    [InlineData(403, "Operation not permitted", "cloudinary_permission_denied")]
    public void Sdk_errors_report_safe_codes_without_upstream_values(int status, string message, string expected)
    {
        var safe = CloudinarySmokeFailure.FromResponse("upload", status, message);
        Assert.Equal(expected, safe.Code); Assert.Equal(status, safe.HttpStatus);
        Assert.DoesNotContain("123456789012345", safe.Message); Assert.DoesNotContain("abc-secret-do-not-print", safe.Message);
    }

    [Fact]
    public async Task Authentication_errors_keep_status_and_cleanup_diagnostics_without_leaking_credentials()
    {
        var fake = new FakeSmokeClient { UploadFailure = new CloudinarySmokeFailure("cloudinary_invalid_api_key", 401),
            CleanupFailure = new CloudinarySmokeFailure("cloudinary_invalid_api_key", 401) };
        var report = await CloudinaryEnvironmentSmoke.RunAsync(Configured(), prefix => { fake.Prefix = prefix; return fake; });
        Assert.Equal("failed", report.Status); Assert.Equal("cloudinary_invalid_api_key", report.ErrorCode);
        Assert.Contains(report.Checks, check => check.Name == "upload_image" && check.HttpStatus == 401);
        Assert.Equal(401, Assert.Single(report.CleanupIssues!).HttpStatus);
    }

    [Fact]
    public void Disabled_client_does_not_require_cloud_credentials_or_switch_media()
    { Assert.True(new CloudinarySettingsValidator().Validate(null, new()).Succeeded); }

    [Fact]
    public void Enabled_client_rejects_missing_credentials_without_printing_their_values()
    {
        var settings = new CloudinarySettings { Enabled = true, ApiSecret = "sensitive test value" };
        var result = new CloudinarySettingsValidator().Validate(null, settings);
        Assert.True(result.Failed);
        Assert.Contains(result.Failures, failure => failure.Contains("CloudName"));
        Assert.DoesNotContain(settings.ApiSecret, string.Join(" ", result.Failures));
        Assert.Throws<OptionsValidationException>(() => CloudinaryClientFactory.Create(settings));
    }

    [Theory]
    [InlineData("els/test/../prod")]
    [InlineData("els/dev/")]
    [InlineData("another-project/test")]
    [InlineData("els/dev?x=1")]
    public void Unsafe_namespaces_are_rejected(string prefix) =>
        Assert.True(new CloudinarySettingsValidator().Validate(null, Configured(prefix)).Failed);

    [Theory]
    [InlineData("els/prod")]
    [InlineData("els/prod/region")]
    public async Task Smoke_cannot_upload_or_delete_in_production(string prefix)
    {
        var calls = 0;
        var report = await CloudinaryEnvironmentSmoke.RunAsync(Configured(prefix), _ => { calls++; throw new InvalidOperationException(); });
        Assert.Equal("not_configured", report.Status); Assert.Equal(0, calls);
    }

    [Fact]
    public async Task Missing_configuration_is_reported_as_not_run_rather_than_a_pass()
    {
        var report = await CloudinaryEnvironmentSmoke.RunAsync(new());
        Assert.Equal("not_configured", report.Status); Assert.Empty(report.Checks); Assert.Null(report.RunPrefix);
        Assert.Contains(report.ConfigurationIssues!, issue => issue.Contains("Cloudinary:Enabled"));
    }

    [Fact]
    public async Task Smoke_checks_three_authenticated_resource_types_audio_ranges_and_exact_cleanup()
    {
        var fake = new FakeSmokeClient();
        var report = await CloudinaryEnvironmentSmoke.RunAsync(Configured(), prefix => { fake.Prefix = prefix; return fake; });
        Assert.Equal("passed", report.Status); Assert.Equal(15, report.Checks.Count); Assert.All(report.Checks, check => Assert.True(check.Passed));
        Assert.Equal(3, fake.Uploads); Assert.Equal(3, fake.Deleted.Count); Assert.Empty(report.AssetsNeedingCleanup);
        Assert.All(fake.Deleted, id => Assert.StartsWith(report.RunPrefix + "/", id));
        Assert.DoesNotContain("unit-test-secret", JsonSerializer.Serialize(report));
    }

    [Fact]
    public async Task Anonymous_access_being_allowed_fails_smoke_and_still_cleans_only_attempted_ids()
    {
        var fake = new FakeSmokeClient { AllowAnonymous = true };
        var report = await CloudinaryEnvironmentSmoke.RunAsync(Configured(), prefix => { fake.Prefix = prefix; return fake; });
        Assert.Equal("failed", report.Status);
        Assert.Contains(report.Checks, check => check.Name == "unsigned_authenticated_denied_image" && !check.Passed);
        Assert.Single(fake.Deleted);
    }

    [Fact]
    public async Task Ignoring_range_is_not_reported_as_partial_content_support()
    {
        var fake = new FakeSmokeClient { IgnoreRanges = true };
        var report = await CloudinaryEnvironmentSmoke.RunAsync(Configured(), prefix => { fake.Prefix = prefix; return fake; });
        Assert.Equal("failed", report.Status); Assert.Contains(report.Checks, check => check.Name == "audio_range_206" && !check.Passed);
        Assert.Equal(2, fake.Deleted.Count);
    }

    [Fact]
    public async Task Recovery_deletes_only_recorded_fixture_ids_without_uploading()
    {
        var prefix = "els/test/smoke/" + Guid.NewGuid().ToString("N");
        var fake = new FakeSmokeClient { Prefix = prefix };
        var previous = new CloudinarySmokeReport("failed", DateTime.UtcNow, prefix, [], [prefix + "/image"], "lost_response");
        var report = await CloudinarySmokeRecovery.RunAsync(Configured(), previous, _ => fake);
        Assert.Equal("passed", report.Status); Assert.Equal(0, fake.Uploads);
        Assert.Equal(prefix + "/image", Assert.Single(fake.Deleted));
        Assert.Equal(previous.AssetsNeedingCleanup, report.CleanupTargets);
    }

    [Fact]
    public async Task Recovery_handles_exact_adapter_ids_and_retries_a_transient_lost_delete_response()
    {
        var prefix = "els/test/smoke/" + Guid.NewGuid().ToString("N");
        var ids = new[] { prefix + "/courses/covers/" + new string('a', 32),
            prefix + "/dictionary/audio/" + new string('b', 64), prefix + "/courses/references/" + new string('c', 32) + ".json" };
        var fake = new FakeSmokeClient { Prefix = prefix, TransientCleanupFailures = 1 };
        var previous = new CloudinarySmokeReport("failed", DateTime.UtcNow, prefix, [], ids, "adapter_smoke_cleanup_failed");
        var report = await CloudinarySmokeRecovery.RunAsync(Configured(), previous, _ => fake);
        Assert.Equal("passed", report.Status); Assert.Equal(0, fake.Uploads); Assert.Empty(report.AssetsNeedingCleanup);
        Assert.Equal(ids, report.CleanupTargets); Assert.Equal(4, fake.Deleted.Count);
        Assert.Equal(new[] { "image", "video", "raw" }, fake.DeletedTypes.Distinct());
    }

    [Theory]
    [InlineData(401, "cloudinary_invalid_api_key", 1)]
    [InlineData(503, "cloudinary_service_unavailable", 3)]
    public async Task Recovery_bounds_retries_and_never_retries_credentials(int status, string code, int expectedCalls)
    {
        var prefix = "els/test/smoke/" + Guid.NewGuid().ToString("N");
        var id = prefix + "/courses/covers/" + new string('a', 32);
        var fake = new FakeSmokeClient { Prefix = prefix, CleanupFailure = new CloudinarySmokeFailure(code, status) };
        var previous = new CloudinarySmokeReport("failed", DateTime.UtcNow, prefix, [], [id], "adapter_smoke_cleanup_failed");
        var report = await CloudinarySmokeRecovery.RunAsync(Configured(), previous, _ => fake);
        Assert.Equal("failed", report.Status); Assert.Equal(expectedCalls, fake.Deleted.Count);
        Assert.Equal(id, Assert.Single(report.AssetsNeedingCleanup)); Assert.Equal(status, Assert.Single(report.CleanupIssues!).HttpStatus);
    }

    [Fact]
    public void Nested_sdk_timeout_is_classified_without_leaking_provider_details()
    {
        var error = new TaskCanceledException("sensitive SDK response", new TimeoutException("signed URL must not leave boundary"));
        var safe = CloudinarySmokeFailure.FromException(error);
        Assert.Equal("cloudinary_request_timeout_or_cancelled", safe.Code);
        Assert.DoesNotContain("sensitive", safe.Message); Assert.DoesNotContain("signed URL", safe.Message);
    }

    [Fact]
    public async Task Cancelled_cleanup_does_not_start_a_cloud_request()
    {
        var fake = new FakeSmokeClient(); using var deadline = new CancellationTokenSource(); deadline.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => CloudinarySmokeRecovery.DeleteWithRetryAsync(fake,
            new("unused", "image", "", ""), deadline.Token));
        Assert.Empty(fake.Deleted);
    }

    [Theory]
    [InlineData("els/prod/smoke/11111111111111111111111111111111", "image")]
    [InlineData("els/test/smoke/11111111111111111111111111111111", "../course-image")]
    [InlineData("els/test/smoke/11111111111111111111111111111111", "unrelated")]
    [InlineData("els/test/smoke/11111111111111111111111111111111", "courses/covers/not-a-guid")]
    [InlineData("els/test/smoke/11111111111111111111111111111111", "courses/covers/../../production")]
    [InlineData("els/test/smoke/11111111111111111111111111111111", "dictionary/audio/too-short")]
    [InlineData("els/test/smoke/11111111111111111111111111111111", "courses/references/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json/extra")]
    public async Task Recovery_rejects_production_or_unexpected_names_before_contacting_cloud(string prefix, string name)
    {
        var calls = 0;
        var previous = new CloudinarySmokeReport("failed", DateTime.UtcNow, prefix, [], [prefix + "/" + name], "lost_response");
        var report = await CloudinarySmokeRecovery.RunAsync(Configured(), previous, _ => { calls++; throw new InvalidOperationException(); });
        Assert.Equal("failed", report.Status); Assert.Equal(0, calls);
    }

    [Fact]
    public async Task Missing_upstream_416_header_is_reported_as_a_proxy_requirement()
    {
        var fake = new FakeSmokeClient { Omit416Header = true };
        var report = await CloudinaryEnvironmentSmoke.RunAsync(Configured(), prefix => { fake.Prefix = prefix; return fake; });
        Assert.Equal("passed", report.Status);
        Assert.Contains(report.CapabilityNotes!, note => note.StartsWith("cloudinary_416_missing_content_range"));
        Assert.Null(report.AudioRangeResponses!["unsatisfiable"].ContentRange);
    }

    [Fact]
    public async Task Ignored_unsatisfiable_range_is_verified_and_recorded_for_proxy_handling()
    {
        var fake = new FakeSmokeClient { IgnoreUnsatisfiableRange = true };
        var report = await CloudinaryEnvironmentSmoke.RunAsync(Configured(), prefix => { fake.Prefix = prefix; return fake; });
        Assert.Equal("passed", report.Status);
        Assert.Contains(report.CapabilityNotes!, note => note.StartsWith("cloudinary_ignores_unsatisfiable_range"));
        Assert.Equal(200, report.AudioRangeResponses!["unsatisfiable"].HttpStatus);
        Assert.Contains(report.Checks, check => check.Name == "audio_range_206" && check.Passed);
    }

    [Fact]
    public async Task Incorrect_upstream_416_length_still_fails_and_is_recorded()
    {
        var fake = new FakeSmokeClient { Wrong416Length = true };
        var report = await CloudinaryEnvironmentSmoke.RunAsync(Configured(), prefix => { fake.Prefix = prefix; return fake; });
        Assert.Equal("failed", report.Status);
        Assert.Contains(report.Checks, check => check.Name == "upstream_unsatisfiable_range" && !check.Passed);
        Assert.Equal("bytes */1", report.AudioRangeResponses!["unsatisfiable"].ContentRange);
    }

    [Fact]
    public async Task Lost_upload_response_is_sanitized_and_the_attempted_id_is_cleaned()
    {
        var fake = new FakeSmokeClient { ThrowAfterUpload = true };
        var report = await CloudinaryEnvironmentSmoke.RunAsync(Configured(), prefix => { fake.Prefix = prefix; return fake; });
        Assert.Equal("failed", report.Status); Assert.Single(fake.Deleted);
        Assert.DoesNotContain("secret-in-upstream-error", JsonSerializer.Serialize(report));
    }

    [Fact]
    public async Task Failed_cleanup_is_visible_with_exact_owned_ids_for_recovery()
    {
        var fake = new FakeSmokeClient { FailCleanup = true };
        var report = await CloudinaryEnvironmentSmoke.RunAsync(Configured(), prefix => { fake.Prefix = prefix; return fake; });
        Assert.Equal("failed", report.Status); Assert.Equal(3, report.AssetsNeedingCleanup.Count);
        Assert.All(report.AssetsNeedingCleanup, id => Assert.StartsWith(report.RunPrefix + "/", id));
    }

    [Fact]
    public async Task Sdk_builds_https_signed_authenticated_urls_and_blocks_foreign_cleanup()
    {
        var prefix = "els/test/smoke/" + Guid.NewGuid().ToString("N");
        using var client = new CloudinarySmokeClient(Configured(), prefix);
        var image = new CloudinarySmokeAsset(prefix + "/image", "image", "png", "1");
        var raw = new CloudinarySmokeAsset(prefix + "/manifest.json", "raw", "json", "1");
        var signed = client.DeliveryUrl(image, true).AbsoluteUri;
        Assert.StartsWith("https://res.cloudinary.com/unit-test-cloud/image/authenticated/s--", signed);
        Assert.Contains("/v1/" + prefix + "/image.png", signed);
        Assert.EndsWith("/manifest.json", client.DeliveryUrl(raw, true).AbsoluteUri);
        Assert.DoesNotContain("s--", client.DeliveryUrl(image, false).AbsoluteUri);
        Assert.DoesNotContain("unit-test-secret", signed);
        await Assert.ThrowsAsync<InvalidOperationException>(() => client.DeleteAsync(image with { PublicId = "els/prod/existing-file" }));
    }

    private sealed class FakeSmokeClient : ICloudinarySmokeClient
    {
        public string Prefix = "";
        public int Uploads;
        public bool AllowAnonymous, IgnoreRanges, ThrowAfterUpload, FailCleanup;
        public bool Omit416Header, Wrong416Length, IgnoreUnsatisfiableRange;
        public Exception? UploadFailure, CleanupFailure;
        public int TransientCleanupFailures;
        public List<string> Deleted = [];
        public List<string> DeletedTypes = [];
        private readonly Dictionary<string, byte[]> bodies = [];
        public Task<CloudinarySmokeAsset> UploadAsync(CloudinarySmokeFile file, string id, CancellationToken token)
        {
            Assert.StartsWith(Prefix + "/", id); Uploads++; bodies[id] = file.Bytes;
            if (UploadFailure is not null) throw UploadFailure;
            if (ThrowAfterUpload) throw new HttpRequestException("secret-in-upstream-error");
            return Task.FromResult(new CloudinarySmokeAsset(id, file.ResourceType, file.Format, "1"));
        }
        public Uri DeliveryUrl(CloudinarySmokeAsset asset, bool signed, bool publicDelivery = false) =>
            new("https://unit.test/" + asset.PublicId + "?signed=" + (signed ? "yes" : "no"));
        public Task<HttpResponseMessage> ReadAsync(Uri uri, RangeHeaderValue? range, CancellationToken token)
        {
            if (uri.Query != "?signed=yes" && !AllowAnonymous)
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Unauthorized) { Content = new ByteArrayContent([]) });
            var bytes = bodies[uri.AbsolutePath[1..]];
            if (range is not null && !IgnoreRanges)
            {
                var from = range.Ranges.Single().From!.Value;
                if (from >= bytes.Length)
                {
                    if (IgnoreUnsatisfiableRange) return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) });
                    var invalid = new HttpResponseMessage(HttpStatusCode.RequestedRangeNotSatisfiable) { Content = new ByteArrayContent([]) };
                    if (!Omit416Header) invalid.Content.Headers.ContentRange = new ContentRangeHeaderValue(Wrong416Length ? 1 : bytes.Length);
                    return Task.FromResult(invalid);
                }
                var partial = new HttpResponseMessage(HttpStatusCode.PartialContent) { Content = new ByteArrayContent(bytes[..32]) };
                partial.Content.Headers.ContentRange = new ContentRangeHeaderValue(0, 31, bytes.Length);
                return Task.FromResult(partial);
            }
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) });
        }
        public Task<bool> DeleteAsync(CloudinarySmokeAsset asset, CancellationToken token = default)
        {
            token.ThrowIfCancellationRequested(); Assert.StartsWith(Prefix + "/", asset.PublicId);
            Deleted.Add(asset.PublicId); DeletedTypes.Add(asset.ResourceType);
            if (TransientCleanupFailures-- > 0) throw new HttpRequestException("Sensitive provider response must never be printed.");
            if (CleanupFailure is not null) throw CleanupFailure;
            return Task.FromResult(!FailCleanup);
        }
        public void Dispose() { }
    }
}
