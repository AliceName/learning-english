namespace EnglishLearning.Api.Services;

public interface IDictionaryAudioStorage
{
    void EnsureWritable();
    Task<CachedDictionaryAudio?> FindAsync(string key, CancellationToken token);
    Task<CachedDictionaryAudio> StoreAsync(string key, DownloadedDictionaryAudio audio, CancellationToken token);
    Task<DictionaryAudioPlayback> OpenAsync(CachedDictionaryAudio entry, string? range, CancellationToken token);
}

// MVC processes Range only for seekable legacy files. Cloud streams are already sliced.
public sealed record DictionaryAudioPlayback(Stream Body, string ContentType, long Length, int Status = 200,
    string? ContentRange = null, bool EnableRangeProcessing = false) : IAsyncDisposable
{
    public ValueTask DisposeAsync() => Body.DisposeAsync();
}
