using System.Security.Cryptography;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Services.CloudinaryMedia;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Services.MediaMigration;

public static class MediaCutoverWorker
{
    public static async Task<CutoverWorkerReport> RunAsync(string worker, MediaMigrationPlan plan, MediaMigrationReport verified,
        CloudinarySettings settings, ICloudMediaStore store, ICloudinaryAssetTransport transport, CancellationToken token)
    {
        var checks = new List<string>(); var legacyResolved = false; var count = 0;
        var instance = new MediaRuntimeState(Options.Create(settings)).Status();
        try
        {
            MediaCutoverEvidence.RequireMigration(plan, verified); MediaCutoverEvidence.RequireTarget(settings, plan);
            DictionaryAudioStorage NoDictionary() { legacyResolved = true; throw new MediaMigrationException("legacy_reader_resolved"); }
            MediaStorage NoCourse() { legacyResolved = true; throw new MediaMigrationException("legacy_reader_resolved"); }
            var dictionary = new CloudinaryDictionaryAudioStorage(() => store, NoDictionary, Options.Create(settings), Options.Create(new DictionaryAudioSettings()));
            var course = new CloudinaryCourseMediaStorage(() => store, () => transport, NoCourse, Options.Create(settings));
            foreach (var asset in plan.Snapshot.Assets)
            {
                var expected = verified.Assets.Single(result => result.Kind == asset.Kind && result.Reference == asset.Reference && result.SourceFile == asset.SourceFile && result.LegacyUrl == asset.LegacyUrl);
                DictionaryAudioPlayback? audio = null;
                if (asset.Kind == CloudMediaKind.DictionaryAudio)
                {
                    var entry = await dictionary.FindAsync(asset.Reference, token) ?? throw new MediaMigrationException("cutover_dictionary_missing");
                    if (entry.Attribution != asset.Attribution) throw new MediaMigrationException("cutover_attribution_mismatch");
                    audio = await dictionary.OpenAsync(entry, null, token);
                }
                var media = asset.Kind == CloudMediaKind.DictionaryAudio ? null : await course.OpenAsync(asset.LegacyUrl![11..], null, token)
                    ?? (asset.Kind == CloudMediaKind.DictionaryAudio ? null : throw new MediaMigrationException("cutover_course_media_missing"));
                await using var body = audio?.Body ?? media!.Body;
                if (audio?.EnableRangeProcessing == true || media?.EnableRangeProcessing == true) throw new MediaMigrationException("legacy_stream_was_used");
                using var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256); var buffer = new byte[81920]; var prefix = new byte[32]; var prefixCount = 0; long total = 0; int read;
                while ((read = await body.ReadAsync(buffer, token)) > 0)
                {
                    if (prefixCount < prefix.Length) { var copy = Math.Min(read, prefix.Length - prefixCount); buffer.AsSpan(0, copy).CopyTo(prefix.AsSpan(prefixCount)); prefixCount += copy; }
                    total += read; if (total > expected.SizeBytes) throw new MediaMigrationException("cutover_length_mismatch"); sha.AppendData(buffer, 0, read);
                }
                if (total != expected.SizeBytes || Convert.ToHexStringLower(sha.GetHashAndReset()) != expected.Sha256) throw new MediaMigrationException("cutover_hash_mismatch");
                if (asset.Kind == CloudMediaKind.DictionaryAudio)
                {
                    var entry = (await dictionary.FindAsync(asset.Reference, token))!;
                    await using var range = await dictionary.OpenAsync(entry, "bytes=0-31", token);
                    await using var invalid = await dictionary.OpenAsync(entry, "bytes=999999999-", token);
                    var bytes = new byte[32]; await range.Body.ReadExactlyAsync(bytes, token);
                    if (range.Status != 206 || range.Length != 32 || range.ContentRange != $"bytes 0-31/{total}" || !bytes.AsSpan().SequenceEqual(prefix) ||
                        invalid.Status != 416 || invalid.ContentRange != $"bytes */{total}") throw new MediaMigrationException("cutover_range_failed");
                }
                else
                {
                    await using var range = await course.OpenAsync(asset.LegacyUrl![11..], "bytes=0-31", token);
                    await using var invalid = await course.OpenAsync(asset.LegacyUrl![11..], "bytes=999999999-", token);
                    if (range is null || invalid is null) throw new MediaMigrationException("cutover_range_failed");
                    var bytes = new byte[32]; await range.Body.ReadExactlyAsync(bytes, token);
                    if (range.Status != 206 || range.Length != 32 || range.ContentRange != $"bytes 0-31/{total}" || !bytes.AsSpan().SequenceEqual(prefix) ||
                        invalid.Status != 416 || invalid.ContentRange != $"bytes */{total}") throw new MediaMigrationException("cutover_range_failed");
                }
                count++; checks.Add("cloud_bytes_and_range_" + asset.Kind + "_" + asset.Reference);
            }
            if (await dictionary.FindAsync(CloudMediaNames.Digest(Guid.NewGuid().ToByteArray()), token) is not null ||
                await course.OpenAsync(Guid.NewGuid().ToString("N") + ".jpg", null, token) is not null) throw new MediaMigrationException("cutover_miss_was_not_empty");
            checks.Add("cloud_miss_does_not_resolve_a_legacy_reader");
            return new("passed", worker, plan.PlanId, plan.SnapshotHash, instance.InstanceId, Environment.ProcessId, instance.StartedAtUtc,
                DateTime.UtcNow, count, legacyResolved, checks, null);
        }
        catch (Exception error)
        {
            return new("failed", worker, plan.PlanId, plan.SnapshotHash, instance.InstanceId, Environment.ProcessId, instance.StartedAtUtc,
                DateTime.UtcNow, count, legacyResolved, checks, error is MediaMigrationException known ? known.Code : error is CloudMediaException media ? media.Code : "cutover_worker_failed");
        }
    }
}
