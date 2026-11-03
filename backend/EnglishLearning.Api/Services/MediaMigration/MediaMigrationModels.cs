using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Services.CloudinaryMedia;

namespace EnglishLearning.Api.Services.MediaMigration;

public sealed record MediaMigrationPaths(string DictionaryRoot, string CourseRoot, string BackupRoot);
public sealed record MigrationIssue(string Code, string? File = null, string? Location = null);
public sealed record MigrationFile(string Area, string RelativePath, long SizeBytes, string? Sha256)
{
    public string Id => Area + "/" + RelativePath;
}
public sealed record MigrationReference(string Location, string? FileName = null, string? DictionaryKey = null, string? TypePrefix = null);
public sealed record MigrationAudit(bool Complete, string Fingerprint, IReadOnlyList<MigrationReference> References, IReadOnlyList<MigrationIssue> Issues);
public interface IMediaMigrationReferenceAudit { Task<MigrationAudit> ReadAsync(CancellationToken token); }
public sealed record MigrationAsset(CloudMediaKind Kind, string Reference, string Format, string ContentType,
    long? SizeBytes, string? Sha256, string? SourceFile, string? MetadataFile, string? LegacyUrl, AudioAttribution? Attribution);
public sealed record MigrationSnapshot(string DictionaryRoot, string CourseRoot, string TargetNamespace, string? TargetAccountHash,
    IReadOnlyList<MigrationFile> Files, IReadOnlyList<MigrationAsset> Assets, MigrationAudit Audit, IReadOnlyList<MigrationIssue> Issues);
public sealed record MediaMigrationPlan(int SchemaVersion, string PlanId, DateTime CreatedAtUtc, string SnapshotHash, MigrationSnapshot Snapshot);
public sealed record MigrationAssetResult(string Reference, CloudMediaKind Kind, string Status, string? ErrorCode = null,
    string? PublicId = null, IReadOnlyList<string>? OrphanCandidates = null, string? SourceFile = null, string? Sha256 = null, long? SizeBytes = null, string? LegacyUrl = null);
public sealed record MigrationFileResult(string File, string Status, string? BackupPath);
public sealed record MediaMigrationReport(string Mode, string Status, DateTime TestedAtUtc, string PlanId, string SnapshotHash,
    string BackupRoot, IReadOnlyList<MigrationAssetResult> Assets, IReadOnlyList<MigrationFileResult> Files,
    IReadOnlyList<MigrationIssue> Issues, bool SourcesUnchanged, bool ReferencesUnchanged);
public sealed class MediaMigrationException(string code) : Exception(code) { public string Code { get; } = code; }

public static class MediaMigrationJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web) { WriteIndented = true, MaxDepth = 32 };
    public static string Digest<T>(T value) => CloudMediaNames.Digest(JsonSerializer.SerializeToUtf8Bytes(value, Options));
    public static async Task WriteAsync<T>(string path, T value, CancellationToken token)
    {
        var target = Path.GetFullPath(path); var parent = Path.GetDirectoryName(target)!;
        Directory.CreateDirectory(parent);
        var temporary = Path.GetFullPath(Path.Combine(parent, "." + Path.GetFileName(target) + "." + Guid.NewGuid().ToString("N") + ".tmp"));
        if (Path.GetDirectoryName(temporary) != parent) throw new MediaMigrationException("invalid_report_path");
        await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(value, Options), token);
        File.Move(temporary, target, true); // Exact report paths only; never move/delete a source tree.
    }
}
