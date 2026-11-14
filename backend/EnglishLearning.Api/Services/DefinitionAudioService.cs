using System.Collections.Concurrent;
using System.Net;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Services.CloudinaryMedia;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Services;

public sealed class DefinitionAudioService(IBilingualVocabularyService lookup, IDictionaryAudioStorage storage, IHttpClientFactory factory,
    IOptions<DefinitionAudioSettings> configured, IHostApplicationLifetime lifetime)
{
    private readonly ConcurrentDictionary<string, Lazy<Task<CachedDictionaryAudio>>> flights = new();
    private readonly object flightGate = new();
    private readonly SemaphoreSlim slots = new(configured.Value.MaxConcurrentPreparations);

    public static bool AllowedSource(string? value) => Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme == "https"
        && uri.Host == "dict.minhqnd.com" && uri.IsDefaultPort && uri.UserInfo.Length == 0 && uri.AbsolutePath == "/api/v1/tts";

    public async Task<CachedDictionaryAudio> PrepareAsync(DefinitionAudioRequest request, CancellationToken token)
    {
        CheckEnabled();
        if (request.Direction != "en-vi" || !VocabularyWord.TryNormalize(request.Word, request.Direction, out var word) || !DefinitionAudioText.IsKey(request.DefinitionId))
            throw new VocabularyException(400, "invalid_audio_selection", "Lựa chọn nghĩa chưa hợp lệ.");
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(token);
        budget.CancelAfter(TimeSpan.FromSeconds(configured.Value.PreparationTimeoutSeconds));
        try
        {
            var response = await lookup.LookupAsync(word, request.Direction, budget.Token);
            var definition = response.Entries.SelectMany(entry => entry.Meanings).SelectMany(meaning => meaning.Definitions
                .Where(definition => VocabularyPresentation.DefinitionId(response, definition, meaning.PartOfSpeech) == request.DefinitionId)).FirstOrDefault();
            if (definition is null) throw new VocabularyException(409, "definition_changed", "Nghĩa đã thay đổi. Hãy tra lại từ trước khi nghe.");
            var text = DefinitionAudioText.Spoken(definition.Definition);
            if (text.Length is < 1 || text.Length > configured.Value.MaxTextLength)
                throw new VocabularyException(400, "invalid_audio_selection", "Nghĩa này vượt quá độ dài được hỗ trợ đọc.");
            var key = DefinitionAudioText.Key(text, configured.Value.VoiceProfile);
            Lazy<Task<CachedDictionaryAudio>> shared;
            lock (flightGate)
            {
                if (!flights.TryGetValue(key, out shared!))
                {
                    if (flights.Count >= configured.Value.MaxPendingPreparations)
                        throw new VocabularyException(503, "tts_busy", "Đang chuẩn bị nhiều âm thanh. Hãy thử lại sau.", 2);
                    Lazy<Task<CachedDictionaryAudio>>? candidate = null;
                    candidate = new(() => PrepareSharedAsync(key, text, candidate!), LazyThreadSafetyMode.ExecutionAndPublication);
                    shared = candidate; flights[key] = shared;
                }
            }
            return await shared.Value.WaitAsync(budget.Token);
        }
        catch (OperationCanceledException) when (!token.IsCancellationRequested)
        { throw new VocabularyException(504, "audio_timeout", "Chuẩn bị âm thanh quá thời gian chờ."); }
    }

    public async Task<CachedDictionaryAudio?> FindAsync(string key, CancellationToken token)
    {
        CheckEnabled();
        if (!DefinitionAudioText.IsKey(key)) throw new VocabularyException(400, "invalid_audio_selection", "Mã âm thanh chưa hợp lệ.");
        var cached = await storage.FindAsync(key, token);
        return Valid(cached) ? cached : null;
    }

    private bool Valid(CachedDictionaryAudio? audio) => audio is not null && audio.Attribution.Provider == "minhqnd-tts"
        && audio.Attribution.Synthetic && audio.Attribution.Locale == "vi" && audio.Extension == "mp3"
        && audio.Attribution.VoiceProfile == configured.Value.VoiceProfile && audio.SizeBytes <= configured.Value.MaxFileBytes;

    private void CheckEnabled()
    {
        if (!configured.Value.Enabled) throw new VocabularyException(503, "tts_disabled", "Đọc nghĩa tiếng Việt chưa được bật.");
    }

    private async Task<CachedDictionaryAudio> PrepareSharedAsync(string key, string text, Lazy<Task<CachedDictionaryAudio>> flight)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(lifetime.ApplicationStopping);
        deadline.CancelAfter(TimeSpan.FromSeconds(configured.Value.PreparationTimeoutSeconds));
        var entered = false;
        try
        {
            await slots.WaitAsync(deadline.Token); entered = true;
            var cached = await FindAsync(key, deadline.Token);
            if (cached is not null) return cached;
            storage.EnsureWritable();
            var audio = await DownloadAsync(text, deadline.Token);
            try { return await storage.StoreAsync(key, audio, deadline.Token); }
            catch (CloudMediaException error) when (error.Status == 409)
            {
                return await FindAsync(key, deadline.Token) ?? throw new VocabularyException(503, "audio_storage_unavailable", "Kho âm thanh đang được cập nhật. Hãy thử lại.");
            }
        }
        catch (OperationCanceledException) when (!lifetime.ApplicationStopping.IsCancellationRequested)
        { throw new VocabularyException(504, "audio_timeout", "Chuẩn bị âm thanh quá thời gian chờ."); }
        catch (Exception error) when (error is HttpRequestException or IOException or UnauthorizedAccessException)
        { throw new VocabularyException(503, "audio_storage_unavailable", "Chưa lấy hoặc lưu được âm thanh. Hãy thử lại."); }
        finally
        {
            if (entered) slots.Release();
            lock (flightGate) flights.TryRemove(new KeyValuePair<string, Lazy<Task<CachedDictionaryAudio>>>(key, flight));
        }
    }

    private async Task<DownloadedDictionaryAudio> DownloadAsync(string text, CancellationToken token)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromSeconds(configured.Value.SourceTimeoutSeconds));
        using var client = factory.CreateClient("DefinitionAudio");
        var uri = new Uri("https://dict.minhqnd.com/api/v1/tts?word=" + Uri.EscapeDataString(text) + "&lang=vi");
        using var response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
        if (response.StatusCode == HttpStatusCode.TooManyRequests) throw new VocabularyException(503, "tts_busy", "Nguồn giọng đọc đang bận. Hãy thử lại sau.", 10);
        if (response.StatusCode != HttpStatusCode.OK || response.Content.Headers.ContentType?.MediaType != "audio/mpeg")
            throw new VocabularyException(502, "invalid_audio", "Nguồn giọng đọc trả dữ liệu chưa hợp lệ.");
        var bytes = await DictionaryAudioDownload.ReadLimitedAsync(response.Content, configured.Value.MaxFileBytes, deadline.Token);
        MpegAudioValidation.Validate(bytes, configured.Value.MaxDurationSeconds);
        return new(bytes, "mp3", "audio/mpeg", new("minhqnd-tts", "https://dict.minhqnd.com/", uri.AbsoluteUri,
            "@minhqnd", null, null, "vi", true, configured.Value.VoiceProfile));
    }
}
