using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Services.CloudinaryMedia;

namespace EnglishLearning.Api.Services.MediaMigration;

public sealed record CutoverWorkerReport(string Status, string Worker, string PlanId, string SnapshotHash, string InstanceId, int ProcessId,
    DateTime StartedAtUtc, DateTime TestedAtUtc, int AssetsVerified, bool LegacyReaderResolved, IReadOnlyList<string> Checks, string? ErrorCode);
public sealed record CutoverPayload(int SchemaVersion, string PlanId, string SnapshotHash, string TargetHash, DateTime AcceptedAtUtc,
    DateTime DeleteNotBeforeUtc, string BackupRoot, string MigrationVerifyHash, MediaRuntimeStatus Runtime, IReadOnlyList<string> WorkerHashes, string BrowserReportHash);
public sealed record CutoverSeal(CutoverPayload Payload, string Signature);

public static class MediaCutoverEvidence
{
    public const int RollbackDays = 7;
    public static void RequireMigration(MediaMigrationPlan plan, MediaMigrationReport verified)
    {
        if (plan.SchemaVersion != 1 || plan.SnapshotHash != MediaMigrationJson.Digest(plan.Snapshot) || verified.Mode != "verify" || verified.Status != "verified" ||
            verified.PlanId != plan.PlanId || verified.SnapshotHash != plan.SnapshotHash || verified.Issues.Count != 0 || !verified.SourcesUnchanged || !verified.ReferencesUnchanged ||
            verified.Assets.Count != plan.Snapshot.Assets.Count || verified.Assets.Any(asset => asset.Status != "verified" || asset.SizeBytes is null or <= 0 || !CloudMediaNames.Hash(asset.Sha256)) ||
            verified.Files.Count != plan.Snapshot.Files.Count || verified.Files.Any(file => file.Status != "verified"))
            throw new MediaMigrationException("migration_verification_required");
    }
    public static void RequireTarget(CloudinarySettings settings, MediaMigrationPlan plan)
    {
        CloudinarySettingsValidator.EnsureEnabledAndValid(settings);
        if (settings.AllowLegacyReads) throw new MediaMigrationException("disable_legacy_reads_before_cutover");
        if (settings.EnvironmentPrefix != plan.Snapshot.TargetNamespace || CloudMediaNames.Digest(Encoding.UTF8.GetBytes(settings.CloudName)) != plan.Snapshot.TargetAccountHash)
            throw new MediaMigrationException("cutover_target_mismatch");
    }
    public static CutoverSeal Accept(MediaMigrationPlan plan, MediaMigrationReport verified, CloudinarySettings settings, MediaRuntimeStatus runtime,
        IReadOnlyList<CutoverWorkerReport> workers, string browserReportHash, TimeProvider clock)
    {
        RequireTarget(settings, plan); RequireMigration(plan, verified);
        if (runtime.Revision != "cloud-cutover-v1" || runtime.Mode != "cloud-only" || runtime.TargetHash != MediaRuntimeState.TargetHash(settings)) throw new MediaMigrationException("runtime_cutover_not_ready");
        if (runtime.StartedAtUtc <= verified.TestedAtUtc) throw new MediaMigrationException("backend_restart_after_migration_required");
        if (workers.Count != 3 || workers.Any(worker => worker.Status != "passed" || worker.LegacyReaderResolved || worker.PlanId != plan.PlanId ||
            worker.SnapshotHash != plan.SnapshotHash || worker.AssetsVerified != plan.Snapshot.Assets.Count) || workers.Select(worker => worker.InstanceId).Distinct().Count() != 3)
            throw new MediaMigrationException("restart_and_multi_instance_proof_required");
        if (!workers.Select(worker => worker.Worker).SequenceEqual(new[] { "a", "b", "restart" }) || workers[0].ProcessId == workers[1].ProcessId ||
            workers[0].StartedAtUtc > workers[1].TestedAtUtc || workers[1].StartedAtUtc > workers[0].TestedAtUtc) throw new MediaMigrationException("concurrent_process_proof_missing");
        var now = clock.GetUtcNow().UtcDateTime;
        var payload = new CutoverPayload(1, plan.PlanId, plan.SnapshotHash, MediaRuntimeState.TargetHash(settings), now,
            now.AddDays(RollbackDays), Path.GetFullPath(verified.BackupRoot), MediaMigrationJson.Digest(verified), runtime, workers.Select(MediaMigrationJson.Digest).ToArray(), browserReportHash);
        return new(payload, Sign(payload, settings.ApiSecret));
    }
    public static string CleanupState(CutoverSeal seal, CloudinarySettings settings, MediaMigrationPlan plan, TimeProvider clock)
    {
        RequireTarget(settings, plan);
        var payload = seal.Payload;
        if (payload.SchemaVersion != 1 || payload.PlanId != plan.PlanId || payload.SnapshotHash != plan.SnapshotHash || payload.TargetHash != MediaRuntimeState.TargetHash(settings) ||
            payload.DeleteNotBeforeUtc != payload.AcceptedAtUtc.AddDays(RollbackDays) || !CloudMediaNames.Hash(seal.Signature) ||
            !CryptographicOperations.FixedTimeEquals(Convert.FromHexString(seal.Signature), Convert.FromHexString(Sign(payload, settings.ApiSecret))))
            throw new MediaMigrationException("invalid_cutover_retention_seal");
        return clock.GetUtcNow().UtcDateTime < payload.DeleteNotBeforeUtc ? "deferred_rollback_window" : "eligible_for_fresh_verification";
    }
    private static string Sign(CutoverPayload payload, string secret)
    {
        var key = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), "ELS-media-cutover-retention-v1"u8);
        return Convert.ToHexStringLower(HMACSHA256.HashData(key, JsonSerializer.SerializeToUtf8Bytes(payload, MediaMigrationJson.Options)));
    }
}
