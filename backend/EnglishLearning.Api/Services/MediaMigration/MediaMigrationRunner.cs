using System.Security.Cryptography;
using EnglishLearning.Api.Services.CloudinaryMedia;

namespace EnglishLearning.Api.Services.MediaMigration;

public sealed class MediaMigrationRunner(MediaMigrationPaths paths, MediaMigrationInventory inventory, Func<ICloudMediaStore> cloud)
{
    public async Task<MediaMigrationReport> RunAsync(MediaMigrationPlan plan, bool verifyOnly, string reportPath, CancellationToken token)
    {
        if (plan.SchemaVersion != 1 || !Guid.TryParseExact(plan.PlanId, "N", out _) || plan.SnapshotHash != MediaMigrationJson.Digest(plan.Snapshot)) throw new MediaMigrationException("invalid_migration_plan");
        var fresh = await inventory.BuildAsync(token);
        if (fresh.SnapshotHash != plan.SnapshotHash) throw new MediaMigrationException("source_reference_or_target_changed_since_dry_run");
        if (!fresh.Snapshot.Audit.Complete) throw new MediaMigrationException("reference_audit_incomplete");
        if (fresh.Snapshot.TargetAccountHash is null) throw new MediaMigrationException("dry_run_target_unbound");
        var snapshot = fresh.Snapshot; // Use freshly validated local inputs, never paths/assets supplied only by a JSON plan.
        var backupRoot = Path.GetFullPath(paths.BackupRoot);
        foreach (var sourceRoot in new[] { snapshot.DictionaryRoot, snapshot.CourseRoot })
            if (backupRoot.StartsWith(sourceRoot.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || backupRoot.Equals(sourceRoot, StringComparison.OrdinalIgnoreCase)) throw new MediaMigrationException("backup_must_be_outside_source_roots");
        var backup = MediaMigrationInventory.ScopedPath(backupRoot, plan.PlanId); Directory.CreateDirectory(backup);
        await using var migrationLock = new FileStream(Path.Combine(backup, ".migration.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        var archivedPlan = Path.Combine(backup, "migration-plan.json");
        if (File.Exists(archivedPlan))
        {
            var existing = System.Text.Json.JsonSerializer.Deserialize<MediaMigrationPlan>(await File.ReadAllTextAsync(archivedPlan, token), MediaMigrationJson.Options);
            if (existing?.PlanId != plan.PlanId || existing.SnapshotHash != plan.SnapshotHash || MediaMigrationJson.Digest(existing.Snapshot) != plan.SnapshotHash)
                throw new MediaMigrationException("backup_plan_conflict");
        }
        else await MediaMigrationJson.WriteAsync(archivedPlan, plan, token);
        var issues = snapshot.Issues.ToList(); var results = new List<MigrationAssetResult>(); var files = new List<MigrationFileResult>();
        var discovered = new List<MigrationFile>(); string? activeFile = null;
        var backupsVerified = new HashSet<string>(StringComparer.Ordinal);
        var sourceUnchanged = false; var refsUnchanged = false; // Confirmed only by the final re-audit.
        async Task<MediaMigrationReport> Save(string status)
        {
            files = snapshot.Files.Select(file => new MigrationFileResult(file.Id,
                snapshot.Assets.Where(asset => asset.SourceFile == file.Id || asset.MetadataFile == file.Id).Any(asset =>
                    results.Any(result => result.Reference == asset.Reference && result.Kind == asset.Kind && result.SourceFile == asset.SourceFile && result.Status is "stored" or "verified")) ? verifyOnly ? "verified" : "stored" : "preserved_untransferred",
                backupsVerified.Contains(file.Id) ? MediaMigrationInventory.ScopedPath(backup, file.Id) : null)).ToList();
            files.AddRange(discovered.Select(file => new MigrationFileResult(file.Id, "discovered_after_snapshot_untransferred", null)));
            var report = new MediaMigrationReport(verifyOnly ? "verify" : "apply", status, DateTime.UtcNow, plan.PlanId, plan.SnapshotHash,
                backup, results.ToArray(), files, issues.ToArray(), sourceUnchanged, refsUnchanged);
            await MediaMigrationJson.WriteAsync(reportPath, report, CancellationToken.None);
            await MediaMigrationJson.WriteAsync(Path.Combine(backup, verifyOnly ? "verify.json" : "apply.json"), report, CancellationToken.None);
            return report;
        }
        try
        {
            await Save("in_progress");
            // Back up every inventoried file, including files that cannot be mapped/uploaded.
            foreach (var file in snapshot.Files)
            {
                activeFile = file.Id;
                if (file.Sha256 is null) throw new MediaMigrationException("backup_source_unreadable");
                var target = MediaMigrationInventory.ScopedPath(backup, file.Id);
                if (!verifyOnly && !File.Exists(target))
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                    var temporary = MediaMigrationInventory.ScopedPath(backup, file.Id + "." + Guid.NewGuid().ToString("N") + ".partial");
                    await using (var input = File.OpenRead(inventory.SourcePath(file)))
                    await using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, true)) await input.CopyToAsync(output, token);
                    await CheckFileAsync(temporary, file, token);
                    File.Move(temporary, target); // Both resolved paths are constrained to this exact backup plan folder.
                }
                await CheckFileAsync(target, file, token);
                backupsVerified.Add(file.Id);
                await CheckFileAsync(inventory.SourcePath(file), file, token);
            }
            activeFile = null;
            var store = cloud(); using var owner = store as IDisposable;
            string? providerBlocked = null;
            foreach (var asset in snapshot.Assets.OrderBy(asset => asset.SourceFile is null))
            {
                token.ThrowIfCancellationRequested();
                if (providerBlocked is not null)
                {
                    results.Add(new(asset.Reference, asset.Kind, "not_attempted", providerBlocked, SourceFile: asset.SourceFile, LegacyUrl: asset.LegacyUrl));
                    continue;
                }
                try
                {
                    CloudMediaManifest? saved;
                    if (!verifyOnly && asset.SourceFile is not null)
                    {
                        var source = snapshot.Files.Single(file => file.Id == asset.SourceFile);
                        await CheckFileAsync(inventory.SourcePath(source), source, token);
                        var bytes = await File.ReadAllBytesAsync(MediaMigrationInventory.ScopedPath(backup, source.Id), token);
                        if (CloudMediaNames.Digest(bytes) != source.Sha256) throw new MediaMigrationException("backup_changed");
                        saved = await store.StoreAsync(asset.Kind, asset.Reference, bytes, asset.Format, asset.Attribution, token);
                    }
                    else saved = await store.FindAsync(asset.Kind, asset.Reference, token);
                    if (saved is null) throw new MediaMigrationException("referenced_media_missing_both_locally_and_on_cloud");
                    if (saved.Kind != asset.Kind || saved.Asset.Format != asset.Format || saved.ContentType != asset.ContentType ||
                        asset.Sha256 is not null && saved.Sha256 != asset.Sha256 || asset.SizeBytes is long size && saved.SizeBytes != size ||
                        asset.Attribution is not null && saved.Attribution != asset.Attribution) throw new MediaMigrationException("cloud_metadata_or_attribution_conflict");
                    if (verifyOnly)
                    {
                        await using var read = await store.OpenAsync(asset.Kind, asset.Reference, null, token);
                        using var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256); var buffer = new byte[81920]; long total = 0; int count;
                        while ((count = await read.Body.ReadAsync(buffer, token)) > 0)
                        { total += count; if (total > saved.SizeBytes) throw new MediaMigrationException("cloud_length_mismatch"); sha.AppendData(buffer, 0, count); }
                        if (read.Status != 200 || total != saved.SizeBytes || Convert.ToHexStringLower(sha.GetHashAndReset()) != saved.Sha256) throw new MediaMigrationException("cloud_hash_mismatch");
                    }
                    results.Add(new(asset.Reference, asset.Kind, verifyOnly ? "verified" : "stored", PublicId: saved.Asset.PublicId,
                        SourceFile: asset.SourceFile, Sha256: saved.Sha256, SizeBytes: saved.SizeBytes, LegacyUrl: asset.LegacyUrl));
                }
                catch (Exception error) when (!token.IsCancellationRequested)
                {
                    var code = error is MediaMigrationException known ? known.Code : error is CloudMediaException media ? media.Code : "migration_asset_failed";
                    if (code is "media_storage_credentials_or_permission" or "media_storage_quota_exceeded") providerBlocked = code;
                    results.Add(new(asset.Reference, asset.Kind, "failed", code, OrphanCandidates: (error as CloudMediaException)?.OrphanCandidates, SourceFile: asset.SourceFile, LegacyUrl: asset.LegacyUrl));
                }
                await Save("in_progress");
            }
            var after = await inventory.BuildAsync(token);
            sourceUnchanged = MediaMigrationJson.Digest(after.Snapshot.Files) == MediaMigrationJson.Digest(snapshot.Files);
            refsUnchanged = after.Snapshot.Audit.Complete && after.Snapshot.Audit.Fingerprint == snapshot.Audit.Fingerprint;
            if (!sourceUnchanged) issues.Add(new("source_changed_during_migration"));
            if (!refsUnchanged) issues.Add(new("references_changed_during_migration"));
            discovered.AddRange(after.Snapshot.Files.Where(file => !snapshot.Files.Any(before => before.Id == file.Id)));
            issues.AddRange(discovered.Select(file => new MigrationIssue("new_file_after_snapshot", file.Id)));
            foreach (var before in snapshot.Files.Where(before => !after.Snapshot.Files.Any(file => file.Id == before.Id && file.Sha256 == before.Sha256 && file.SizeBytes == before.SizeBytes)))
                issues.Add(new("source_file_missing_or_changed", before.Id));
            return await Save(issues.Count == 0 && results.All(result => result.Status != "failed") ? verifyOnly ? "verified" : "applied" : "partial");
        }
        catch (Exception error)
        {
            if (activeFile is not null) sourceUnchanged = false;
            var code = error is MediaMigrationException known ? known.Code : token.IsCancellationRequested ? "migration_cancelled" : "migration_backup_or_io_failed";
            issues.Add(new(code, activeFile));
            foreach (var asset in snapshot.Assets.Where(asset => !results.Any(result => result.Kind == asset.Kind && result.Reference == asset.Reference && result.SourceFile == asset.SourceFile && result.LegacyUrl == asset.LegacyUrl)))
                results.Add(new(asset.Reference, asset.Kind, "not_attempted", code, SourceFile: asset.SourceFile, LegacyUrl: asset.LegacyUrl));
            return await Save("blocked");
        }
    }
    private static async Task CheckFileAsync(string path, MigrationFile expected, CancellationToken token)
    {
        await using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, true);
        if (file.Length != expected.SizeBytes || Convert.ToHexStringLower(await SHA256.HashDataAsync(file, token)) != expected.Sha256) throw new MediaMigrationException("source_or_backup_hash_changed");
    }
}
