using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Services.CloudinaryMedia;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Services;

// New writes always go to Cloudinary. Legacy files remain read-only until migration/cutover.
public sealed class CloudinaryDictionaryAudioStorage(Func<ICloudMediaStore> cloud, Func<DictionaryAudioStorage> legacy,
    IOptions<CloudinarySettings> configured, IOptions<DictionaryAudioSettings> audioOptions) : IDictionaryAudioStorage
{
    public CloudinaryDictionaryAudioStorage(Func<ICloudMediaStore> cloud, DictionaryAudioStorage legacy,
        IOptions<CloudinarySettings> configured, IOptions<DictionaryAudioSettings> audioOptions) : this(cloud, () => legacy, configured, audioOptions) { }
    public void EnsureWritable()
    {
        if (!configured.Value.Enabled)
            throw new VocabularyException(503, "audio_storage_not_configured", "Kho âm thanh chưa được cấu hình. Vui lòng thử lại sau.");
    }

    public async Task<CachedDictionaryAudio?> FindAsync(string key, CancellationToken token)
    {
        if (!configured.Value.Enabled && !configured.Value.AllowLegacyReads) EnsureWritable();
        if (configured.Value.Enabled)
        {
            var manifest = await cloud().FindAsync(CloudMediaKind.DictionaryAudio, key, token);
            if (manifest is not null) return Cached(manifest);
        }
        return configured.Value.AllowLegacyReads ? await legacy().FindAsync(key, token) : null;
    }

    public async Task<CachedDictionaryAudio> StoreAsync(string key, DownloadedDictionaryAudio audio, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        EnsureWritable();
        var format = DictionaryAudioDownload.Detect(audio.Bytes);
        if (audio.Bytes.Length < 32 || audio.Bytes.Length > Math.Min(audioOptions.Value.MaxFileBytes, 5 * 1024 * 1024) ||
            format is null || format.Value.Extension != audio.Extension || format.Value.Type != audio.ContentType)
            throw new VocabularyException(502, "invalid_audio", "Tệp âm thanh chưa hợp lệ.");
        return Cached(await cloud().StoreAsync(CloudMediaKind.DictionaryAudio, key, audio.Bytes, audio.Extension, audio.Attribution, token));
    }

    public async Task<DictionaryAudioPlayback> OpenAsync(CachedDictionaryAudio entry, string? range, CancellationToken token)
    {
        if (!configured.Value.Enabled && !configured.Value.AllowLegacyReads) EnsureWritable();
        if (configured.Value.Enabled)
        {
            var manifest = await cloud().FindAsync(CloudMediaKind.DictionaryAudio, entry.Key, token);
            if (manifest is not null)
            {
                _ = Cached(manifest);
                var read = await cloud().OpenAsync(CloudMediaKind.DictionaryAudio, entry.Key, range, token);
                return new(read.Body, read.ContentType, read.Length, read.Status, read.ContentRange);
            }
        }
        // Only an explicit cloud miss (or disabled configuration) can read an existing file.
        // Provider failures propagate; no request falls back to writing local media.
        if (!configured.Value.AllowLegacyReads) throw new VocabularyException(404, "audio_not_prepared", "Bản thu cần được chuẩn bị lại.");
        var existing = await legacy().FindAsync(entry.Key, token)
            ?? throw new VocabularyException(404, "audio_not_prepared", "Bản thu cần được chuẩn bị lại.");
        return await legacy().OpenAsync(existing, range, token);
    }

    private CachedDictionaryAudio Cached(CloudMediaManifest manifest)
    {
        if (manifest.Kind != CloudMediaKind.DictionaryAudio || manifest.Attribution is null ||
            manifest.Asset.Format is not ("ogg" or "mp3" or "wav") || manifest.SizeBytes < 32 ||
            manifest.SizeBytes > Math.Min(audioOptions.Value.MaxFileBytes, 5 * 1024 * 1024))
            throw new CloudMediaException(502, "invalid_dictionary_audio_manifest");
        return new(manifest.ReferenceKey, manifest.Sha256, manifest.Asset.Format, manifest.ContentType,
            manifest.SizeBytes, manifest.Attribution, manifest.CreatedAtUtc);
    }
}
