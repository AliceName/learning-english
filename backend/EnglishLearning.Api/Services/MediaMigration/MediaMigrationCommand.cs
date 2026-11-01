using System.Text.Json;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Services.CloudinaryMedia;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Services.MediaMigration;

public static class MediaMigrationCommand
{
    public static async Task<int> RunAsync(IConfiguration configuration, string contentRoot, CancellationToken token)
    {
        var workspace = Path.GetFullPath(Path.Combine(contentRoot, "../.."));
        var reports = Path.Combine(workspace, "reports");
        var planPath = Path.GetFullPath(configuration["media-migration-plan"] ?? Path.Combine(reports, "Cloudinary_media_migration_plan.json"));
        var mode = (configuration["media-migration"] ?? "dry-run").ToLowerInvariant();
        MediaMigrationPlan? plan = null;
        CloudinaryDotNet.Cloudinary? sdk = null;
        try
        {
            if (mode is not ("dry-run" or "apply" or "verify" or "all")) throw new MediaMigrationException("invalid_migration_mode");
            var settings = configuration.GetSection(CloudinarySettings.SectionName).Get<CloudinarySettings>() ?? new();
            var paths = new MediaMigrationPaths(
                Path.GetFullPath(configuration["DictionaryAudioSettings:RootPath"] ?? Path.Combine(contentRoot, "App_Data/dictionary-audio")),
                Path.GetFullPath(configuration["MediaStorage:RootPath"] ?? Path.Combine(contentRoot, "App_Data/uploads")),
                Path.GetFullPath(configuration["media-migration-backup-root"] ?? Path.Combine(workspace, "backups/media-migration")));
            var inventory = new MediaMigrationInventory(paths, settings, new MediaMigrationReferenceAudit(configuration));
            if (mode is "dry-run" or "all")
            {
                plan = await inventory.BuildAsync(token);
                await MediaMigrationJson.WriteAsync(planPath, plan, token);
                Console.WriteLine(JsonSerializer.Serialize(new { status = "dry_run", plan.PlanId, fileCount = plan.Snapshot.Files.Count,
                    assetCount = plan.Snapshot.Assets.Count, issueCount = plan.Snapshot.Issues.Count, referenceAuditComplete = plan.Snapshot.Audit.Complete,
                    targetBound = plan.Snapshot.TargetAccountHash is not null, planPath }, MediaMigrationJson.Options));
                if (mode == "dry-run") return 0;
            }
            else
            {
                if (new FileInfo(planPath).Length > 32 * 1024 * 1024) throw new MediaMigrationException("migration_plan_too_large");
                plan = JsonSerializer.Deserialize<MediaMigrationPlan>(await File.ReadAllTextAsync(planPath, token), MediaMigrationJson.Options)
                    ?? throw new MediaMigrationException("invalid_migration_plan");
            }
            CloudinarySettingsValidator.EnsureEnabledAndValid(settings);
            var options = configuration.GetSection(CloudinaryMediaOptions.SectionName).Get<CloudinaryMediaOptions>() ?? new();
            ICloudMediaStore CreateStore()
            {
                sdk ??= CloudinaryClientFactory.Create(settings);
                return new CloudinaryMediaStore(new CloudinaryAssetTransport(sdk, new DeliveryFactory(), Options.Create(settings)),
                    Options.Create(settings), Options.Create(options), TimeProvider.System);
            }
            var runner = new MediaMigrationRunner(paths, inventory, CreateStore);
            if (mode is "apply" or "all")
            {
                var reportPath = Path.Combine(reports, "Cloudinary_media_migration_apply.json");
                var applied = await runner.RunAsync(plan!, false, reportPath, token);
                Console.WriteLine(JsonSerializer.Serialize(new { applied.Mode, applied.Status, assetCount = applied.Assets.Count, issueCount = applied.Issues.Count, reportPath }, MediaMigrationJson.Options));
                if (applied.Status == "blocked" || applied.Assets.Any(asset => asset.ErrorCode is "media_storage_credentials_or_permission" or "media_storage_quota_exceeded") || mode == "apply")
                    return applied.Status == "applied" ? 0 : 1;
            }
            if (mode is "verify" or "all")
            {
                var reportPath = Path.Combine(reports, "Cloudinary_media_migration_verify.json");
                // Fresh store/cache: independently read the committed manifests and full remote bytes.
                var verified = await runner.RunAsync(plan!, true, reportPath, token);
                Console.WriteLine(JsonSerializer.Serialize(new { verified.Mode, verified.Status, assetCount = verified.Assets.Count, issueCount = verified.Issues.Count, reportPath }, MediaMigrationJson.Options));
                return verified.Status == "verified" ? 0 : 1;
            }
            return 1;
        }
        catch (Exception error)
        {
            var code = error is MediaMigrationException known ? known.Code : error is OptionsValidationException ? "cloudinary_configuration_required" :
                error is OperationCanceledException ? "migration_cancelled" : "migration_command_failed";
            var report = new { mode, status = "blocked", testedAtUtc = DateTime.UtcNow, errorCode = code, planPath,
                filesRequiringReview = plan?.Snapshot.Files.Select(file => file.Id).ToArray() ?? [], sourceDeletionPerformed = false };
            await MediaMigrationJson.WriteAsync(Path.Combine(reports, "Cloudinary_media_migration_error.json"), report, CancellationToken.None);
            Console.WriteLine(JsonSerializer.Serialize(report, MediaMigrationJson.Options));
            return 1;
        }
        finally { sdk?.Api.Client.Dispose(); }
    }
    private sealed class DeliveryFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false,
            AutomaticDecompression = System.Net.DecompressionMethods.None }) { Timeout = Timeout.InfiniteTimeSpan };
    }
}
