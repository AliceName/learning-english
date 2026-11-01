using System.Text.Json;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Services;
using EnglishLearning.Api.Services.CloudinaryMedia;
using EnglishLearning.Api.Services.MediaMigration;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Tests;

public sealed class MediaCutoverTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "englishlearning-audio-tests-" + Guid.NewGuid().ToString("N"));
    private readonly CloudinarySettings settings = new() { Enabled = true, CloudName = "unit-cloud", ApiKey = "123456789012345", ApiSecret = "unit-secret-not-real", EnvironmentPrefix = "els/test" };
    private readonly Clock clock = new(new DateTimeOffset(2026, 10, 28, 1, 0, 0, TimeSpan.Zero));
    private readonly MemoryCloudTransport remote = new();
    private static byte[] Png => CloudinaryEnvironmentSmoke.Fixtures().Single(file => file.ResourceType == "image").Bytes;
    private CloudinaryMediaStore Cloud() => new(remote, Options.Create(settings), Options.Create(new CloudinaryMediaOptions()), TimeProvider.System);
    public void Dispose() => AudioFixture.RemoveTestRoot(root);
    private (MediaMigrationPlan Plan, MediaMigrationReport Verify, MediaRuntimeStatus Runtime, CutoverWorkerReport[] Workers) Evidence()
    {
        var name = new string('a', 32) + ".jpg"; var sha = CloudMediaNames.Digest(Png);
        var file = new MigrationFile("course", name, Png.Length, sha);
        var asset = new MigrationAsset(CloudMediaKind.CourseCover, new string('a', 32), "jpg", "image/jpeg", Png.Length, sha, file.Id, null, "/api/media/" + name, null);
        // JPEG identity for cleanup tests; cloud byte-worker test replaces this with a PNG identity.
        var snapshot = new MigrationSnapshot(Path.Combine(root, "dictionary"), Path.Combine(root, "course"), settings.EnvironmentPrefix,
            CloudMediaNames.Digest(System.Text.Encoding.UTF8.GetBytes(settings.CloudName)), [file], [asset], new(true, MediaMigrationJson.Digest("refs"), [], []), []);
        var plan = new MediaMigrationPlan(1, Guid.NewGuid().ToString("N"), clock.Now.UtcDateTime.AddHours(-2), MediaMigrationJson.Digest(snapshot), snapshot);
        var backup = Path.Combine(root, "backup", plan.PlanId);
        var verified = new MediaMigrationReport("verify", "verified", clock.Now.UtcDateTime.AddHours(-1), plan.PlanId, plan.SnapshotHash, backup,
            [new(asset.Reference, asset.Kind, "verified", SourceFile: asset.SourceFile, Sha256: sha, SizeBytes: Png.Length, LegacyUrl: asset.LegacyUrl)],
            [new(file.Id, "verified", Path.Combine(backup, file.Id))], [], true, true);
        var runtime = new MediaRuntimeStatus("cloud-cutover-v1", "cloud-only", MediaRuntimeState.TargetHash(settings), Guid.NewGuid().ToString("N"), clock.Now.UtcDateTime.AddMinutes(-40));
        var workers = new[] { "a", "b", "restart" }.Select((worker, index) => new CutoverWorkerReport("passed", worker, plan.PlanId, plan.SnapshotHash,
            Guid.NewGuid().ToString("N"), 10 + index, clock.Now.UtcDateTime.AddMinutes(-30), clock.Now.UtcDateTime.AddMinutes(-10), 1, false, ["verified"], null)).ToArray();
        return (plan, verified, runtime, workers);
    }

    [Fact]
    public async Task Cloud_only_miss_never_resolves_legacy_readers()
    {
        using var store = Cloud(); var resolved = 0;
        var dictionary = new CloudinaryDictionaryAudioStorage(() => store, () => { resolved++; throw new InvalidOperationException(); }, Options.Create(settings), Options.Create(new DictionaryAudioSettings()));
        var course = new CloudinaryCourseMediaStorage(() => store, () => remote, () => { resolved++; throw new InvalidOperationException(); }, Options.Create(settings));
        Assert.Null(await dictionary.FindAsync(new string('b', 64), default)); Assert.Null(await course.OpenAsync(new string('a', 32) + ".jpg", null, default));
        Assert.False(await course.ExistsAsync("/api/media/" + new string('a', 32) + ".jpg", "image/", default)); Assert.Equal(0, resolved); Assert.False(Directory.Exists(root));
    }

    [Fact]
    public async Task Disabled_cloud_without_explicit_rollback_is_unavailable_not_local_fallback()
    {
        settings.Enabled = false; using var store = Cloud(); var resolved = 0;
        var dictionary = new CloudinaryDictionaryAudioStorage(() => store, () => { resolved++; throw new InvalidOperationException(); }, Options.Create(settings), Options.Create(new DictionaryAudioSettings()));
        var course = new CloudinaryCourseMediaStorage(() => store, () => remote, () => { resolved++; throw new InvalidOperationException(); }, Options.Create(settings));
        Assert.Equal(503, (await Assert.ThrowsAsync<VocabularyException>(() => dictionary.FindAsync(new string('b', 64), default))).StatusCode);
        Assert.Equal(503, (await Assert.ThrowsAsync<AuthoringException>(() => course.OpenAsync(new string('a', 32) + ".jpg", null, default))).Status); Assert.Equal(0, resolved);
    }

    [Fact]
    public async Task Cloud_failure_does_not_instantiate_legacy_reader()
    {
        var dictionary = new CloudinaryDictionaryAudioStorage(() => throw new CloudMediaException(503, "media_storage_unavailable", true),
            () => throw new InvalidOperationException("Legacy must not be resolved"), Options.Create(settings), Options.Create(new DictionaryAudioSettings()));
        var error = await Assert.ThrowsAsync<CloudMediaException>(() => dictionary.FindAsync(new string('b', 64), default)); Assert.Equal("media_storage_unavailable", error.Code);
    }

    [Fact]
    public async Task Independent_cold_workers_read_shared_cloud_bytes_without_local_directories()
    {
        var (plan, verified, _, _) = Evidence();
        var file = plan.Snapshot.Files[0] with { RelativePath = new string('a', 32) + ".png" };
        var asset = plan.Snapshot.Assets[0] with { Format = "png", ContentType = "image/png", SourceFile = file.Id, LegacyUrl = "/api/media/" + file.RelativePath };
        var snapshot = plan.Snapshot with { Files = [file], Assets = [asset] };
        plan = plan with { Snapshot = snapshot, SnapshotHash = MediaMigrationJson.Digest(snapshot) };
        verified = verified with { SnapshotHash = plan.SnapshotHash, Assets = [verified.Assets[0] with { SourceFile = file.Id, LegacyUrl = asset.LegacyUrl }], Files = [verified.Files[0] with { File = file.Id }] };
        using (var initial = Cloud()) await initial.StoreAsync(asset.Kind, asset.Reference, Png, "png", null, default);
        using var first = Cloud(); using var second = Cloud();
        var results = await Task.WhenAll(MediaCutoverWorker.RunAsync("a", plan, verified, settings, first, remote, default),
            MediaCutoverWorker.RunAsync("b", plan, verified, settings, second, remote, default));
        Assert.All(results, result => { Assert.Equal("passed", result.Status); Assert.False(result.LegacyReaderResolved); Assert.Equal(1, result.AssetsVerified); });
        Assert.NotEqual(results[0].InstanceId, results[1].InstanceId); Assert.False(Directory.Exists(root));
    }

    [Fact]
    public void Runtime_diagnostics_expose_no_account_key_or_secret_and_instances_are_distinct()
    {
        var one = new MediaRuntimeState(Options.Create(settings)).Status(); var two = new MediaRuntimeState(Options.Create(settings)).Status();
        Assert.Equal("cloud-only", one.Mode); Assert.NotEqual(one.InstanceId, two.InstanceId);
        var json = JsonSerializer.Serialize(one); Assert.DoesNotContain(settings.ApiKey, json); Assert.DoesNotContain(settings.ApiSecret, json); Assert.DoesNotContain(settings.CloudName, json);
    }

    [Theory]
    [InlineData("connection", "backend_unreachable")]
    [InlineData("tls", "backend_tls_validation_failed")]
    [InlineData("timeout", "backend_health_timeout")]
    [InlineData("old-api", "restart_backend_with_cutover_code_required")]
    [InlineData("server-error", "backend_media_health_unavailable")]
    [InlineData("html", "backend_media_health_invalid_json")]
    public async Task Runtime_probe_reports_actionable_errors_without_leaking_response_or_transport_details(string failure, string code)
    {
        var (_, verified, _, _) = Evidence();
        using var http = new HttpClient(new ProbeHandler((_, _) => failure switch
        {
            "connection" => throw new HttpRequestException(HttpRequestError.ConnectionError, "sensitive transport detail"),
            "tls" => throw new HttpRequestException(HttpRequestError.SecureConnectionError, "sensitive certificate detail"),
            "timeout" => throw new TaskCanceledException("sensitive timeout detail"),
            "old-api" => Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.NotFound)),
            "server-error" => Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.InternalServerError)),
            _ => Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = new StringContent("<html>sensitive response</html>") })
        }));
        var error = await Assert.ThrowsAsync<MediaMigrationException>(() => MediaCutoverRuntimeProbe.ReadAsync(http, "http://localhost:5000", settings, verified, default));
        Assert.Equal(code, error.Code); Assert.DoesNotContain("sensitive", error.Message); Assert.Null(error.InnerException);
    }

    [Fact]
    public async Task Runtime_probe_reads_current_health_and_preserves_caller_cancellation()
    {
        var (_, verified, runtime, _) = Evidence();
        using var http = new HttpClient(new ProbeHandler((request, _) =>
        {
            Assert.Equal("/api/v1/health/media", request.RequestUri!.AbsolutePath);
            return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK)
                { Content = new StringContent(JsonSerializer.Serialize(runtime, MediaMigrationJson.Options)) });
        }));
        Assert.Equal(runtime, await MediaCutoverRuntimeProbe.ReadAsync(http, "http://localhost:5000", settings, verified, default));
        using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => MediaCutoverRuntimeProbe.ReadAsync(http, "http://localhost:5000", settings, verified, cancelled.Token));
    }

    [Fact]
    public async Task Cleanup_without_acceptance_has_specific_error_and_creates_no_files()
    {
        var error = await Assert.ThrowsAsync<MediaMigrationException>(() => MediaCutoverCommand.ReadAsync<CutoverSeal>(Path.Combine(root, "missing-acceptance.json"), default));
        Assert.Equal("cutover_acceptance_required_before_cleanup", error.Code); Assert.False(Directory.Exists(root));
    }

    private sealed class ProbeHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => send(request, cancellationToken);
    }

    [Fact]
    public void Cleanup_window_is_seven_days_from_accepted_cutover_and_cannot_be_shortened_in_json()
    {
        var (plan, verified, runtime, workers) = Evidence();
        var seal = MediaCutoverEvidence.Accept(plan, verified, settings, runtime, workers, MediaMigrationJson.Digest("browser"), clock);
        Assert.Equal("deferred_rollback_window", MediaCutoverEvidence.CleanupState(seal, settings, plan, clock));
        clock.Now = clock.Now.AddDays(7).AddTicks(-1); Assert.Equal("deferred_rollback_window", MediaCutoverEvidence.CleanupState(seal, settings, plan, clock));
        clock.Now = clock.Now.AddTicks(1); Assert.Equal("eligible_for_fresh_verification", MediaCutoverEvidence.CleanupState(seal, settings, plan, clock));
        var forged = seal with { Payload = seal.Payload with { DeleteNotBeforeUtc = seal.Payload.AcceptedAtUtc } };
        Assert.Throws<MediaMigrationException>(() => MediaCutoverEvidence.CleanupState(forged, settings, plan, clock));
    }

    [Fact]
    public void Wrong_target_secret_legacy_mode_or_incomplete_restart_evidence_blocks_acceptance()
    {
        var (plan, verified, runtime, workers) = Evidence();
        Assert.Throws<MediaMigrationException>(() => MediaCutoverEvidence.Accept(plan, verified, settings, runtime, workers[..2], "hash", clock));
        Assert.Throws<MediaMigrationException>(() => MediaCutoverEvidence.Accept(plan, verified, settings, runtime with { StartedAtUtc = verified.TestedAtUtc }, workers, "hash", clock));
        var seal = MediaCutoverEvidence.Accept(plan, verified, settings, runtime, workers, "hash", clock);
        settings.ApiSecret = "another-unit-secret"; Assert.Throws<MediaMigrationException>(() => MediaCutoverEvidence.CleanupState(seal, settings, plan, clock));
        settings.AllowLegacyReads = true; Assert.Throws<MediaMigrationException>(() => MediaCutoverEvidence.Accept(plan, verified, settings, runtime, workers, "hash", clock));
    }

    [Fact]
    public async Task Execute_cleanup_before_window_does_not_touch_a_source_file()
    {
        var (plan, verified, runtime, workers) = Evidence(); var seal = MediaCutoverEvidence.Accept(plan, verified, settings, runtime, workers, "hash", clock);
        Directory.CreateDirectory(plan.Snapshot.CourseRoot); var source = Path.Combine(plan.Snapshot.CourseRoot, plan.Snapshot.Files[0].RelativePath); await File.WriteAllBytesAsync(source, Png);
        var result = await MediaLegacyCleanup.RunAsync(plan, verified, seal, settings, workers[0], true, clock, default);
        Assert.Equal("deferred_rollback_window", result.Status); Assert.Empty(result.DeletedFiles); Assert.Equal(Png, await File.ReadAllBytesAsync(source));
    }

    [Fact]
    public async Task After_window_cleanup_deletes_only_verified_targets_and_keeps_backup_and_extra_files()
    {
        var (plan, verified, runtime, workers) = Evidence(); var seal = MediaCutoverEvidence.Accept(plan, verified, settings, runtime, workers, "hash", clock);
        Directory.CreateDirectory(plan.Snapshot.CourseRoot); var source = Path.Combine(plan.Snapshot.CourseRoot, plan.Snapshot.Files[0].RelativePath); await File.WriteAllBytesAsync(source, Png);
        var backup = verified.Files[0].BackupPath!; Directory.CreateDirectory(Path.GetDirectoryName(backup)!); await File.WriteAllBytesAsync(backup, Png);
        var extra = Path.Combine(plan.Snapshot.CourseRoot, "new-file.txt"); await File.WriteAllTextAsync(extra, "Do not delete");
        clock.Now = clock.Now.AddDays(7);
        var fresh = workers[0] with { TestedAtUtc = clock.Now.UtcDateTime };
        var result = await MediaLegacyCleanup.RunAsync(plan, verified, seal, settings, fresh, true, clock, default);
        Assert.Equal("partial_unplanned_files_preserved", result.Status); Assert.Single(result.DeletedFiles); Assert.False(File.Exists(source));
        Assert.True(File.Exists(backup)); Assert.True(File.Exists(extra));
    }

    [Fact]
    public async Task A_changed_source_after_retention_is_preserved_instead_of_deleted()
    {
        var (plan, verified, runtime, workers) = Evidence(); var seal = MediaCutoverEvidence.Accept(plan, verified, settings, runtime, workers, "hash", clock);
        Directory.CreateDirectory(plan.Snapshot.CourseRoot); var source = Path.Combine(plan.Snapshot.CourseRoot, plan.Snapshot.Files[0].RelativePath);
        var changed = Png.ToArray(); changed[^1] ^= 1; await File.WriteAllBytesAsync(source, changed);
        var backup = verified.Files[0].BackupPath!; Directory.CreateDirectory(Path.GetDirectoryName(backup)!); await File.WriteAllBytesAsync(backup, Png);
        clock.Now = clock.Now.AddDays(7);
        await Assert.ThrowsAsync<MediaMigrationException>(() => MediaLegacyCleanup.RunAsync(plan, verified, seal, settings,
            workers[0] with { TestedAtUtc = clock.Now.UtcDateTime }, true, clock, default));
        Assert.Equal(changed, await File.ReadAllBytesAsync(source)); Assert.Equal(Png, await File.ReadAllBytesAsync(backup));
    }

    private sealed class Clock(DateTimeOffset now) : TimeProvider
    { public DateTimeOffset Now = now; public override DateTimeOffset GetUtcNow() => Now; }
}
