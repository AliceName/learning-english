using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Services.CloudinaryMedia;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Services.MediaMigration;

public static class MediaCutoverCommand
{
    public static async Task<int> RunAsync(IConfiguration configuration, string contentRoot, CancellationToken token)
    {
        var reports = Path.GetFullPath(Path.Combine(contentRoot, "../../reports"));
        var mode = configuration["media-cutover"] ?? "probe";
        var stage = "load_migration_evidence";
        CloudinaryDotNet.Cloudinary? sdk = null;
        try
        {
            var settings = configuration.GetSection(CloudinarySettings.SectionName).Get<CloudinarySettings>() ?? new();
            var planPath = Path.GetFullPath(configuration["media-cutover-plan"] ?? Path.Combine(reports, "Cloudinary_media_migration_plan.json"));
            var plan = await ReadAsync<MediaMigrationPlan>(planPath, token);
            var verified = await ReadAsync<MediaMigrationReport>(Path.Combine(reports, "Cloudinary_media_migration_verify.json"), token);
            stage = "validate_migration_and_target";
            MediaCutoverEvidence.RequireMigration(plan, verified); MediaCutoverEvidence.RequireTarget(settings, plan);
            (CloudinaryMediaStore Store, ICloudinaryAssetTransport Remote) Cloud()
            {
                sdk ??= CloudinaryClientFactory.Create(settings);
                var remote = new CloudinaryAssetTransport(sdk, new DeliveryFactory(), Options.Create(settings));
                var options = configuration.GetSection(CloudinaryMediaOptions.SectionName).Get<CloudinaryMediaOptions>() ?? new();
                return (new(remote, Options.Create(settings), Options.Create(options), TimeProvider.System), remote);
            }
            if (mode == "worker")
            {
                stage = "worker_cloud_read";
                var worker = configuration["media-cutover-worker"];
                if (worker is not ("a" or "b" or "restart")) throw new MediaMigrationException("invalid_cutover_worker");
                var (store, remote) = Cloud(); using var owner = store;
                var result = await MediaCutoverWorker.RunAsync(worker, plan, verified, settings, store, remote, token);
                await MediaMigrationJson.WriteAsync(Path.Combine(reports, "Cloudinary_cutover_worker_" + worker + ".json"), result, token);
                Console.WriteLine(JsonSerializer.Serialize(new { result.Status, result.Worker, result.AssetsVerified, result.ErrorCode }));
                return result.Status == "passed" ? 0 : 1;
            }
            var backendUrl = configuration["media-cutover-backend"] ?? "http://localhost:5000";
            if (mode == "probe")
            {
                stage = "probe_backend_runtime";
                var runtime = await RuntimeAsync(backendUrl, settings, verified, token);
                stage = "probe_independent_workers";
                // Separate OS processes, with independent SDK clients, caches and lazy local readers.
                async Task Child(string worker)
                {
                    var executable = Environment.ProcessPath ?? throw new MediaMigrationException("cutover_executable_unavailable");
                    var start = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true,
                        WorkingDirectory = contentRoot, RedirectStandardOutput = true, RedirectStandardError = true };
                    if (string.Equals(Path.GetFileNameWithoutExtension(executable), "dotnet", StringComparison.OrdinalIgnoreCase)) start.ArgumentList.Add(Assembly.GetEntryAssembly()!.Location);
                    start.ArgumentList.Add("--media-cutover=worker"); start.ArgumentList.Add("--media-cutover-worker=" + worker);
                    start.ArgumentList.Add("--media-cutover-plan=" + planPath);
                    using var process = Process.Start(start) ?? throw new MediaMigrationException("cutover_worker_start_failed");
                    var stdout = process.StandardOutput.ReadToEndAsync(token); var stderr = process.StandardError.ReadToEndAsync(token);
                    try { await process.WaitForExitAsync(token); await stdout; await stderr; }
                    catch { if (!process.HasExited) process.Kill(); throw; }
                    if (process.ExitCode != 0) throw new MediaMigrationException("cutover_worker_failed_" + worker);
                }
                await Task.WhenAll(Child("a"), Child("b"));
                await Child("restart");
                var workers = await WorkersAsync(reports, token);
                if (workers[0].ProcessId == workers[1].ProcessId || workers[0].StartedAtUtc > workers[1].TestedAtUtc || workers[1].StartedAtUtc > workers[0].TestedAtUtc)
                    throw new MediaMigrationException("concurrent_process_proof_missing");
                await MediaMigrationJson.WriteAsync(Path.Combine(reports, "Cloudinary_cutover_probe.json"),
                    new { status = "passed", plan.PlanId, plan.SnapshotHash, runtime, workers, testedAtUtc = DateTime.UtcNow }, token);
                Console.WriteLine("Cutover probe passed: restarted API and three independent worker processes verified."); return 0;
            }
            if (mode == "accept")
            {
                stage = "accept_backend_runtime";
                var runtime = await RuntimeAsync(backendUrl, settings, verified, token);
                stage = "accept_browser_and_workers";
                var browserPath = Path.Combine(reports, "Cloudinary_cutover_browser.json");
                using var browser = JsonDocument.Parse(await File.ReadAllTextAsync(browserPath, token));
                var data = browser.RootElement;
                if (data.GetProperty("status").GetString() != "passed" || data.GetProperty("planId").GetString() != plan.PlanId ||
                    data.GetProperty("snapshotHash").GetString() != plan.SnapshotHash || data.GetProperty("assetsVerified").GetInt32() != plan.Snapshot.Assets.Count)
                    throw new MediaMigrationException("browser_media_verification_required");
                var seal = MediaCutoverEvidence.Accept(plan, verified, settings, runtime, await WorkersAsync(reports, token),
                    CloudMediaNames.Digest(await File.ReadAllBytesAsync(browserPath, token)), TimeProvider.System);
                await MediaMigrationJson.WriteAsync(Path.Combine(seal.Payload.BackupRoot, "cutover-migration-evidence.json"), verified, token);
                await MediaMigrationJson.WriteAsync(Path.Combine(reports, "Cloudinary_cutover_acceptance.json"), seal, token);
                await MediaMigrationJson.WriteAsync(Path.Combine(seal.Payload.BackupRoot, "cutover-acceptance.json"), seal, token);
                Console.WriteLine(JsonSerializer.Serialize(new { status = "cutover_verified", seal.Payload.PlanId, seal.Payload.AcceptedAtUtc,
                    seal.Payload.DeleteNotBeforeUtc, legacyCleanup = "deferred_rollback_window" }, MediaMigrationJson.Options));
                return 0;
            }
            if (mode is "cleanup-dry-run" or "cleanup")
            {
                stage = "load_cutover_acceptance";
                var seal = await ReadAsync<CutoverSeal>(Path.Combine(reports, "Cloudinary_cutover_acceptance.json"), token);
                stage = "validate_rollback_window";
                var state = MediaCutoverEvidence.CleanupState(seal, settings, plan, TimeProvider.System);
                if (state == "deferred_rollback_window")
                {
                    await MediaMigrationJson.WriteAsync(Path.Combine(reports, "Cloudinary_legacy_cleanup.json"),
                        new { status = state, seal.Payload.DeleteNotBeforeUtc, deletedFiles = Array.Empty<string>(), backupRetained = true,
                            adaptersAndLegacyConfiguration = "retained_until_rollback_window_and_followup_refactor" }, token);
                    Console.WriteLine(JsonSerializer.Serialize(new { status = state, seal.Payload.DeleteNotBeforeUtc, deletedFiles = 0 })); return 0;
                }
                stage = "cleanup_fresh_cloud_verification";
                await RuntimeAsync(backendUrl, settings, verified, token);
                var captured = await ReadAsync<MediaMigrationReport>(Path.Combine(seal.Payload.BackupRoot, "cutover-migration-evidence.json"), token);
                if (MediaMigrationJson.Digest(captured) != seal.Payload.MigrationVerifyHash) throw new MediaMigrationException("cutover_backup_evidence_changed");
                var (store, remote) = Cloud(); using var owner = store;
                var fresh = await MediaCutoverWorker.RunAsync("cleanup-check", plan, captured, settings, store, remote, token);
                if (fresh.Status != "passed") throw new MediaMigrationException("fresh_cloud_verification_required_for_cleanup");
                stage = "cleanup_source_preflight";
                var report = await MediaLegacyCleanup.RunAsync(plan, captured, seal, settings, fresh, mode == "cleanup", TimeProvider.System, token);
                await MediaMigrationJson.WriteAsync(Path.Combine(reports, "Cloudinary_legacy_cleanup.json"), report, token);
                Console.WriteLine(JsonSerializer.Serialize(new { report.Status, deletedFiles = report.DeletedFiles.Count }));
                return report.Status is "ready_for_cleanup" or "source_files_cleaned_code_retirement_pending" ? 0 : 1;
            }
            throw new MediaMigrationException("invalid_cutover_mode");
        }
        catch (Exception error)
        {
            var code = error is MediaMigrationException known ? known.Code : error is CloudMediaException cloud ? cloud.Code : error is OptionsValidationException ? "cloudinary_configuration_required" : error is OperationCanceledException ? "cutover_cancelled_or_deadline" : "cutover_command_failed";
            await MediaMigrationJson.WriteAsync(Path.Combine(reports, "Cloudinary_cutover_error.json"),
                new { status = "failed", mode, stage, errorCode = code, exceptionType = error.GetType().Name, testedAtUtc = DateTime.UtcNow }, CancellationToken.None);
            Console.WriteLine("Cutover did not pass: " + code); return 1;
        }
        finally { sdk?.Api.Client.Dispose(); }
    }
    public static async Task<T> ReadAsync<T>(string path, CancellationToken token)
    {
        try
        {
            if (new FileInfo(path).Length > 32 * 1024 * 1024) throw new MediaMigrationException("cutover_report_too_large");
            return JsonSerializer.Deserialize<T>(await File.ReadAllTextAsync(path, token), MediaMigrationJson.Options) ?? throw new MediaMigrationException("invalid_cutover_report");
        }
        catch (Exception error) when (error is FileNotFoundException or DirectoryNotFoundException)
        { throw new MediaMigrationException(typeof(T) == typeof(CutoverSeal) ? "cutover_acceptance_required_before_cleanup" : "cutover_evidence_report_missing"); }
        catch (JsonException) { throw new MediaMigrationException("invalid_cutover_report"); }
    }
    private static async Task<CutoverWorkerReport[]> WorkersAsync(string reports, CancellationToken token) =>
        await Task.WhenAll(new[] { "a", "b", "restart" }.Select(worker => ReadAsync<CutoverWorkerReport>(Path.Combine(reports, "Cloudinary_cutover_worker_" + worker + ".json"), token)));
    private static async Task<MediaRuntimeStatus> RuntimeAsync(string baseUrl, CloudinarySettings settings, MediaMigrationReport verified, CancellationToken token)
    {
        using var http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(10) };
        return await MediaCutoverRuntimeProbe.ReadAsync(http, baseUrl, settings, verified, token);
    }
    private sealed class DeliveryFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false,
            AutomaticDecompression = System.Net.DecompressionMethods.None }) { Timeout = Timeout.InfiniteTimeSpan };
    }
}
