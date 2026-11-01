using System.Text.Json;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Services;
using EnglishLearning.Api.Services.CloudinaryMedia;
using EnglishLearning.Api.Services.MediaMigration;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Tests;

public sealed class MediaMigrationTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "englishlearning-audio-tests-" + Guid.NewGuid().ToString("N"));
    private MediaMigrationPaths Paths => new(Path.Combine(root, "dictionary"), Path.Combine(root, "course"), Path.Combine(root, "backup"));
    private readonly CloudinarySettings settings = new() { Enabled = true, CloudName = "migration-test", EnvironmentPrefix = "els/test" };
    private readonly MemoryCloudTransport remote = new();
    private readonly References references = new();
    private MediaMigrationInventory Inventory => new(Paths, settings, references);
    private string Report(string name) => Path.Combine(root, name + ".json");
    private CloudinaryMediaStore Cloud() => new(remote, Options.Create(settings), Options.Create(new CloudinaryMediaOptions()), TimeProvider.System);
    private MediaMigrationRunner Runner(MediaMigrationPaths? paths = null) => new(paths ?? Paths, Inventory, Cloud);
    private async Task SeedAsync()
    {
        var environment = new AudioTestEnvironment();
        var dictionary = new DictionaryAudioStorage(Options.Create(new DictionaryAudioSettings { RootPath = Paths.DictionaryRoot }), environment);
        await dictionary.StoreAsync(WikimediaAudioResolver.Identify(AudioFixture.Phonetic())!.Key, AudioFixture.Audio(), default);
        var legacy = new MediaStorage(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["MediaStorage:RootPath"] = Paths.CourseRoot }).Build(), environment);
        var png = CloudinaryEnvironmentSmoke.Fixtures().Single(item => item.ResourceType == "image").Bytes;
        var file = new Microsoft.AspNetCore.Http.FormFile(new MemoryStream(png), 0, png.Length, "file", "cover.png");
        var saved = await legacy.SaveAsync(file, "cover", default);
        references.Items.Add(new("Courses[1].CoverImageUrl", saved.FileName, TypePrefix: "image/"));
    }
    public void Dispose() => AudioFixture.RemoveTestRoot(root);

    [Fact]
    public async Task Dry_run_is_read_only_and_apply_verify_preserve_bytes_urls_and_attribution()
    {
        await SeedAsync(); var plan = await Inventory.BuildAsync(default);
        Assert.Equal(3, plan.Snapshot.Files.Count); Assert.Equal(2, plan.Snapshot.Assets.Count); Assert.Empty(plan.Snapshot.Issues);
        Assert.Equal(0, remote.UploadCalls); Assert.False(Directory.Exists(Paths.BackupRoot));
        var originals = plan.Snapshot.Files.ToDictionary(file => file.Id, file => File.ReadAllBytes(Inventory.SourcePath(file)));
        var applied = await Runner().RunAsync(plan, false, Report("apply"), default); Assert.Equal("applied", applied.Status);
        Assert.True(File.Exists(Path.Combine(applied.BackupRoot, "migration-plan.json"))); Assert.True(File.Exists(Path.Combine(applied.BackupRoot, "apply.json")));
        Assert.All(applied.Files, file => Assert.Equal("stored", file.Status));
        foreach (var file in plan.Snapshot.Files) Assert.Equal(originals[file.Id], File.ReadAllBytes(Inventory.SourcePath(file)));
        var verified = await Runner().RunAsync(plan, true, Report("verify"), default); Assert.Equal("verified", verified.Status);
        Assert.All(verified.Files, file => Assert.Equal("verified", file.Status));
        Assert.True(verified.SourcesUnchanged); Assert.True(verified.ReferencesUnchanged);
        Assert.All(verified.Assets, asset => Assert.NotNull(asset.Sha256));
        var dictionary = plan.Snapshot.Assets.Single(asset => asset.Kind == CloudMediaKind.DictionaryAudio);
        using var cloud = Cloud(); Assert.Equal(dictionary.Attribution, (await cloud.FindAsync(dictionary.Kind, dictionary.Reference, default))!.Attribution);
        Assert.Equal(references.Items.Single().FileName, plan.Snapshot.Assets.Single(asset => asset.Kind == CloudMediaKind.CourseCover).LegacyUrl![11..]);
        var creates = remote.BinaryCreates; Assert.Equal("applied", (await Runner().RunAsync(plan, false, Report("replay"), default)).Status); Assert.Equal(creates, remote.BinaryCreates);
    }

    [Theory]
    [InlineData("source")]
    [InlineData("reference")]
    [InlineData("target")]
    public async Task Changed_inputs_after_dry_run_prevent_any_upload(string change)
    {
        await SeedAsync(); var plan = await Inventory.BuildAsync(default);
        if (change == "source") await File.WriteAllBytesAsync(Path.Combine(Paths.CourseRoot, "new.bin"), [1, 2, 3]);
        if (change == "reference") references.Revision++;
        if (change == "target") settings.EnvironmentPrefix = "els/dev";
        await Assert.ThrowsAsync<MediaMigrationException>(() => Runner().RunAsync(plan, false, Report("apply"), default));
        Assert.Equal(0, remote.UploadCalls); Assert.False(Directory.Exists(Paths.BackupRoot));
    }

    [Fact]
    public async Task Corrupt_sidecar_and_orphan_binary_are_reported_and_backed_up_without_deleting()
    {
        await SeedAsync(); var json = Directory.GetFiles(Paths.DictionaryRoot, "*.json").Single(); await File.WriteAllTextAsync(json, "not JSON");
        var plan = await Inventory.BuildAsync(default); Assert.Contains(plan.Snapshot.Issues, issue => issue.Code == "invalid_dictionary_sidecar");
        Assert.Contains(plan.Snapshot.Issues, issue => issue.Code == "preserved_unmapped_file");
        var applied = await Runner().RunAsync(plan, false, Report("apply"), default); Assert.Equal("partial", applied.Status);
        Assert.All(applied.Files, file => Assert.True(File.Exists(file.BackupPath)));
        Assert.Equal(2, applied.Files.Count(file => file.Status == "preserved_untransferred")); Assert.True(File.Exists(json));
    }

    [Fact]
    public async Task Conflicting_course_guid_is_never_overwritten_or_silently_renamed()
    {
        await SeedAsync(); var cover = Directory.GetFiles(Paths.CourseRoot).Single();
        await File.WriteAllBytesAsync(Path.ChangeExtension(cover, ".wav"), AudioFixture.Wave());
        var plan = await Inventory.BuildAsync(default); Assert.Equal(2, plan.Snapshot.Issues.Count(issue => issue.Code == "conflicting_course_reference"));
        Assert.DoesNotContain(plan.Snapshot.Assets, asset => asset.Kind != CloudMediaKind.DictionaryAudio);
        var report = await Runner().RunAsync(plan, false, Report("apply"), default); Assert.Equal("partial", report.Status);
        Assert.Equal(2, Directory.GetFiles(Paths.CourseRoot).Length);
    }

    [Fact]
    public async Task Cloud_failure_is_resumable_and_backup_is_verified_before_upload()
    {
        await SeedAsync(); var plan = await Inventory.BuildAsync(default); remote.FailManifest = true;
        var failed = await Runner().RunAsync(plan, false, Report("first"), default); Assert.Equal("partial", failed.Status);
        Assert.All(failed.Files, file => Assert.True(File.Exists(file.BackupPath))); Assert.All(failed.Assets, result => Assert.Equal("failed", result.Status));
        remote.FailManifest = false;
        Assert.Equal("applied", (await Runner().RunAsync(plan, false, Report("second"), default)).Status);
        Assert.Equal("verified", (await Runner().RunAsync(plan, true, Report("verify"), default)).Status);
        Assert.Equal(2, remote.BinaryCreates);
    }

    [Fact]
    public async Task Verify_detects_changed_cloud_bytes_and_never_uploads_or_deletes()
    {
        await SeedAsync(); var plan = await Inventory.BuildAsync(default); await Runner().RunAsync(plan, false, Report("apply"), default);
        remote.CorruptBinary = true; var uploads = remote.UploadCalls;
        var result = await Runner().RunAsync(plan, true, Report("verify"), default);
        Assert.Equal("partial", result.Status); Assert.All(result.Assets, item => Assert.Equal("cloud_hash_mismatch", item.ErrorCode)); Assert.Equal(uploads, remote.UploadCalls);
        Assert.Equal(3, plan.Snapshot.Files.Count(file => File.Exists(Inventory.SourcePath(file))));
    }

    [Fact]
    public async Task Existing_cloud_only_references_are_verified_and_missing_both_locations_is_reported()
    {
        Directory.CreateDirectory(root);
        var key = new string('a', 32); references.Items.Add(new("Courses[1].CoverImageUrl", key + ".png", TypePrefix: "image/"));
        var plan = await Inventory.BuildAsync(default); Assert.Null(Assert.Single(plan.Snapshot.Assets).SourceFile);
        var missing = await Runner().RunAsync(plan, false, Report("missing"), default); Assert.Equal("partial", missing.Status);
        Assert.Equal("referenced_media_missing_both_locally_and_on_cloud", Assert.Single(missing.Assets).ErrorCode);
        using (var cloud = Cloud()) await cloud.StoreAsync(CloudMediaKind.CourseCover, key, CloudinaryEnvironmentSmoke.Fixtures().Single(file => file.ResourceType == "image").Bytes, "png", null, default);
        Assert.Equal("verified", (await Runner().RunAsync(plan, true, Report("verify"), default)).Status);
    }

    [Fact]
    public async Task Backup_corruption_blocks_replay_before_any_new_upload()
    {
        await SeedAsync(); var plan = await Inventory.BuildAsync(default); var applied = await Runner().RunAsync(plan, false, Report("apply"), default);
        await File.WriteAllBytesAsync(applied.Files[0].BackupPath!, [1]); var before = remote.UploadCalls;
        var result = await Runner().RunAsync(plan, false, Report("replay"), default);
        Assert.Equal("blocked", result.Status); Assert.Equal(before, remote.UploadCalls); Assert.Contains(result.Issues, issue => issue.Code == "source_or_backup_hash_changed");
    }

    [Fact]
    public async Task Forged_plan_path_and_incomplete_audit_cannot_reach_cloud()
    {
        await SeedAsync(); var plan = await Inventory.BuildAsync(default);
        var forged = plan with { Snapshot = plan.Snapshot with { DictionaryRoot = Path.GetTempPath() } };
        forged = forged with { SnapshotHash = MediaMigrationJson.Digest(forged.Snapshot) };
        await Assert.ThrowsAsync<MediaMigrationException>(() => Runner().RunAsync(forged, false, Report("apply"), default));
        references.Complete = false; plan = await Inventory.BuildAsync(default);
        await Assert.ThrowsAsync<MediaMigrationException>(() => Runner().RunAsync(plan, false, Report("apply"), default)); Assert.Equal(0, remote.UploadCalls);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Existing_cloud_content_or_attribution_conflict_preserves_originals(bool attributionOnly)
    {
        await SeedAsync(); var plan = await Inventory.BuildAsync(default); var asset = plan.Snapshot.Assets.Single(item => item.Kind == CloudMediaKind.DictionaryAudio);
        using (var cloud = Cloud()) await cloud.StoreAsync(asset.Kind, asset.Reference, AudioFixture.Wave(attributionOnly ? (byte)0 : (byte)1), "wav",
            attributionOnly ? AudioFixture.Audio().Attribution with { Author = "Previously stored speaker" } : AudioFixture.Audio().Attribution, default);
        var applied = await Runner().RunAsync(plan, false, Report("apply"), default);
        Assert.Equal("partial", applied.Status); Assert.Contains(applied.Assets, item => item.Kind == asset.Kind && item.Status == "failed");
        Assert.Equal(AudioFixture.Wave(), File.ReadAllBytes(Inventory.SourcePath(plan.Snapshot.Files.Single(file => file.Id == asset.SourceFile))));
        Assert.All(applied.Files, file => Assert.True(File.Exists(file.BackupPath)));
    }

    [Fact]
    public async Task A_file_created_during_upload_is_explicitly_reported_for_a_new_snapshot()
    {
        await SeedAsync(); var plan = await Inventory.BuildAsync(default); var added = false;
        remote.Reject = _ => { if (!added) { added = true; File.WriteAllText(Path.Combine(Paths.CourseRoot, "late-file.txt"), "Preserve me"); } return null; };
        var applied = await Runner().RunAsync(plan, false, Report("apply"), default);
        Assert.Equal("partial", applied.Status); Assert.False(applied.SourcesUnchanged);
        Assert.Contains(applied.Files, file => file.File == "course/late-file.txt" && file.Status == "discovered_after_snapshot_untransferred");
        Assert.True(File.Exists(Path.Combine(Paths.CourseRoot, "late-file.txt")));
    }

    [Fact]
    public async Task Backup_inside_a_source_root_is_rejected()
    {
        await SeedAsync(); var plan = await Inventory.BuildAsync(default);
        var exception = await Assert.ThrowsAsync<MediaMigrationException>(() => Runner(Paths with { BackupRoot = Path.Combine(Paths.CourseRoot, "backup") }).RunAsync(plan, false, Report("apply"), default));
        Assert.Equal("backup_must_be_outside_source_roots", exception.Code); Assert.Equal(0, remote.UploadCalls);
    }

    [Fact]
    public async Task A_known_provider_quota_failure_does_not_blindly_try_the_remaining_assets()
    {
        await SeedAsync(); var plan = await Inventory.BuildAsync(default);
        remote.Reject = _ => new CloudMediaException(503, "media_storage_quota_exceeded");
        var applied = await Runner().RunAsync(plan, false, Report("apply"), default);
        Assert.Equal("partial", applied.Status); Assert.Equal(1, remote.UploadCalls);
        Assert.Contains(applied.Assets, asset => asset.Status == "not_attempted" && asset.ErrorCode == "media_storage_quota_exceeded");
        Assert.All(applied.Files, file => Assert.True(File.Exists(file.BackupPath)));
    }

    [Theory]
    [InlineData("../outside")]
    [InlineData("/absolute")]
    public void Unsafe_relative_paths_are_rejected(string relative) => Assert.Throws<MediaMigrationException>(() => MediaMigrationInventory.ScopedPath(root, relative));

    [Theory]
    [InlineData("https://external.test/api/media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg", 0)]
    [InlineData("See https://external.test/api/media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg", 0)]
    [InlineData("See /api/media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg", 1)]
    [InlineData("/api/media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg", 1)]
    public void Reference_audit_keeps_external_media_urls_out_of_local_migration(string text, int expected) =>
        Assert.Equal(expected, MediaMigrationReferenceAudit.ManagedReferences(text, "test", "image/").Count);

    private sealed class References : IMediaMigrationReferenceAudit
    {
        public readonly List<MigrationReference> Items = [];
        public bool Complete = true; public int Revision;
        public Task<MigrationAudit> ReadAsync(CancellationToken token) => Task.FromResult(new MigrationAudit(Complete,
            MediaMigrationJson.Digest(new { Revision, Items }), Items.ToArray(), []));
    }
}
