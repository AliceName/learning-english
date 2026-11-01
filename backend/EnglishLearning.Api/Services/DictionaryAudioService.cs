using System.Collections.Concurrent;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Services;

public sealed class DictionaryAudioService(IVocabularyRepository repository, IDictionaryAudioDownload download,
    IDictionaryAudioStorage storage, IOptions<DictionaryAudioSettings> configured, IHostApplicationLifetime lifetime,
    ILogger<DictionaryAudioService> logger)
{
    private readonly ConcurrentDictionary<string, Lazy<Task<CachedDictionaryAudio>>> flights = new();
    private readonly object flightGate = new();
    private readonly SemaphoreSlim slots = new(configured.Value.MaxConcurrentPreparations);

    public async Task<CachedDictionaryAudio> PrepareAsync(DictionaryAudioRequest request, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        var reference = await ReferenceAsync(request, token);
        token.ThrowIfCancellationRequested();
        // Coalesce cloud lookups as well as downloads/uploads. A cold cache hit can
        // perform remote IO, so it belongs inside the shared bounded preparation.
        Lazy<Task<CachedDictionaryAudio>> shared;
        lock (flightGate)
        {
            if (!flights.TryGetValue(reference.Key, out shared!))
            {
                if (flights.Count >= configured.Value.MaxPendingPreparations)
                    throw new VocabularyException(503, "audio_busy", "Hệ thống đang chuẩn bị nhiều bản thu. Vui lòng thử lại.", 2);
                Lazy<Task<CachedDictionaryAudio>>? candidate = null;
                candidate = new(() => PrepareSharedAsync(reference, candidate!), LazyThreadSafetyMode.ExecutionAndPublication);
                shared = candidate; flights[reference.Key] = shared;
            }
        }
        return await shared.Value.WaitAsync(token);
    }

    // GET serves a completed file only; it never starts an upstream download on a play click.
    public async Task<CachedDictionaryAudio?> FindAsync(DictionaryAudioRequest request, CancellationToken token) =>
        await storage.FindAsync((await ReferenceAsync(request, token)).Key, token);

    private async Task<DictionaryAudioReference> ReferenceAsync(DictionaryAudioRequest request, CancellationToken token)
    {
        if (!VocabularyWord.TryNormalize(request.Word, out var word) || request.Entry < 0 || request.Phonetic < 0)
            throw new VocabularyException(400, "invalid_audio_selection", "Lựa chọn phát âm chưa hợp lệ.");
        var entry = await repository.FindAsync(VocabularyWord.Key(word), token);
        if (entry is null || request.Entry >= entry.Payload.Entries.Length || request.Phonetic >= entry.Payload.Entries[request.Entry].Phonetics.Length)
            throw new VocabularyException(404, "audio_not_found", "Chưa có bản thu này. Hãy tra lại từ trước.");
        return WikimediaAudioResolver.Identify(entry.Payload.Entries[request.Entry].Phonetics[request.Phonetic])
            ?? throw new VocabularyException(404, "audio_not_found", "Mục từ này chưa có nguồn âm thanh được hỗ trợ.");
    }

    private async Task<CachedDictionaryAudio> PrepareSharedAsync(DictionaryAudioReference reference, Lazy<Task<CachedDictionaryAudio>> flight)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(lifetime.ApplicationStopping);
        deadline.CancelAfter(TimeSpan.FromSeconds(configured.Value.PreparationTimeoutSeconds));
        var entered = false;
        try
        {
            await slots.WaitAsync(deadline.Token); entered = true;
            var cached = await storage.FindAsync(reference.Key, deadline.Token);
            if (cached is not null) return cached;
            storage.EnsureWritable();
            var audio = await download.DownloadAsync(reference, deadline.Token);
            return await storage.StoreAsync(reference.Key, audio, deadline.Token);
        }
        catch (OperationCanceledException) when (!lifetime.ApplicationStopping.IsCancellationRequested)
        { throw new VocabularyException(504, "audio_timeout", "Chuẩn bị âm thanh quá thời gian chờ. Vui lòng thử lại."); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            logger.LogWarning("Dictionary audio storage failed ({ErrorType}).", error.GetType().Name);
            throw new VocabularyException(503, "audio_storage_unavailable", "Chưa lưu được bản thu để phát. Vui lòng thử lại.");
        }
        finally
        {
            if (entered) slots.Release();
            lock (flightGate) flights.TryRemove(new KeyValuePair<string, Lazy<Task<CachedDictionaryAudio>>>(reference.Key, flight));
        }
    }
}
