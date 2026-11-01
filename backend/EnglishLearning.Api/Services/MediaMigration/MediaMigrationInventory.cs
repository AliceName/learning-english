using System.Security.Cryptography;
using System.Text.Json;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Services.CloudinaryMedia;

namespace EnglishLearning.Api.Services.MediaMigration;

public sealed class MediaMigrationInventory(MediaMigrationPaths paths, CloudinarySettings cloud, IMediaMigrationReferenceAudit references)
{
    public async Task<MediaMigrationPlan> BuildAsync(CancellationToken token)
    {
        _ = new CloudMediaNames(cloud.EnvironmentPrefix);
        var files = new List<MigrationFile>(); var assets = new List<MigrationAsset>(); var issues = new List<MigrationIssue>();
        foreach (var (area, root) in new[] { ("dictionary", paths.DictionaryRoot), ("course", paths.CourseRoot) })
            await ScanAsync(area, Path.GetFullPath(root), files, issues, token);
        files = files.OrderBy(file => file.Id, StringComparer.Ordinal).ToList();
        var lookup = files.ToDictionary(file => file.Id, StringComparer.Ordinal);
        foreach (var file in files.Where(file => file.Sha256 is not null))
        {
            token.ThrowIfCancellationRequested();
            if (file.Area == "course" && MediaStorage.IsManagedFileName(file.RelativePath))
            {
                var format = Path.GetExtension(file.RelativePath)[1..]; if (format == "jpeg") format = "jpg";
                var mime = MediaStorage.ContentType(file.RelativePath)!;
                var kind = mime.StartsWith("image/", StringComparison.Ordinal) ? CloudMediaKind.CourseCover : CloudMediaKind.CourseAudio;
                try
                {
                    await ValidateFileAsync(file, kind, format, mime, token);
                    assets.Add(new(kind, file.RelativePath[..32], format, mime, file.SizeBytes, file.Sha256, file.Id, null, "/api/media/" + file.RelativePath, null));
                }
                catch (Exception error) when (error is CloudMediaException or MediaMigrationException or IOException)
                { issues.Add(new("invalid_course_media", file.Id)); }
            }
            else if (file.Area == "dictionary" && file.RelativePath.EndsWith(".json", StringComparison.Ordinal))
            {
                try
                {
                    if (file.SizeBytes is <= 0 or > 32768 || !CloudMediaNames.Hash(Path.GetFileNameWithoutExtension(file.RelativePath)) || file.RelativePath != Path.GetFileName(file.RelativePath)) throw new MediaMigrationException("invalid_sidecar");
                    var entry = JsonSerializer.Deserialize<CachedDictionaryAudio>(await File.ReadAllTextAsync(SourcePath(file), token), MediaMigrationJson.Options);
                    if (entry is null || entry.Key + ".json" != file.RelativePath || !CloudMediaNames.Hash(entry.ContentHash) || entry.Extension is not ("ogg" or "mp3" or "wav") ||
                        entry.Attribution is null || entry.Attribution.Provider is not ("wikimedia" or "dictionaryApi") ||
                        WikimediaAudioResolver.Https(entry.Attribution.FileUrl) is not { } uri || !WikimediaAudioResolver.AllowedDownload(uri)) throw new MediaMigrationException("invalid_sidecar");
                    var binaryId = "dictionary/" + entry.ContentHash + "." + entry.Extension;
                    if (!lookup.TryGetValue(binaryId, out var binary) || binary.Sha256 != entry.ContentHash || binary.SizeBytes != entry.SizeBytes) throw new MediaMigrationException("missing_or_changed_dictionary_binary");
                    await ValidateFileAsync(binary, CloudMediaKind.DictionaryAudio, entry.Extension, entry.ContentType, token);
                    assets.Add(new(CloudMediaKind.DictionaryAudio, entry.Key, entry.Extension, entry.ContentType, entry.SizeBytes, entry.ContentHash, binary.Id, file.Id, null, entry.Attribution));
                }
                catch (Exception error) when (error is JsonException or CloudMediaException or MediaMigrationException or IOException or ArgumentException)
                { issues.Add(new(error is MediaMigrationException known ? known.Code : "invalid_dictionary_sidecar", file.Id)); }
            }
        }
        // Course cover/audio share one reference-manifest namespace. Never pick a winner silently.
        foreach (var collision in assets.Where(asset => asset.Kind != CloudMediaKind.DictionaryAudio).GroupBy(asset => asset.Reference)
            .Where(group => group.Select(asset => (asset.Kind, asset.Format, asset.Sha256)).Distinct().Count() > 1).ToArray())
            foreach (var asset in collision.ToArray()) { issues.Add(new("conflicting_course_reference", asset.SourceFile)); assets.Remove(asset); }
        var audit = await references.ReadAsync(token);
        issues.AddRange(audit.Issues);
        foreach (var reference in audit.References.Where(reference => reference.FileName is not null))
        {
            var name = reference.FileName!;
            if (!MediaStorage.IsManagedFileName(name)) { issues.Add(new("invalid_managed_reference", Location: reference.Location)); continue; }
            var mime = MediaStorage.ContentType(name)!;
            if (reference.TypePrefix is not null && !mime.StartsWith(reference.TypePrefix, StringComparison.Ordinal)) issues.Add(new("reference_type_mismatch", Location: reference.Location));
            if (lookup.ContainsKey("course/" + name) || assets.Any(asset => asset.LegacyUrl == "/api/media/" + name)) continue;
            var format = Path.GetExtension(name)[1..]; if (format == "jpeg") format = "jpg";
            assets.Add(new(mime.StartsWith("image/", StringComparison.Ordinal) ? CloudMediaKind.CourseCover : CloudMediaKind.CourseAudio,
                name[..32], format, mime, null, null, null, null, "/api/media/" + name, null));
        }
        foreach (var file in files.Where(file => !assets.Any(asset => asset.SourceFile == file.Id || asset.MetadataFile == file.Id)))
            if (!issues.Any(issue => issue.File == file.Id)) issues.Add(new("preserved_unmapped_file", file.Id));
        var snapshot = new MigrationSnapshot(Path.GetFullPath(paths.DictionaryRoot), Path.GetFullPath(paths.CourseRoot), cloud.EnvironmentPrefix,
            string.IsNullOrWhiteSpace(cloud.CloudName) ? null : CloudMediaNames.Digest(System.Text.Encoding.UTF8.GetBytes(cloud.CloudName)), files,
            assets.OrderBy(asset => asset.Kind).ThenBy(asset => asset.Reference, StringComparer.Ordinal).ThenBy(asset => asset.SourceFile, StringComparer.Ordinal).ToArray(), audit,
            issues.OrderBy(issue => issue.File, StringComparer.Ordinal).ThenBy(issue => issue.Location, StringComparer.Ordinal).ThenBy(issue => issue.Code, StringComparer.Ordinal).ToArray());
        return new(1, Guid.NewGuid().ToString("N"), DateTime.UtcNow, MediaMigrationJson.Digest(snapshot), snapshot);
    }

    public string SourcePath(MigrationFile file)
    {
        var root = Path.GetFullPath(file.Area == "dictionary" ? paths.DictionaryRoot : file.Area == "course" ? paths.CourseRoot : throw new MediaMigrationException("invalid_source_area"));
        return ScopedPath(root, file.RelativePath);
    }
    public static string ScopedPath(string root, string relative)
    {
        root = Path.GetFullPath(root); var path = Path.GetFullPath(Path.Combine(root, relative));
        if (Path.IsPathRooted(relative) || !path.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new MediaMigrationException("unsafe_source_path");
        var current = path;
        while (current.Length >= root.Length)
        {
            if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new MediaMigrationException("reparse_point_not_followed");
            if (current.Equals(root, StringComparison.OrdinalIgnoreCase)) break;
            current = Path.GetDirectoryName(current)!;
        }
        return path;
    }
    private async Task ValidateFileAsync(MigrationFile file, CloudMediaKind kind, string format, string mime, CancellationToken token)
    {
        if (file.SizeBytes < 12 || file.SizeBytes > (kind == CloudMediaKind.CourseAudio ? 25L : 5L) * 1024 * 1024) throw new MediaMigrationException("invalid_media_size");
        await using var stream = File.OpenRead(SourcePath(file)); var header = new byte[(int)Math.Min(4096, stream.Length)]; await stream.ReadExactlyAsync(header, token);
        if (CloudMediaValidation.ValidateBytes(kind, format, header) != mime) throw new MediaMigrationException("invalid_media_mime");
    }
    private static async Task ScanAsync(string area, string root, List<MigrationFile> files, List<MigrationIssue> issues, CancellationToken token)
    {
        if (!Directory.Exists(root)) return;
        if ((File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0) { issues.Add(new("reparse_root_not_followed", area)); return; }
        var pending = new Stack<string>(); pending.Push(root);
        while (pending.TryPop(out var directory))
        {
            foreach (var path in Directory.EnumerateFileSystemEntries(directory).Order(StringComparer.Ordinal))
            {
                token.ThrowIfCancellationRequested();
                if (files.Count >= 10000) throw new MediaMigrationException("inventory_file_limit_exceeded");
                var relative = Path.GetRelativePath(root, path); var id = area + "/" + relative;
                try
                {
                    if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) { files.Add(new(area, relative, 0, null)); issues.Add(new("reparse_point_not_followed", id)); continue; }
                    if (Directory.Exists(path)) { pending.Push(path); continue; }
                    await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, true);
                    files.Add(new(area, relative, stream.Length, Convert.ToHexStringLower(await SHA256.HashDataAsync(stream, token))));
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException)
                { files.Add(new(area, relative, 0, null)); issues.Add(new("source_unreadable", id)); }
            }
        }
    }
}
