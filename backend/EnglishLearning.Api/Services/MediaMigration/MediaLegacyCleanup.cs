using System.Security.Cryptography;
using System.Text.RegularExpressions;
using EnglishLearning.Api.Configuration;

namespace EnglishLearning.Api.Services.MediaMigration;

public sealed record LegacyCleanupReport(string Status, DateTime TestedAtUtc, DateTime DeleteNotBeforeUtc,
    IReadOnlyList<string> DeletedFiles, IReadOnlyList<string> PreservedFiles, string CodeRetirement, bool BackupRetained);

public static class MediaLegacyCleanup
{
    public static async Task<LegacyCleanupReport> RunAsync(MediaMigrationPlan plan, MediaMigrationReport verified, CutoverSeal seal,
        CloudinarySettings settings, CutoverWorkerReport freshCloud, bool execute, TimeProvider clock, CancellationToken token)
    {
        var state = MediaCutoverEvidence.CleanupState(seal, settings, plan, clock);
        if (state == "deferred_rollback_window") return new(state, clock.GetUtcNow().UtcDateTime, seal.Payload.DeleteNotBeforeUtc, [], [], "retained_during_rollback", true);
        MediaCutoverEvidence.RequireMigration(plan, verified);
        if (MediaMigrationJson.Digest(verified) != seal.Payload.MigrationVerifyHash || Path.GetFullPath(verified.BackupRoot) != seal.Payload.BackupRoot)
            throw new MediaMigrationException("cleanup_backup_evidence_mismatch");
        if (freshCloud.Status != "passed" || freshCloud.PlanId != plan.PlanId || freshCloud.SnapshotHash != plan.SnapshotHash || freshCloud.LegacyReaderResolved ||
            freshCloud.AssetsVerified != plan.Snapshot.Assets.Count || freshCloud.TestedAtUtc < clock.GetUtcNow().UtcDateTime.AddMinutes(-5))
            throw new MediaMigrationException("fresh_cloud_read_required_before_cleanup");
        var targets = new List<string>(); var deleted = new List<string>(); var preserved = new List<string>();
        foreach (var file in plan.Snapshot.Files)
        {
            token.ThrowIfCancellationRequested();
            if (file.RelativePath != Path.GetFileName(file.RelativePath) ||
                !(file.Area == "course" ? MediaStorage.IsManagedFileName(file.RelativePath) : file.Area == "dictionary" && Regex.IsMatch(file.RelativePath, @"\A[a-f0-9]{64}\.(json|ogg|mp3|wav)\z")))
                throw new MediaMigrationException("cleanup_source_name_not_allowlisted");
            var sourceRoot = file.Area == "dictionary" ? plan.Snapshot.DictionaryRoot : plan.Snapshot.CourseRoot;
            var source = MediaMigrationInventory.ScopedPath(sourceRoot, file.RelativePath);
            var backup = MediaMigrationInventory.ScopedPath(seal.Payload.BackupRoot, file.Id);
            await CheckAsync(backup, file, token);
            if (File.Exists(source)) { await CheckAsync(source, file, token); targets.Add(source); }
        }
        // All targets/backups are checked before the first delete; no directory or wildcard deletion.
        if (execute) foreach (var source in targets)
        {
            token.ThrowIfCancellationRequested();
            File.Delete(source); deleted.Add(source);
        }
        foreach (var root in new[] { plan.Snapshot.DictionaryRoot, plan.Snapshot.CourseRoot })
            if (Directory.Exists(root)) preserved.AddRange(Directory.EnumerateFileSystemEntries(root).Where(path => !targets.Contains(path, StringComparer.OrdinalIgnoreCase) || !execute));
        return new(!execute ? "ready_for_cleanup" : preserved.Count == 0 ? "source_files_cleaned_code_retirement_pending" : "partial_unplanned_files_preserved",
            clock.GetUtcNow().UtcDateTime, seal.Payload.DeleteNotBeforeUtc, deleted, preserved,
            "remove_legacy_readers_and_options_only_after_source_cleanup_and_build_test_review", true);
    }
    private static async Task CheckAsync(string path, MigrationFile expected, CancellationToken token)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, true);
        if (stream.Length != expected.SizeBytes || Convert.ToHexStringLower(await SHA256.HashDataAsync(stream, token)) != expected.Sha256)
            throw new MediaMigrationException("cleanup_source_or_backup_hash_mismatch");
    }
}
